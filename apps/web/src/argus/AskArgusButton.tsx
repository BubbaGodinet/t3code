import { useEffect, useRef, useState } from "react";

import { MessagePair } from "~/components/assistant-ui/elements/message-pair";
import { useProjects, useThreadShells } from "~/state/entities";

import { useMosaicStore } from "./mosaic/mosaicStore";
import "./argus-orb.css";

interface Mission {
  id: string;
  instruction: string;
  state: string;
  detail: string;
  spaceName: string | null;
}

function csrfToken(): string {
  return (
    document.cookie
      .split("; ")
      .find((part) => part.startsWith("argus_csrf=") || part.startsWith("__Host-argus_csrf="))
      ?.split("=")[1] ?? ""
  );
}

async function argus(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`/argus-assistant${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      "x-argus-csrf": csrfToken(),
      ...init?.headers,
    },
  });
}

type VoiceStatus = "off" | "connecting" | "listening" | "working" | "speaking";

interface VoiceLine {
  id: string;
  role: "you" | "argus";
  text: string;
}

interface SpeechUpdate {
  id: string;
  role: "you" | "argus";
  text: string;
  final: boolean;
}

function speechFromEvent(event: {
  type?: string;
  delta?: string;
  transcript?: string;
  item_id?: string;
  response_id?: string;
}): SpeechUpdate | null {
  const type = event.type ?? "";
  const yours = type.includes("input_audio") || type.includes("input_transcript");
  const argus =
    type.includes("output_audio_transcript") ||
    type.includes("output_transcript") ||
    type.includes("audio.transcript") ||
    type.includes("output_text");
  if (!yours && !argus) return null;
  const role = yours ? "you" : "argus";
  const id = event.item_id || event.response_id || `live-${role}`;
  if (type.endsWith("delta") && event.delta) return { id, role, text: event.delta, final: false };
  if ((type.endsWith("done") || type.endsWith("completed")) && event.transcript?.trim()) {
    return { id, role, text: event.transcript, final: true };
  }
  return null;
}

function applySpeech(current: VoiceLine[], update: SpeechUpdate): VoiceLine[] {
  const index = current.findIndex((line) => line.id === update.id);
  if (index === -1) {
    return [...current, { id: update.id, role: update.role, text: update.text }];
  }
  const next = current.slice();
  const previous = next[index]!;
  next[index] = { ...previous, text: update.final ? update.text : previous.text + update.text };
  return next;
}

function wantsPanel(speech: string): boolean {
  return /\b(open|show|pull up|bring up)( the| your)? panel\b/i.test(speech);
}

function missionsRaisedBy(speech: string, missions: Mission[]): Mission[] {
  if (!/\b(mission|review|queued|held|saved|follow-up|follow up)\b/i.test(speech)) return [];
  const text = speech.toLowerCase();
  const named = missions.filter((mission) => {
    const hint = mission.instruction.trim().toLowerCase();
    return hint.length > 12 && text.includes(hint.slice(0, 24));
  });
  return named.length > 0 ? named : missions.slice(-3);
}

interface VoiceCall {
  stop: () => void;
  setMuted: (muted: boolean) => void;
}

function startVoiceCall(
  handlers: {
    onStatus: (status: VoiceStatus) => void;
    onLine: (update: SpeechUpdate) => void;
    onVolume: (volume: number) => void;
  },
  desktop: DesktopSnapshot,
): Promise<VoiceCall> {
  const audio = new Audio();
  audio.autoplay = true;
  let peer: RTCPeerConnection | null = null;
  let events: RTCDataChannel | null = null;
  let microphone: MediaStream | null = null;
  let stopped = false;
  let stopLevels = () => {};

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (events?.readyState === "open") {
      events.send(JSON.stringify({ type: "session.close" }));
    }
    microphone?.getTracks().forEach((track) => track.stop());
    stopLevels();
    events?.close();
    peer?.close();
    audio.srcObject = null;
    handlers.onStatus("off");
  };

  return (async () => {
    handlers.onStatus("connecting");
    peer = new RTCPeerConnection();
    peer.addEventListener("track", (event) => {
      audio.srcObject = new MediaStream([event.track]);
      void audio.play().catch(() => undefined);
    });
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioContext.createMediaStreamSource(microphone).connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount);
    let levelFrame = 0;
    const readLevel = () => {
      if (stopped) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      handlers.onVolume(Math.min(1, Math.sqrt(sum / samples.length) * 4));
      levelFrame = window.requestAnimationFrame(readLevel);
    };
    levelFrame = window.requestAnimationFrame(readLevel);
    stopLevels = () => {
      window.cancelAnimationFrame(levelFrame);
      void audioContext.close();
    };
    for (const track of microphone.getAudioTracks()) peer.addTrack(track, microphone);

    events = peer.createDataChannel("oai-events");
    let greeted = false;
    const greet = () => {
      if (greeted || events?.readyState !== "open") return;
      greeted = true;
      events?.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions: "Say exactly this, and nothing else: How can I help you, sir?",
          },
        }),
      );
    };
    events.addEventListener("open", greet);
    events.addEventListener("message", (message) => {
      const event = JSON.parse(String(message.data)) as {
        type?: string;
        delta?: string;
        transcript?: string;
        item_id?: string;
        response_id?: string;
      };
      const type = event.type ?? "";
      if (type.includes("speech_started")) handlers.onStatus("listening");
      if (
        type.includes("input_audio_transcription") &&
        (type.endsWith("completed") || type.endsWith("done"))
      ) {
        handlers.onStatus("working");
      }
      if (type === "response.created" || type.includes("response.output_item"))
        handlers.onStatus("working");
      if (type.includes("output_audio") || type.includes("audio.delta"))
        handlers.onStatus("speaking");
      if (type === "response.done") handlers.onStatus("listening");
      const speech = speechFromEvent(event);
      if (speech) handlers.onLine(speech);
    });

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (peer.iceGatheringState !== "complete") {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          peer?.removeEventListener("icegatheringstatechange", onState);
          reject(new Error("The microphone connection timed out."));
        }, 10_000);
        function onState() {
          if (peer?.iceGatheringState !== "complete") return;
          window.clearTimeout(timeout);
          peer?.removeEventListener("icegatheringstatechange", onState);
          resolve();
        }
        peer?.addEventListener("icegatheringstatechange", onState);
        onState();
      });
    }

    const sdp = peer.localDescription?.sdp;
    if (!sdp) throw new Error("The voice connection did not start.");
    const response = await fetch("/argus-voice/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sdp, desktop }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      transport?: { sdp?: string };
    } | null;
    if (response.status === 503 || payload?.error === "voice_unconfigured") {
      throw new Error("Add OPENAI_API_KEY to this app's .env.local, then restart the workspace.");
    }
    if (!response.ok || !payload?.transport?.sdp) {
      throw new Error("The voice session did not start.");
    }
    await peer.setRemoteDescription({ type: "answer", sdp: payload.transport.sdp });
    greet();
    handlers.onStatus("working");
    return {
      stop,
      setMuted: (muted: boolean) => {
        microphone?.getAudioTracks().forEach((track) => {
          track.enabled = !muted;
        });
      },
    };
  })().catch((error: unknown) => {
    stop();
    throw error;
  });
}

interface DesktopChat {
  title: string;
  project: string | null;
  company: string | null;
  branch: string | null;
  pending: boolean;
}

interface DesktopSnapshot {
  chats: DesktopChat[];
}

interface SourceChip {
  id: string;
  label: string;
  status: string;
  detail: string;
  items?: { space: string | null; label: string }[];
}

export function AskArgusButton() {
  const threads = useThreadShells();
  const projects = useProjects();
  const companies = useMosaicStore((state) => state.companies);
  const [open, setOpen] = useState(false);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [voice, setVoice] = useState<VoiceStatus>("off");
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0);
  const [lines, setLines] = useState<VoiceLine[]>([]);
  const [sources, setSources] = useState<SourceChip[]>([]);
  const [openSource, setOpenSource] = useState<string | null>(null);
  const callRef = useRef<VoiceCall | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const heardAt = useRef(0);
  const desktopRef = useRef<DesktopSnapshot>({ chats: [] });

  const projectTitle = new Map(projects.map((project) => [project.id, project.title]));
  desktopRef.current = {
    chats: [...threads]
      .filter((thread) => !thread.archivedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 12)
      .map((thread) => ({
        title: thread.title,
        project: projectTitle.get(thread.projectId) ?? null,
        company:
          companies.find((company) => company.projectRef?.projectId === thread.projectId)?.name ??
          null,
        branch: thread.branch,
        pending: thread.hasPendingApprovals || thread.hasPendingUserInput,
      })),
  };

  async function load() {
    const response = await argus("/api/assistant/missions");
    if (!response.ok) {
      setError("Argus did not answer.");
      return;
    }
    const body = (await response.json()) as { missions?: Mission[] };
    setMissions(body.missions ?? []);
  }

  useEffect(() => {
    void load().catch(() => setError("Argus did not answer."));
  }, []);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [lines, missions]);

  const chatSignature = desktopRef.current.chats
    .map((chat) => `${chat.title}:${chat.pending}`)
    .join("|");
  useEffect(() => {
    void loadContext(desktopRef.current).then((next) => {
      if (next) setSources(next);
    });
  }, [chatSignature]);

  async function actOnSpeech(text: string) {
    const response = await fetch("/argus-voice/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(500),
    }).catch(() => null);
    if (!response?.ok) return;
    const body = (await response.json().catch(() => null)) as { action?: string } | null;
    const action = body?.action;
    if (action === "open_panel" || action === "list_missions" || action === "save_task")
      setOpen(true);
    if (action === "list_missions") setOpenSource("missions");
    if (action === "save_task") {
      const mission = await saveIntent(text);
      if (mission) setMissions((current) => [...current, mission]);
    }
    if (action === "end") {
      callRef.current?.stop();
      callRef.current = null;
      setMuted(false);
      setVoice("off");
    }
  }

  async function talk() {
    if (callRef.current) {
      callRef.current.stop();
      callRef.current = null;
      setMuted(false);
      setVoice("off");
      return;
    }
    setError(null);
    try {
      callRef.current = await startVoiceCall(
        {
          onStatus: (status) => {
            setVoice(status);
            if (status === "off") setVolume(0);
          },
          onLine: (update) => {
            setLines((current) => {
              const next = applySpeech(current, update);
              const spoken = next.find((line) => line.id === update.id)?.text ?? "";
              if (wantsPanel(spoken)) setOpen(true);
              return next;
            });
            if (update.role === "you" && update.final) void actOnSpeech(update.text);
          },
          onVolume: (level) => {
            setVolume(level);
            if (level > 0.18) heardAt.current = Date.now();
            else if (heardAt.current && Date.now() - heardAt.current > 650) {
              heardAt.current = 0;
              setVoice((current) => (current === "listening" ? "working" : current));
            }
          },
        },
        desktopRef.current,
      );
    } catch (caught) {
      callRef.current = null;
      setMuted(false);
      setVoice("off");
      setError(caught instanceof Error ? caught.message : "Voice did not start.");
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    callRef.current?.setMuted(next);
  }

  useEffect(() => {
    return () => callRef.current?.stop();
  }, []);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = instruction.trim();
    if (!text || busy) return;
    const userLine: VoiceLine = { id: crypto.randomUUID(), role: "you", text };
    const history = [...lines, userLine];
    setLines(history);
    setInstruction("");
    setBusy(true);
    setPending(true);
    setError(null);
    try {
      const replyId = crypto.randomUUID();
      let started = false;
      const reply = await requestReply(history, desktopRef.current, (partial) => {
        if (!started) {
          started = true;
          setPending(false);
          setLines((current) => [...current, { id: replyId, role: "argus", text: partial }]);
          return;
        }
        setLines((current) =>
          current.map((line) => (line.id === replyId ? { ...line, text: partial } : line)),
        );
      });
      const mission = await saveIntent(text);
      const answer = reply ?? mission?.detail ?? null;
      if (!answer) {
        setError("Argus did not answer.");
        return;
      }
      if (!started) {
        setLines((current) => [...current, { id: replyId, role: "argus", text: answer }]);
      }
      if (mission && mission.state !== "needs_you") {
        setMissions((current) => [...current, mission]);
      }
      void loadContext(desktopRef.current).then((next) => {
        if (next) setSources(next);
      });
    } catch {
      setError("Argus stopped answering, so that request was cancelled. Ask again.");
    } finally {
      setBusy(false);
      setPending(false);
    }
  }

  const thinking = pending || voice === "working" || voice === "connecting";
  const orbStateName = muted && voice !== "off" ? "muted" : thinking ? "working" : orbState(voice);

  function onOrbClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (event.altKey) {
      setOpen((current) => !current);
      return;
    }
    void talk();
  }

  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-50 flex w-[min(440px,calc(100vw-3rem))] flex-col items-end gap-3 [-webkit-app-region:no-drag]">
      {open ? (
        <div className="pointer-events-auto flex max-h-[min(560px,calc(100vh-240px))] w-full flex-col overflow-hidden rounded-[24px] border border-border bg-background text-foreground shadow-2xl">
          <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
            <header className="mb-4 flex items-center gap-3 text-base">
              <span className="font-semibold">Argus</span>
              <span className="text-border">/</span>
              <h2 className="m-0 font-medium text-muted-foreground">Assistant</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto text-sm text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </header>
            {sources.length > 0 ? (
              <div className="mb-4 flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {sources.map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      aria-pressed={openSource === source.id}
                      onClick={() =>
                        setOpenSource((current) => (current === source.id ? null : source.id))
                      }
                      className={`rounded-full bg-card px-3 py-1 text-[12px] ${
                        source.status === "connected"
                          ? "text-primary"
                          : source.status === "withheld"
                            ? "text-[color:var(--warning)]"
                            : "text-muted-foreground"
                      } ${openSource === source.id ? "ring-1 ring-primary" : ""}`}
                    >
                      {source.label}
                    </button>
                  ))}
                </div>
                {openSource ? (
                  <SourcePanel
                    source={sources.find((source) => source.id === openSource) ?? null}
                  />
                ) : null}
              </div>
            ) : null}
            <div
              ref={threadRef}
              className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col gap-8 overflow-y-auto"
            >
              {lines.length === 0 && missions.length === 0 ? (
                <p className="text-center text-[13px] text-muted-foreground">
                  Talk to Argus. The panes stay on screen.
                </p>
              ) : null}
              {messagePairs(lines, voice === "speaking" || pending || voice === "working").map(
                (pair) => (
                  <StreamingPair
                    key={pair.id}
                    userMessage={pair.user}
                    reply={pair.reply}
                    streaming={pair.streaming}
                  />
                ),
              )}
              {missionsRaisedBy(
                [...lines].reverse().find((line) => line.role === "argus")?.text ?? "",
                missions,
              ).map((mission) => (
                <MissionCard key={mission.id} mission={mission} />
              ))}
              {pending || voice === "working" ? (
                <p
                  className="flex items-center gap-2 text-[15px] text-muted-foreground"
                  role="status"
                >
                  <span className="size-2 animate-pulse rounded-full bg-primary" />
                  Looking through your workspace
                </p>
              ) : null}
            </div>
            <form
              onSubmit={(event) => void send(event)}
              className="mt-6 flex flex-col gap-3 rounded-[20px] bg-card px-5 py-4"
            >
              <label className="sr-only" htmlFor="composer">
                Message Argus
              </label>
              <textarea
                id="composer"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
                placeholder="Ask Argus, or capture a task…"
                className="resize-none bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
              />
              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  aria-label="Send"
                  disabled={busy || instruction.trim().length === 0}
                  className="flex size-10 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-40"
                >
                  {busy ? "…" : "↑"}
                </button>
              </div>
            </form>
            {error ? <p className="mt-3 text-[13px] text-[color:var(--error)]">{error}</p> : null}
          </div>
        </div>
      ) : null}
      <div className="pointer-events-auto flex flex-col items-center gap-2 self-end">
        <button
          type="button"
          className="argus-orb"
          data-state={orbStateName}
          onClick={onOrbClick}
          aria-label={
            voice === "off" ? "Ask Argus" : "End the conversation. Option-click opens the panel."
          }
          style={{ ["--size" as string]: "148px", transform: `scale(${1 + volume * 0.06})` }}
        >
          <span
            className="argus-orb-glow"
            style={{ opacity: thinking ? 0.8 : 0.35 + volume * 0.3 }}
          />
          <span className="argus-orb-ring" />
          <span className="argus-orb-body">
            <span className="argus-orb-swirl" />
            <span className="argus-orb-swirl b" />
            <span className="argus-orb-sheen" />
          </span>
        </button>
        <p
          role="status"
          className="flex items-center gap-2 rounded-full bg-background px-3 py-1 text-sm font-medium text-foreground shadow-lg"
        >
          <span
            className={`size-2 rounded-full ${thinking ? "animate-pulse" : ""}`}
            style={{ background: statusColor(thinking ? "working" : voice, muted) }}
          />
          {thinking ? "Looking…" : statusLabel(voice, muted)}
        </p>
        {error && !open ? (
          <p className="max-w-[220px] text-center text-[13px] text-[color:var(--error)]">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

async function loadContext(desktop: DesktopSnapshot): Promise<SourceChip[] | null> {
  const response = await argus("/api/assistant/context", {
    method: "POST",
    body: JSON.stringify(desktop),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { context?: { sources?: SourceChip[] } };
  return body.context?.sources ?? null;
}

async function requestReply(
  history: VoiceLine[],
  desktop: DesktopSnapshot,
  onDelta: (text: string) => void,
): Promise<string | null> {
  const response = await fetch("/argus-voice/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: history.map((line) => ({ role: line.role, text: line.text })),
      desktop,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const type = response.headers.get("content-type") ?? "";
  if (response.ok && type.includes("text/plain") && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let reply = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      reply += decoder.decode(value, { stream: true });
      if (reply) onDelta(reply);
    }
    return reply.trim() || null;
  }
  const payload = (await response.json().catch(() => null)) as { reply?: string } | null;
  const reply = payload?.reply?.trim();
  if (response.ok && reply) onDelta(reply);
  return response.ok && reply ? reply : null;
}

async function saveIntent(text: string): Promise<Mission | null> {
  const response = await argus("/api/assistant/intent", {
    method: "POST",
    body: JSON.stringify({
      instruction: text,
      source: "command",
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  const body = (await response.json().catch(() => null)) as { mission?: Mission } | null;
  return response.ok && body?.mission ? body.mission : null;
}

function SourcePanel({ source }: { source: SourceChip | null }) {
  if (!source) return null;
  const items = source.items ?? [];
  return (
    <div className="rounded-[18px] bg-card p-4">
      <p className="text-sm text-muted-foreground">{source.detail}</p>
      {items.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((item) => (
            <li key={`${item.space ?? ""}-${item.label}`} className="text-[15px] text-foreground">
              {item.space ? <span className="text-primary">{item.space}. </span> : null}
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MissionCard({ mission }: { mission: Mission }) {
  return (
    <article className="flex flex-col gap-4 rounded-[18px] bg-card p-6">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="text-[color:var(--warning)]">
          {mission.state === "blocked" ? "Held" : "Saved"}
        </span>
        {mission.spaceName ? <span className="text-primary">{mission.spaceName}</span> : null}
      </div>
      <div>
        <div className="text-xl font-semibold">{mission.instruction}</div>
        <p className="mt-1 text-muted-foreground">{mission.detail}</p>
      </div>
    </article>
  );
}

function orbState(voice: VoiceStatus) {
  if (voice === "connecting" || voice === "working") return "connecting";
  if (voice === "listening") return "listening";
  if (voice === "speaking") return "speaking";
  return "idle";
}

function statusLabel(voice: VoiceStatus, muted: boolean) {
  if (muted && voice !== "off") return "Muted";
  if (voice === "connecting") return "Connecting…";
  if (voice === "working") return "Looking…";
  if (voice === "listening") return "Listening";
  if (voice === "speaking") return "Speaking";
  return "Ready when you are";
}

function statusHint(voice: VoiceStatus, muted: boolean) {
  if (muted && voice !== "off") return "Your mic is off.";
  if (voice === "connecting") return "Opening a secure session.";
  if (voice === "working") return "Checking what is already here.";
  if (voice === "listening") return "Go ahead. Talk over Argus to interrupt.";
  if (voice === "speaking") return "Talk over Argus anytime to interrupt.";
  return "Tap the orb to start a voice session.";
}

function statusColor(voice: VoiceStatus, muted: boolean) {
  if (muted && voice !== "off") return "var(--error)";
  if (voice === "connecting" || voice === "working") return "var(--warning)";
  if (voice === "listening" || voice === "speaking") return "var(--success)";
  return "var(--muted-foreground)";
}

function messagePairs(lines: VoiceLine[], speaking: boolean) {
  const pairs: { id: string; user: string; reply: string; streaming: boolean }[] = [];
  for (const line of lines) {
    const last = pairs.at(-1);
    if (line.role === "you") {
      pairs.push({ id: line.id, user: line.text, reply: "", streaming: false });
      continue;
    }
    if (last && !last.reply) {
      last.reply = line.text;
      last.streaming = false;
      continue;
    }
    pairs.push({ id: line.id, user: "", reply: line.text, streaming: false });
  }
  const last = pairs.at(-1);
  if (last && speaking) last.streaming = true;
  return pairs;
}

function StreamingPair({
  userMessage,
  reply,
  streaming,
}: {
  userMessage: string;
  reply: string;
  streaming: boolean;
}) {
  const words = reply ? reply.split(/\s+/) : [];

  return (
    <MessagePair
      className="max-w-none"
      userMessage={userMessage}
      words={words}
      visibleWords={words.length}
      streaming={streaming && words.length > 0}
      onCopy={() => void navigator.clipboard?.writeText(reply)}
    />
  );
}
