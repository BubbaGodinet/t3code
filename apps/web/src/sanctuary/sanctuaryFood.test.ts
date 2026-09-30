import { describe, expect, it } from "vite-plus/test";

import { estimateMeal, foodDay, inferMealSlot, sumMacros, type Meal } from "./sanctuaryFood";

let nextId = 0;
const makeId = () => `id-${(nextId += 1)}`;

function meal(partial: Partial<Meal> & Pick<Meal, "slot" | "items">): Meal {
  return {
    id: makeId(),
    at: "2026-09-29T12:00:00.000Z",
    date: "2026-09-29",
    transcript: "",
    source: "estimate",
    edited: false,
    ...partial,
  };
}

const item = (name: string, kcal: number, protein: number, carbs: number, fat: number) => ({
  id: makeId(),
  name,
  portion: "1",
  kcal,
  protein,
  carbs,
  fat,
  matched: true,
});

describe("estimateMeal", () => {
  it("turns a spoken breakfast into rows with portions and macros", () => {
    const items = estimateMeal(
      "For breakfast I had two eggs, a slice of toast with butter and half an avocado",
      makeId,
    );
    expect(items.map((row) => [row.name, row.portion])).toEqual([
      ["Egg", "2"],
      ["Toast", "1 slice"],
      ["Butter", "1 tbsp"],
      ["Avocado", "0.5"],
    ]);
    expect(items[0]).toMatchObject({ kcal: 144, protein: 12.6 });
    expect(items[3]).toMatchObject({ kcal: 120, fat: 11 });
  });

  it("keeps foods it does not know as rows to fill in instead of dropping them", () => {
    const items = estimateMeal("a bowl of pho and 6 oz steak", makeId);
    expect(items[0]).toMatchObject({ name: "Pho", matched: false, kcal: 0 });
    expect(items[1]).toMatchObject({ name: "Steak", portion: "6 oz", matched: true });
  });

  it("reads the dish rather than its first word, and spoken fractions", () => {
    const items = estimateMeal("a chicken burrito and one and a half cups of rice", makeId);
    expect(items.map((row) => [row.name, row.portion, row.kcal])).toEqual([
      ["Burrito", "1", 600],
      ["White rice", "1.5 cups", 308],
    ]);
  });

  it("does not split dishes whose names contain 'and'", () => {
    const items = estimateMeal("mac and cheese and a peanut butter and jelly sandwich", makeId);
    expect(items.map((row) => row.name)).toEqual(["Mac and cheese", "PB&J sandwich"]);
  });

  it("picks the meal from what was said, else from the time of day", () => {
    expect(inferMealSlot("a snack of almonds", new Date(2026, 8, 29, 8))).toBe("snack");
    expect(inferMealSlot("two tacos", new Date(2026, 8, 29, 12))).toBe("lunch");
    expect(inferMealSlot("two tacos", new Date(2026, 8, 29, 19))).toBe("dinner");
  });
});

describe("foodDay", () => {
  const goals = { kcal: 2000, protein: 150, carbs: 200, fat: 70 };
  const meals = [
    meal({
      slot: "breakfast",
      items: [item("Egg", 144, 12.6, 0.8, 9.6), item("Toast", 80, 3, 14, 1)],
    }),
    meal({ slot: "lunch", items: [item("Burrito", 600, 25, 70, 22)] }),
    meal({ slot: "breakfast", items: [item("Banana", 105, 1.3, 27, 0.4)] }),
    meal({ slot: "dinner", date: "2026-09-28", items: [item("Pizza", 855, 36, 108, 30)] }),
  ];

  it("totals each meal and the day, and shows what remains against goals", () => {
    const day = foodDay(meals, "2026-09-29", goals);
    expect(day.meals.map((group) => [group.slot, group.totals.kcal])).toEqual([
      ["breakfast", 329],
      ["lunch", 600],
    ]);
    expect(day.consumed).toEqual({ kcal: 929, protein: 41.9, carbs: 111.8, fat: 33 });
    expect(day.remaining).toEqual({ kcal: 1071, protein: 108.1, carbs: 88.2, fat: 37 });
    expect(day.consumed.kcal + day.remaining.kcal).toBe(goals.kcal);
  });

  it("goes negative once a goal is passed", () => {
    const day = foodDay(meals, "2026-09-28", { ...goals, kcal: 800 });
    expect(day.remaining.kcal).toBe(-55);
  });

  it("treats blank or corrected cells as numbers", () => {
    expect(
      sumMacros([
        { kcal: Number.NaN, protein: 5, carbs: 0, fat: 0 },
        item("Apple", 95, 0.5, 25, 0.3),
      ]),
    ).toEqual({
      kcal: 95,
      protein: 5.5,
      carbs: 25,
      fat: 0.3,
    });
  });
});
