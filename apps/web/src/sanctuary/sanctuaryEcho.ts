import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { sanctuaryDesktop } from "./sanctuaryStore";

/**
 * How Echo turns speech into text, best first. Audio never leaves the device
 * and is never stored; only the words land in the text field.
 *
 * - "on-device": Chromium's Web Speech API, only when it reports it can
 *   process locally. Cloud recognition is never used.
 * - "system": macOS Dictation into the focused field (on-device on Apple silicon).
 * - "typed": no local speech path; the field is still there.
 */
export type EchoEngine = "on-device" | "system" | "typed";

type LocalAvailability = "unavailable" | "downloadable" | "downloading" | "available";

interface RecognitionResultList {
  readonly length: number;
  readonly [index: number]: {
    readonly isFinal: boolean;
    readonly [index: number]: { readonly transcript: string };
  };
}

interface RecognitionResultEvent extends Event {
  readonly resultIndex: number;
  readonly results: RecognitionResultList;
}

interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start(): void;
  stop(): void;
}

interface RecognitionConstructor {
  new (): Recognition;
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<LocalAvailability>;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
}

const LANGUAGE = typeof navigator === "undefined" ? "en-US" : navigator.language || "en-US";

function recognitionConstructor(): RecognitionConstructor | undefined {
  const scope = globalThis as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return (scope.SpeechRecognition ?? scope.webkitSpeechRecognition) as
    | RecognitionConstructor
    | undefined;
}

async function localSpeechAvailability(): Promise<LocalAvailability> {
  const Constructor = recognitionConstructor();
  if (!Constructor?.available) return "unavailable";
  return Constructor.available({ langs: [LANGUAGE], processLocally: true }).catch(
    () => "unavailable" as const,
  );
}

export function useEchoDictation(options: {
  readonly systemDictation: boolean;
  readonly field: RefObject<HTMLTextAreaElement | null>;
  readonly text: string;
  readonly setText: (text: string) => void;
}) {
  const { systemDictation, field, text, setText } = options;
  const [local, setLocal] = useState<LocalAvailability>("unavailable");
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const latestText = useRef(text);
  useEffect(() => {
    latestText.current = text;
  }, [text]);

  useEffect(() => {
    let cancelled = false;
    void localSpeechAvailability().then((availability) => {
      if (!cancelled) setLocal(availability);
    });
    return () => {
      cancelled = true;
      recognition.current?.stop();
    };
  }, []);

  const engine: EchoEngine =
    local === "available" || local === "downloadable" || local === "downloading"
      ? "on-device"
      : systemDictation
        ? "system"
        : "typed";

  const startLocal = useCallback(async () => {
    const Constructor = recognitionConstructor();
    if (!Constructor) return false;
    if (local !== "available") {
      const installed = await Constructor.install?.({
        langs: [LANGUAGE],
        processLocally: true,
      }).catch(() => false);
      if (!installed) {
        setLocal("unavailable");
        return false;
      }
      setLocal("available");
    }
    const session = new Constructor();
    session.lang = LANGUAGE;
    session.continuous = true;
    session.interimResults = true;
    session.processLocally = true;
    const base = latestText.current.trim();
    let committed = "";
    session.addEventListener("result", (event) => {
      const { resultIndex, results } = event as RecognitionResultEvent;
      let interim = "";
      for (let index = resultIndex; index < results.length; index += 1) {
        const result = results[index]!;
        if (result.isFinal) committed += result[0]!.transcript;
        else interim += result[0]!.transcript;
      }
      setText([base, `${committed}${interim}`.trim()].filter(Boolean).join(" "));
    });
    const finish = () => {
      recognition.current = null;
      setListening(false);
    };
    session.addEventListener("end", finish);
    session.addEventListener("error", finish);
    recognition.current = session;
    session.start();
    setListening(true);
    return true;
  }, [local, setText]);

  const toggle = useCallback(async () => {
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    field.current?.focus();
    if (engine === "on-device" && (await startLocal())) return;
    if (systemDictation) await sanctuaryDesktop()?.startDictation();
  }, [engine, field, startLocal, systemDictation]);

  return { engine, listening, toggle };
}
