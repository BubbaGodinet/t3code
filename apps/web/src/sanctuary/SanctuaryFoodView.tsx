import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../lib/utils";
import {
  foodDay,
  MEAL_SLOTS,
  type FoodItem,
  type Macros,
  type Meal,
  type MealSlot,
} from "./sanctuaryFood";
import { dayKey, newId, type SanctuaryDocument } from "./sanctuaryModel";
import { useSanctuaryStore } from "./sanctuaryStore";
import {
  EmptyNote,
  SanctuaryButton,
  SanctuaryDetail,
  fieldClass,
  friendlyDay,
  glassTile,
} from "./SanctuaryUi";

const MACROS: ReadonlyArray<{ key: keyof Macros; label: string; unit: string }> = [
  { key: "kcal", label: "Calories", unit: "" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
];

const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

const format = (value: number) =>
  Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);

function shiftDay(date: string, step: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return dayKey(new Date(year!, month! - 1, day! + step));
}

function editMeal(
  document: SanctuaryDocument,
  mealId: string,
  change: (meal: Meal) => Meal,
): SanctuaryDocument {
  return {
    ...document,
    meals: document.meals
      .map((meal) => (meal.id === mealId ? { ...change(meal), edited: true } : meal))
      .filter((meal) => meal.items.length > 0 || meal.transcript.trim().length > 0),
  };
}

/** Today's food against goals: consumed, remaining, and every meal's rows, all editable. */
export function SanctuaryFood({ onBack }: { onBack: () => void }) {
  const meals = useSanctuaryStore((state) => state.document.meals);
  const goals = useSanctuaryStore((state) => state.document.foodGoals);
  const update = useSanctuaryStore((state) => state.update);
  const today = dayKey(new Date());
  const [date, setDate] = useState(today);
  const [editingGoals, setEditingGoals] = useState(false);
  const day = foodDay(meals, date, goals);

  const setGoal = (key: keyof Macros, value: number) =>
    update((document) => ({
      ...document,
      foodGoals: { ...document.foodGoals, [key]: Math.max(0, value) },
    }));

  const addMeal = (slot: MealSlot) =>
    update((document) => ({
      ...document,
      meals: [
        ...document.meals,
        {
          id: newId(),
          at: new Date().toISOString(),
          date,
          slot,
          transcript: "",
          items: [
            {
              id: newId(),
              name: "",
              portion: "1",
              kcal: 0,
              protein: 0,
              carbs: 0,
              fat: 0,
              matched: false,
            },
          ],
          source: "estimate",
          edited: true,
        },
      ],
    }));

  return (
    <SanctuaryDetail
      title="Food"
      onBack={onBack}
      actions={
        <>
          <SanctuaryButton onClick={() => setDate(shiftDay(date, -1))} label="Previous day">
            <ChevronLeftIcon className="size-4" />
          </SanctuaryButton>
          <span className="min-w-24 text-center text-sm text-ink/90">
            {friendlyDay(date, today)}
          </span>
          <SanctuaryButton
            onClick={() => setDate(shiftDay(date, 1))}
            disabled={date >= today}
            label="Next day"
          >
            <ChevronRightIcon className="size-4" />
          </SanctuaryButton>
        </>
      }
    >
      <div className="mx-auto max-w-4xl">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {MACROS.map(({ key, label, unit }) => {
            const consumed = day.consumed[key];
            const goal = day.goals[key];
            const remaining = day.remaining[key];
            const share = goal > 0 ? Math.min(1, consumed / goal) : 0;
            return (
              <div key={key} className={cn(glassTile, "px-4 py-3")}>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-ink/75">{label}</span>
                  {editingGoals ? (
                    <input
                      type="number"
                      min={0}
                      aria-label={`${label} goal`}
                      value={goal}
                      onChange={(event) => setGoal(key, Number(event.target.value))}
                      className={cn(fieldClass, "h-7 w-20 px-2 py-0 text-right text-xs")}
                    />
                  ) : (
                    <span className="text-xs text-ink/75">
                      goal {format(goal)}
                      {unit}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-2xl font-medium text-ink tabular-nums">
                  {format(consumed)}
                  <span className="ml-0.5 text-sm text-ink/75">{unit}</span>
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink/10">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      remaining < 0 ? "bg-amber-600/85" : "bg-ink/70",
                    )}
                    style={{ width: `${share * 100}%` }}
                  />
                </div>
                <p
                  className={cn(
                    "mt-1.5 text-xs tabular-nums",
                    remaining < 0 ? "text-amber-800" : "text-ink/75",
                  )}
                >
                  {remaining < 0
                    ? `${format(-remaining)}${unit} over`
                    : `${format(remaining)}${unit} left`}
                </p>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => setEditingGoals((open) => !open)}
            className="text-xs text-ink/75 underline-offset-4 hover:text-ink hover:underline"
          >
            {editingGoals ? "Done editing goals" : "Edit goals"}
          </button>
        </div>

        {day.meals.length === 0 ? (
          <EmptyNote>
            Nothing logged {date === today ? "yet today" : "this day"}. Pick Food in Echo and say
            what you ate.
          </EmptyNote>
        ) : (
          <table className="mt-6 w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs text-ink/75">
                <th className="pb-2 font-normal">Food</th>
                <th className="w-28 pb-2 font-normal">Portion</th>
                {MACROS.map(({ key, label }) => (
                  <th key={key} className="w-20 pb-2 text-right font-normal">
                    {key === "kcal" ? "kcal" : label}
                  </th>
                ))}
                <th className="w-8 pb-2" />
              </tr>
            </thead>
            {day.meals.map((group) => (
              <tbody key={group.slot}>
                <tr>
                  <td
                    colSpan={7}
                    className="border-t border-ink/12 pt-4 pb-1 text-xs font-medium uppercase tracking-[0.16em] text-ink/75"
                  >
                    {SLOT_LABEL[group.slot]}
                  </td>
                </tr>
                {group.meals.map((meal) => (
                  <MealRows key={meal.id} meal={meal} />
                ))}
                <tr className="text-ink/85">
                  <td colSpan={2} className="pt-1 pb-3 text-xs">
                    <button
                      type="button"
                      onClick={() => addMeal(group.slot)}
                      className="inline-flex items-center gap-1 text-ink/75 hover:text-ink"
                    >
                      <PlusIcon className="size-3" /> Add food
                    </button>
                  </td>
                  {MACROS.map(({ key }) => (
                    <td key={key} className="pt-1 pb-3 text-right text-xs tabular-nums">
                      {format(group.totals[key])}
                    </td>
                  ))}
                  <td />
                </tr>
              </tbody>
            ))}
            <tfoot className="text-sm">
              {(
                [
                  ["Consumed", day.consumed],
                  ["Goal", day.goals],
                  ["Remaining", day.remaining],
                ] as const
              ).map(([label, values]) => (
                <tr
                  key={label}
                  className={label === "Consumed" ? "font-medium text-ink" : "text-ink/85"}
                >
                  <td
                    colSpan={2}
                    className={cn("py-1.5", label === "Consumed" && "border-t border-ink/20 pt-3")}
                  >
                    {label}
                  </td>
                  {MACROS.map(({ key }) => (
                    <td
                      key={key}
                      className={cn(
                        "py-1.5 text-right tabular-nums",
                        label === "Consumed" && "border-t border-ink/20 pt-3",
                        label === "Remaining" && values[key] < 0 && "text-amber-800",
                      )}
                    >
                      {format(values[key])}
                    </td>
                  ))}
                  <td className={cn(label === "Consumed" && "border-t border-ink/20")} />
                </tr>
              ))}
            </tfoot>
          </table>
        )}
        {day.meals.some((group) =>
          group.meals.some((meal) => meal.items.some((item) => !item.matched)),
        ) ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-ink/75">
            <span className="size-1.5 rounded-full bg-amber-600" />
            Not in the local food table. Type in its numbers and the totals update.
          </p>
        ) : null}
        {day.meals.length === 0 ? (
          <div className="flex justify-center gap-2">
            {MEAL_SLOTS.map((slot) => (
              <SanctuaryButton key={slot} onClick={() => addMeal(slot)}>
                <PlusIcon className="size-3.5" /> {SLOT_LABEL[slot]}
              </SanctuaryButton>
            ))}
          </div>
        ) : null}
      </div>
    </SanctuaryDetail>
  );
}

function MealRows({ meal }: { meal: Meal }) {
  const update = useSanctuaryStore((state) => state.update);
  const setItem = (itemId: string, change: Partial<FoodItem>) =>
    update((document) =>
      editMeal(document, meal.id, (current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === itemId ? { ...item, ...change, matched: true } : item,
        ),
      })),
    );
  const removeItem = (itemId: string) =>
    update((document) =>
      editMeal(document, meal.id, (current) => ({
        ...current,
        items: current.items.filter((item) => item.id !== itemId),
      })),
    );
  const setSlot = (slot: MealSlot) =>
    update((document) => editMeal(document, meal.id, (current) => ({ ...current, slot })));
  const removeMeal = () =>
    update((document) => ({
      ...document,
      meals: document.meals.filter((entry) => entry.id !== meal.id),
    }));

  const cell =
    "h-8 w-full rounded-md bg-transparent px-1.5 text-ink outline-none hover:bg-white/35 focus:bg-white/50";

  return (
    <>
      {meal.transcript ? (
        <tr>
          <td colSpan={7} className="pb-1 text-xs text-ink/75">
            <span className="italic">“{meal.transcript}”</span>
            <span className="ml-2 not-italic text-ink/60">
              {meal.source === "ai" ? "Estimated by AI" : "Estimated locally"}
              {meal.edited ? " · edited" : ""}
            </span>
            <select
              value={meal.slot}
              onChange={(event) => setSlot(event.target.value as MealSlot)}
              aria-label="Meal"
              className="ml-2 rounded bg-transparent text-ink/75 outline-none hover:text-ink"
            >
              {MEAL_SLOTS.map((slot) => (
                <option key={slot} value={slot} className="text-black">
                  {SLOT_LABEL[slot]}
                </option>
              ))}
            </select>
            <button type="button" onClick={removeMeal} className="ml-2 text-ink/60 hover:text-ink">
              Remove meal
            </button>
          </td>
        </tr>
      ) : null}
      {meal.items.map((item) => (
        <tr key={item.id} className="group">
          <td className="py-0.5 pr-2">
            <div className="flex items-center gap-1.5">
              {!item.matched ? (
                <span
                  aria-label="Needs numbers"
                  className="size-1.5 shrink-0 rounded-full bg-amber-600"
                />
              ) : null}
              <input
                value={item.name}
                placeholder="Food"
                aria-label="Food"
                onChange={(event) => setItem(item.id, { name: event.target.value })}
                className={cell}
              />
            </div>
          </td>
          <td className="py-0.5 pr-2">
            <input
              value={item.portion}
              aria-label="Portion"
              onChange={(event) => setItem(item.id, { portion: event.target.value })}
              className={cn(cell, "text-ink/85")}
            />
          </td>
          {MACROS.map(({ key, label }) => (
            <td key={key} className="py-0.5">
              <input
                type="number"
                min={0}
                step={key === "kcal" ? 1 : 0.1}
                aria-label={label}
                value={item[key]}
                onChange={(event) =>
                  setItem(item.id, { [key]: Math.max(0, Number(event.target.value) || 0) })
                }
                className={cn(cell, "text-right tabular-nums [appearance:textfield]")}
              />
            </td>
          ))}
          <td className="py-0.5 text-right">
            <button
              type="button"
              onClick={() => removeItem(item.id)}
              aria-label="Remove"
              className="rounded p-1 text-ink/0 transition-colors group-hover:text-ink/75 hover:!text-ink"
            >
              <XIcon className="size-3.5" />
            </button>
          </td>
        </tr>
      ))}
    </>
  );
}
