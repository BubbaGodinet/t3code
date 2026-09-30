import { describe, expect, it } from "vite-plus/test";

import { applyEcho, applyRambleRefinement, emptySanctuary } from "./sanctuaryModel";
import { sortRamble } from "./sanctuarySort";

let nextId = 0;
const makeId = () => `id-${(nextId += 1)}`;
const at = new Date(2026, 8, 29, 9, 30);

describe("Echo ramble", () => {
  it("saves the raw text and sorts it into notes and tasks", () => {
    const saved = applyEcho(
      emptySanctuary(),
      "ramble",
      "I need to call the bank and pick up the dry cleaning. Feeling anxious about the move. Remember to email Sarah",
      at,
      makeId,
    );
    expect(saved?.document.rambles[0]?.text).toContain("call the bank");
    expect(saved?.document.tasks.map((task) => task.text)).toEqual([
      "Call the bank",
      "Pick up the dry cleaning",
      "Email Sarah",
    ]);
    expect(saved?.document.onMind.map((note) => note.text)).toEqual([
      "Feeling anxious about the move",
    ]);
    expect(saved?.document.gratitude).toEqual([]);
  });

  it("keeps checked-off tasks when a model re-sorts the ramble", () => {
    const saved = applyEcho(
      emptySanctuary(),
      "ramble",
      "I need to call mom. Tired today.",
      at,
      makeId,
    )!;
    const checked = {
      ...saved.document,
      tasks: saved.document.tasks.map((task) => ({ ...task, done: true })),
    };
    const refined = applyRambleRefinement(
      checked,
      saved.result.mode === "ramble" ? saved.result.rambleId : "",
      { onMind: ["Tired today"], tasks: ["Call mom", "Plan the week"] },
      makeId,
    );
    expect(refined.tasks.map((task) => [task.text, task.done])).toEqual([
      ["Plan the week", false],
      ["Call mom", true],
    ]);
    expect(refined.gratitude).toEqual([]);
  });
});

describe("Echo gratitude", () => {
  it("never turns into tasks or notes, even when it sounds like one", () => {
    const text =
      "um i'm grateful my wife reminded me to call the bank. I need to remember how kind she is";
    expect(sortRamble(text).tasks.length).toBeGreaterThan(0);

    const saved = applyEcho(emptySanctuary(), "gratitude", text, at, makeId);
    expect(saved?.document.tasks).toEqual([]);
    expect(saved?.document.onMind).toEqual([]);
    expect(saved?.document.rambles).toEqual([]);
    expect(saved?.document.gratitude).toHaveLength(1);
    expect(saved?.document.gratitude[0]).toMatchObject({
      date: "2026-09-29",
      text: "I'm grateful my wife reminded me to call the bank. I need to remember how kind she is.",
    });
  });

  it("leaves earlier rambles alone", () => {
    const rambled = applyEcho(emptySanctuary(), "ramble", "Buy milk", at, makeId)!.document;
    const thanked = applyEcho(
      rambled,
      "gratitude",
      "Grateful for a quiet morning",
      at,
      makeId,
    )!.document;
    expect(thanked.tasks).toEqual(rambled.tasks);
    expect(thanked.onMind).toEqual(rambled.onMind);
    expect(thanked.gratitude.map((entry) => entry.text)).toEqual(["Grateful for a quiet morning."]);
  });
});

describe("Echo food", () => {
  it("logs a meal without touching tasks, notes, or gratitude", () => {
    const saved = applyEcho(
      emptySanctuary(),
      "food",
      "for lunch I had a turkey sandwich and an apple",
      at,
      makeId,
    );
    expect(saved?.document.meals[0]).toMatchObject({ slot: "lunch", date: "2026-09-29" });
    expect(saved?.document.meals[0]?.items.map((row) => row.name)).toEqual(["Sandwich", "Apple"]);
    expect(saved?.document.tasks).toEqual([]);
    expect(saved?.document.gratitude).toEqual([]);
  });

  it("ignores an empty capture", () => {
    expect(applyEcho(emptySanctuary(), "food", "   ", at, makeId)).toBeNull();
  });
});
