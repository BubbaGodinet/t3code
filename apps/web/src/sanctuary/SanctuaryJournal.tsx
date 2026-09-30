import { XIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import { cn } from "../lib/utils";
import { dayKey, newId } from "./sanctuaryModel";
import { useSanctuaryStore } from "./sanctuaryStore";
import {
  EmptyNote,
  SanctuaryButton,
  SanctuaryDetail,
  SectionTitle,
  fieldClass,
  friendlyDay,
} from "./SanctuaryUi";

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Remove"
      onClick={onClick}
      className="rounded p-1 text-ink/0 transition-colors group-hover:text-ink/60 hover:!text-ink"
    >
      <XIcon className="size-3.5" />
    </button>
  );
}

/** Tasks and notes sorted out of rambles, plus the raw rambles themselves. Stays in Sanctuary. */
export function SanctuaryMind({ onBack }: { onBack: () => void }) {
  const tasks = useSanctuaryStore((state) => state.document.tasks);
  const notes = useSanctuaryStore((state) => state.document.onMind);
  const rambles = useSanctuaryStore((state) => state.document.rambles);
  const update = useSanctuaryStore((state) => state.update);
  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [showRambles, setShowRambles] = useState(false);
  const open = tasks.filter((task) => !task.done);
  const done = tasks.filter((task) => task.done);
  const today = dayKey(new Date());

  const addTask = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    update((document) => ({
      ...document,
      tasks: [
        { id: newId(), at: new Date().toISOString(), text, done: false, rambleId: null },
        ...document.tasks,
      ],
    }));
    setDraft("");
  };
  const toggle = (id: string) =>
    update((document) => ({
      ...document,
      tasks: document.tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task)),
    }));
  const removeTask = (id: string) =>
    update((document) => ({ ...document, tasks: document.tasks.filter((task) => task.id !== id) }));
  const removeNote = (id: string) =>
    update((document) => ({
      ...document,
      onMind: document.onMind.filter((note) => note.id !== id),
    }));
  const removeRamble = (id: string) =>
    update((document) => ({
      ...document,
      rambles: document.rambles.filter((ramble) => ramble.id !== id),
    }));

  const taskRow = (task: (typeof tasks)[number]) => (
    <li key={task.id} className="group flex items-center gap-3 py-1.5">
      <input
        type="checkbox"
        checked={task.done}
        onChange={() => toggle(task.id)}
        aria-label={task.text}
        className="size-4 shrink-0 accent-ink"
      />
      <span className={cn("flex-1 text-sm", task.done ? "text-ink/60 line-through" : "text-ink")}>
        {task.text}
      </span>
      <RemoveButton onClick={() => removeTask(task.id)} />
    </li>
  );

  return (
    <SanctuaryDetail title="On my mind" onBack={onBack}>
      <div className="mx-auto max-w-2xl">
        <SectionTitle>Tasks</SectionTitle>
        <form onSubmit={addTask} className="mb-2 flex gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a task"
            className={cn(fieldClass, "flex-1")}
          />
          <SanctuaryButton type="submit" disabled={!draft.trim()}>
            Add
          </SanctuaryButton>
        </form>
        {open.length === 0 ? (
          <EmptyNote>No open tasks. Ramble in Echo and the to-dos land here.</EmptyNote>
        ) : (
          <ul>{open.map(taskRow)}</ul>
        )}
        {done.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => setShowDone((shown) => !shown)}
              className="mt-2 text-xs text-ink/75 hover:text-ink"
            >
              {showDone ? "Hide" : "Show"} done ({done.length})
            </button>
            {showDone ? <ul className="mt-1">{done.map(taskRow)}</ul> : null}
          </>
        ) : null}

        <SectionTitle>On my mind</SectionTitle>
        {notes.length === 0 ? (
          <EmptyNote>Nothing here yet.</EmptyNote>
        ) : (
          <ul className="space-y-1">
            {notes.map((note) => (
              <li key={note.id} className="group flex items-start gap-3 py-1 text-sm text-ink/90">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-ink/50" />
                <span className="flex-1 leading-6">{note.text}</span>
                <span className="mt-0.5 text-xs text-ink/60">
                  {friendlyDay(dayKey(new Date(note.at)), today)}
                </span>
                <RemoveButton onClick={() => removeNote(note.id)} />
              </li>
            ))}
          </ul>
        )}

        {rambles.length > 0 ? (
          <>
            <SectionTitle
              action={
                <button
                  type="button"
                  onClick={() => setShowRambles((shown) => !shown)}
                  className="text-xs text-ink/75 hover:text-ink"
                >
                  {showRambles ? "Hide" : `Show ${rambles.length}`}
                </button>
              }
            >
              Rambles, as said
            </SectionTitle>
            {showRambles ? (
              <ul className="space-y-3">
                {rambles.map((ramble) => (
                  <li key={ramble.id} className="group rounded-xl border border-ink/12 px-4 py-3">
                    <div className="flex items-center justify-between text-xs text-ink/60">
                      <span>
                        {new Date(ramble.at).toLocaleString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        {ramble.sortedBy === "ai" ? " · sorted by AI" : ""}
                      </span>
                      <RemoveButton onClick={() => removeRamble(ramble.id)} />
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink/90">
                      {ramble.text}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </SanctuaryDetail>
  );
}

/** Dated gratitude entries, newest first. */
export function SanctuaryGratitude({ onBack }: { onBack: () => void }) {
  const entries = useSanctuaryStore((state) => state.document.gratitude);
  const update = useSanctuaryStore((state) => state.update);
  const today = dayKey(new Date());
  const days = [...new Set(entries.map((entry) => entry.date))].toSorted().toReversed();
  const remove = (id: string) =>
    update((document) => ({
      ...document,
      gratitude: document.gratitude.filter((entry) => entry.id !== id),
    }));

  return (
    <SanctuaryDetail title="Gratitude" onBack={onBack}>
      <div className="mx-auto max-w-2xl">
        {days.length === 0 ? (
          <EmptyNote>Pick Gratitude in Echo and say what you are thankful for.</EmptyNote>
        ) : (
          days.map((date) => (
            <section key={date}>
              <SectionTitle>{friendlyDay(date, today)}</SectionTitle>
              <ul className="space-y-3">
                {entries
                  .filter((entry) => entry.date === date)
                  .map((entry) => (
                    <li key={entry.id} className="group flex items-start gap-3">
                      <p className="flex-1 whitespace-pre-wrap font-serif text-[1.05rem] leading-7 text-ink/90">
                        {entry.text}
                      </p>
                      <RemoveButton onClick={() => remove(entry.id)} />
                    </li>
                  ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </SanctuaryDetail>
  );
}
