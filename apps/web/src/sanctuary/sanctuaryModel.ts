import { randomUUID } from "../lib/utils";
import {
  DEFAULT_FOOD_GOALS,
  estimateMeal,
  inferMealSlot,
  type FoodItem,
  type Macros,
  type Meal,
} from "./sanctuaryFood";
import type { ScripturePlace } from "./sanctuaryScripture";
import { sortRamble, tidyGratitude, type RambleSort } from "./sanctuarySort";

/**
 * Everything Sanctuary keeps. One local document, persisted by the desktop app
 * under its own userData folder (localStorage on the web). None of it ever
 * reaches T3 threads, the server database, or company workspaces.
 */
export interface SanctuaryDocument {
  readonly version: 1;
  readonly rambles: readonly Ramble[];
  readonly onMind: readonly MindNote[];
  readonly tasks: readonly SanctuaryTask[];
  readonly gratitude: readonly GratitudeEntry[];
  readonly meals: readonly Meal[];
  readonly foodGoals: Macros;
  readonly money: MoneyState;
  readonly scripture: { readonly place: ScripturePlace | null };
}

export interface Ramble {
  readonly id: string;
  readonly at: string;
  readonly text: string;
  readonly sortedBy: "local" | "ai";
}

export interface MindNote {
  readonly id: string;
  readonly at: string;
  readonly text: string;
  readonly rambleId: string | null;
}

export interface SanctuaryTask {
  readonly id: string;
  readonly at: string;
  readonly text: string;
  readonly done: boolean;
  readonly rambleId: string | null;
}

export interface GratitudeEntry {
  readonly id: string;
  readonly at: string;
  readonly date: string;
  readonly text: string;
}

export interface ManualAccount {
  readonly id: string;
  readonly name: string;
  readonly kind: "asset" | "debt";
  /** Always positive; `kind` decides the sign in net worth. */
  readonly amount: number;
}

export interface LinkedAccount {
  readonly id: string;
  readonly name: string;
  readonly org: string;
  readonly currency: string;
  /** SimpleFIN's signed balance: credit cards and loans come back negative. */
  readonly balance: number;
  readonly balanceDate: number;
}

export interface MoneyState {
  readonly manual: readonly ManualAccount[];
  readonly linked: readonly LinkedAccount[];
  readonly syncedAt: string | null;
}

export type EchoMode = "ramble" | "gratitude" | "food";

export function emptySanctuary(): SanctuaryDocument {
  return {
    version: 1,
    rambles: [],
    onMind: [],
    tasks: [],
    gratitude: [],
    meals: [],
    foodGoals: DEFAULT_FOOD_GOALS,
    money: { manual: [], linked: [], syncedAt: null },
    scripture: { place: null },
  };
}

const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Reads a stored document, filling anything missing so older files keep loading. */
export function normalizeSanctuary(value: unknown): SanctuaryDocument {
  const empty = emptySanctuary();
  if (typeof value !== "object" || value === null) return empty;
  const raw = value as Partial<Record<keyof SanctuaryDocument, unknown>>;
  const money = (raw.money ?? {}) as Partial<MoneyState>;
  const goals = (raw.foodGoals ?? {}) as Partial<Macros>;
  const scripture = (raw.scripture ?? {}) as { place?: ScripturePlace | null };
  return {
    version: 1,
    rambles: list(raw.rambles),
    onMind: list(raw.onMind),
    tasks: list(raw.tasks),
    gratitude: list(raw.gratitude),
    meals: list(raw.meals),
    foodGoals: {
      kcal: Number(goals.kcal) || empty.foodGoals.kcal,
      protein: Number(goals.protein) || empty.foodGoals.protein,
      carbs: Number(goals.carbs) || empty.foodGoals.carbs,
      fat: Number(goals.fat) || empty.foodGoals.fat,
    },
    money: {
      manual: list(money.manual),
      linked: list(money.linked),
      syncedAt: typeof money.syncedAt === "string" ? money.syncedAt : null,
    },
    scripture: { place: scripture.place ?? null },
  };
}

/** Local calendar day, "2026-09-29". */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export const newId = () => randomUUID();

export type EchoResult =
  | {
      readonly mode: "ramble";
      readonly rambleId: string;
      readonly tasks: number;
      readonly notes: number;
    }
  | { readonly mode: "gratitude"; readonly entryId: string }
  | {
      readonly mode: "food";
      readonly mealId: string;
      readonly items: number;
      readonly kcal: number;
    };

/**
 * Saves one Echo capture. Each mode writes only its own lists: a ramble never
 * becomes gratitude, and gratitude never grows tasks or notes.
 */
export function applyEcho(
  document: SanctuaryDocument,
  mode: EchoMode,
  text: string,
  at: Date,
  makeId: () => string = newId,
): { document: SanctuaryDocument; result: EchoResult } | null {
  const raw = text.trim();
  if (!raw) return null;
  const timestamp = at.toISOString();

  if (mode === "ramble") {
    const rambleId = makeId();
    const sorted = sortRamble(raw);
    return {
      document: {
        ...document,
        rambles: [
          { id: rambleId, at: timestamp, text: raw, sortedBy: "local" },
          ...document.rambles,
        ],
        ...withRambleSort(document, rambleId, sorted, timestamp, makeId),
      },
      result: { mode, rambleId, tasks: sorted.tasks.length, notes: sorted.onMind.length },
    };
  }

  if (mode === "gratitude") {
    const entryId = makeId();
    return {
      document: {
        ...document,
        gratitude: [
          { id: entryId, at: timestamp, date: dayKey(at), text: tidyGratitude(raw) },
          ...document.gratitude,
        ],
      },
      result: { mode, entryId },
    };
  }

  const items = estimateMeal(raw, makeId);
  const mealId = makeId();
  const meal: Meal = {
    id: mealId,
    at: timestamp,
    date: dayKey(at),
    slot: inferMealSlot(raw, at),
    transcript: raw,
    items,
    source: "estimate",
    edited: false,
  };
  return {
    document: { ...document, meals: [...document.meals, meal] },
    result: {
      mode,
      mealId,
      items: items.length,
      kcal: items.reduce((sum, item) => sum + item.kcal, 0),
    },
  };
}

function withRambleSort(
  document: SanctuaryDocument,
  rambleId: string,
  sorted: RambleSort,
  timestamp: string,
  makeId: () => string,
): Pick<SanctuaryDocument, "onMind" | "tasks"> {
  return {
    onMind: [
      ...sorted.onMind.map((text) => ({ id: makeId(), at: timestamp, text, rambleId })),
      ...document.onMind,
    ],
    tasks: [
      ...sorted.tasks.map((text) => ({ id: makeId(), at: timestamp, text, done: false, rambleId })),
      ...document.tasks,
    ],
  };
}

/**
 * Replaces a ramble's local sort with a model's. Tasks already checked off, and
 * anything from other rambles, stay as they are.
 */
export function applyRambleRefinement(
  document: SanctuaryDocument,
  rambleId: string,
  sorted: RambleSort,
  makeId: () => string = newId,
): SanctuaryDocument {
  const ramble = document.rambles.find((entry) => entry.id === rambleId);
  if (!ramble || ramble.sortedBy === "ai") return document;
  const kept = {
    ...document,
    onMind: document.onMind.filter((note) => note.rambleId !== rambleId),
    tasks: document.tasks.filter((task) => task.rambleId !== rambleId || task.done),
  };
  const doneTexts = new Set(
    document.tasks
      .filter((task) => task.rambleId === rambleId && task.done)
      .map((task) => task.text.toLowerCase()),
  );
  return {
    ...kept,
    rambles: document.rambles.map((entry) =>
      entry.id === rambleId ? { ...entry, sortedBy: "ai" as const } : entry,
    ),
    ...withRambleSort(
      kept,
      rambleId,
      {
        onMind: sorted.onMind,
        tasks: sorted.tasks.filter((task) => !doneTexts.has(task.toLowerCase())),
      },
      ramble.at,
      makeId,
    ),
  };
}

/** Swaps a meal's local estimate for a model's rows, unless the user already edited it. */
export function applyMealRefinement(
  document: SanctuaryDocument,
  mealId: string,
  items: readonly FoodItem[],
): SanctuaryDocument {
  return {
    ...document,
    meals: document.meals.map((meal) =>
      meal.id === mealId && !meal.edited ? { ...meal, items, source: "ai" as const } : meal,
    ),
  };
}

export function netWorth(money: MoneyState): { assets: number; debts: number; total: number } {
  let assets = 0;
  let debts = 0;
  for (const account of money.linked) {
    if (account.balance >= 0) assets += account.balance;
    else debts += -account.balance;
  }
  for (const account of money.manual) {
    if (account.kind === "asset") assets += account.amount;
    else debts += account.amount;
  }
  return { assets, debts, total: assets - debts };
}
