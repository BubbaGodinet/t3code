import { MicIcon, SquareIcon } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../lib/utils";
import { refineMeal, refineRamble } from "./sanctuaryAi";
import { useEchoDictation, type EchoEngine } from "./sanctuaryEcho";
import { foodDay } from "./sanctuaryFood";
import { SanctuaryFood } from "./SanctuaryFoodView";
import { SanctuaryGratitude, SanctuaryMind } from "./SanctuaryJournal";
import {
  applyEcho,
  applyMealRefinement,
  applyRambleRefinement,
  dayKey,
  netWorth,
  type EchoMode,
} from "./sanctuaryModel";
import { SanctuaryMoney } from "./SanctuaryMoney";
import {
  chapterLabel,
  scriptureReference,
  verseOfTheDay,
  type ScripturePlace,
} from "./sanctuaryScripture";
import { SanctuaryScripture } from "./SanctuaryScriptureView";
import { useSanctuaryPersistence, useSanctuaryStore } from "./sanctuaryStore";
import { formatMoney, glassTile } from "./SanctuaryUi";

type Card = "scripture" | "mind" | "gratitude" | "money" | "food";

/** Re-renders when the calendar day changes, so the date and verse roll over at midnight. */
function useToday(): Date {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const check = () => {
      const now = new Date();
      setToday((current) => (dayKey(current) === dayKey(now) ? current : now));
    };
    const timer = window.setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, []);
  return today;
}

/**
 * Everything inside Sanctuary's glass: the day and its verse, Echo, and the
 * cards. A card opens to fill the glass; back (or Escape) returns.
 */
export function SanctuarySpace() {
  useSanctuaryPersistence();
  const [open, setOpen] = useState<{ card: Card; place?: ScripturePlace } | null>(null);
  const back = useCallback(() => setOpen(null), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (event.key === "Escape" && !typing) setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (open?.card === "scripture")
    return <SanctuaryScripture onBack={back} initial={open.place ?? null} />;
  if (open?.card === "mind") return <SanctuaryMind onBack={back} />;
  if (open?.card === "gratitude") return <SanctuaryGratitude onBack={back} />;
  if (open?.card === "money") return <SanctuaryMoney onBack={back} />;
  if (open?.card === "food") return <SanctuaryFood onBack={back} />;
  return <SanctuaryHome onOpen={(card, place) => setOpen(place ? { card, place } : { card })} />;
}

function SanctuaryHome({ onOpen }: { onOpen: (card: Card, place?: ScripturePlace) => void }) {
  const today = useToday();
  const verse = verseOfTheDay(today);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-8 py-8">
      <header className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <p className="text-xs uppercase tracking-[0.22em] text-ink/75">
          {today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </p>
        <button
          type="button"
          onClick={() => onOpen("scripture", verse)}
          className="mt-4 rounded-xl px-3 py-1 font-serif text-lg leading-relaxed text-ink/90 transition-colors hover:bg-white/35"
        >
          “{verse.text}”
        </button>
        <p className="mt-2 text-xs tracking-wide text-ink/75">{scriptureReference(verse)}</p>
      </header>
      <EchoPanel onOpen={onOpen} />
      <SanctuaryCards onOpen={onOpen} />
    </div>
  );
}

const MODES: ReadonlyArray<{ mode: EchoMode; label: string; placeholder: string }> = [
  { mode: "ramble", label: "Ramble", placeholder: "Say whatever is on your mind…" },
  { mode: "gratitude", label: "Gratitude", placeholder: "What are you grateful for today?" },
  {
    mode: "food",
    label: "Food",
    placeholder: "What did you eat? “Two eggs, toast with butter, and a banana”",
  },
];

const ENGINE_NOTE: Record<EchoEngine, string> = {
  "on-device": "Echo listens on this device. Audio is never kept.",
  system: "Echo opens macOS Dictation in the box. Press Esc or click Done when you finish.",
  typed: "No on-device speech here, so type it. Echo keeps the words only.",
};

const REFINED_BY = { "on-device": "on this device", claude: "with Claude" } as const;

function EchoPanel({ onOpen }: { onOpen: (card: Card) => void }) {
  const loaded = useSanctuaryStore((state) => state.loaded);
  const systemDictation = useSanctuaryStore((state) => state.capabilities.systemDictation);
  const update = useSanctuaryStore((state) => state.update);
  const [mode, setMode] = useState<EchoMode>("ramble");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const { engine, listening, toggle } = useEchoDictation({ systemDictation, field, text, setText });

  const save = () => {
    if (!loaded) return;
    const raw = text.trim();
    const saved = applyEcho(useSanctuaryStore.getState().document, mode, raw, new Date());
    if (!saved) return;
    update(() => saved.document);
    setText("");
    const { result } = saved;
    if (result.mode === "gratitude") {
      setStatus("Saved to Gratitude.");
      return;
    }
    if (result.mode === "ramble") {
      setStatus(
        `Saved. ${result.tasks} task${result.tasks === 1 ? "" : "s"}, ${result.notes} note${result.notes === 1 ? "" : "s"}.`,
      );
      void refineRamble(raw).then((refined) => {
        if (!refined) return;
        update((document) => applyRambleRefinement(document, result.rambleId, refined.sorted));
        setStatus(`Saved and sorted ${REFINED_BY[refined.by]}.`);
      });
      return;
    }
    setStatus(
      `Logged ${result.items} food${result.items === 1 ? "" : "s"}, about ${result.kcal} kcal.`,
    );
    onOpen("food");
    void refineMeal(raw).then((refined) => {
      if (refined)
        update((document) => applyMealRefinement(document, result.mealId, refined.items));
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  };

  const current = MODES.find((entry) => entry.mode === mode)!;

  return (
    <section className="mx-auto mt-10 flex w-full max-w-2xl flex-col items-center">
      <div
        role="tablist"
        aria-label="Echo mode"
        className="flex rounded-full border border-white/50 bg-white/30 p-0.5"
      >
        {MODES.map((entry) => (
          <button
            key={entry.mode}
            type="button"
            role="tab"
            aria-selected={entry.mode === mode}
            onClick={() => setMode(entry.mode)}
            className={cn(
              "h-7 rounded-full px-4 text-xs transition-colors",
              entry.mode === mode ? "bg-white text-ink shadow-sm" : "text-ink/85 hover:text-ink",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={listening ? "Stop Echo" : "Start Echo"}
        className={cn(
          "mt-6 flex size-20 items-center justify-center rounded-full border transition-colors",
          listening
            ? "border-ink bg-ink text-white shadow-[0_0_0_8px_rgb(21_18_43/0.12)]"
            : "border-white/60 bg-white/35 text-ink hover:bg-white/50",
        )}
      >
        {listening ? <SquareIcon className="size-6" /> : <MicIcon className="size-7" />}
      </button>
      <p className="mt-2 text-xs font-medium tracking-[0.2em] text-ink/75 uppercase">Echo</p>
      <textarea
        ref={field}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={current.placeholder}
        rows={3}
        className="mt-5 w-full resize-none rounded-2xl border border-ink/12 bg-white/40 px-4 py-3 text-sm leading-6 text-ink placeholder:text-ink/60 outline-none focus:border-ink/35"
      />
      <div className="mt-2 flex w-full items-center justify-between gap-4">
        <p className="text-xs text-ink/75">{status ?? ENGINE_NOTE[engine]}</p>
        <button
          type="button"
          onClick={save}
          disabled={!loaded || !text.trim()}
          className="h-8 shrink-0 rounded-lg bg-ink px-4 text-sm text-white transition-opacity disabled:opacity-35"
        >
          Save {current.label.toLowerCase()}
        </button>
      </div>
    </section>
  );
}

function SanctuaryCards({ onOpen }: { onOpen: (card: Card) => void }) {
  const document = useSanctuaryStore((state) => state.document);
  const today = dayKey(new Date());
  const openTasks = document.tasks.filter((task) => !task.done).length;
  const food = foodDay(document.meals, today, document.foodGoals);
  const worth = netWorth(document.money);
  const hasMoney = document.money.manual.length + document.money.linked.length > 0;
  const lastGratitude = document.gratitude[0];
  const place = document.scripture.place;

  const cards: ReadonlyArray<{ card: Card; title: string; detail: string }> = [
    {
      card: "scripture",
      title: "Scripture",
      detail: place ? `Continue ${chapterLabel(place, 0)}` : "Standard works",
    },
    {
      card: "mind",
      title: "On my mind",
      detail:
        openTasks + document.onMind.length === 0
          ? "Clear"
          : `${openTasks} open task${openTasks === 1 ? "" : "s"} · ${document.onMind.length} note${document.onMind.length === 1 ? "" : "s"}`,
    },
    {
      card: "gratitude",
      title: "Gratitude",
      detail: lastGratitude
        ? lastGratitude.date === today
          ? "Written today"
          : `${document.gratitude.length} entr${document.gratitude.length === 1 ? "y" : "ies"}`
        : "Nothing yet",
    },
    { card: "money", title: "Money", detail: hasMoney ? formatMoney(worth.total) : "Add accounts" },
    {
      card: "food",
      title: "Food",
      detail: `${food.consumed.kcal.toLocaleString()} / ${food.goals.kcal.toLocaleString()} kcal`,
    },
  ];

  return (
    <div className="mx-auto mt-auto grid w-full max-w-5xl grid-cols-2 gap-3 pt-10 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((entry) => (
        <button
          key={entry.card}
          type="button"
          onClick={() => onOpen(entry.card)}
          className={cn(glassTile, "px-4 py-4 text-left transition-colors hover:bg-white/35")}
        >
          <span className="block text-sm font-medium text-ink">{entry.title}</span>
          <span className="mt-1 block truncate text-xs text-ink/75 tabular-nums">
            {entry.detail}
          </span>
        </button>
      ))}
    </div>
  );
}
