/**
 * Food for Sanctuary: a spoken meal becomes rows of foods with portions and
 * macros, then a day table against goals. The local table is a compact set of
 * USDA-typical values per one default portion, good enough to be useful
 * offline and always correctable by hand.
 */

export interface Macros {
  readonly kcal: number;
  readonly protein: number;
  readonly carbs: number;
  readonly fat: number;
}

export interface FoodItem extends Macros {
  readonly id: string;
  readonly name: string;
  readonly portion: string;
  /** False when nothing in the local table matched, so the row needs numbers. */
  readonly matched: boolean;
}

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";
export const MEAL_SLOTS: readonly MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export interface Meal {
  readonly id: string;
  readonly at: string;
  readonly date: string;
  readonly slot: MealSlot;
  readonly transcript: string;
  readonly items: readonly FoodItem[];
  /** "estimate" is the local table; "ai" came back from a model. */
  readonly source: "estimate" | "ai";
  /** Set once the user edits a row, so a late model answer never overwrites them. */
  readonly edited: boolean;
}

export const DEFAULT_FOOD_GOALS: Macros = { kcal: 2200, protein: 140, carbs: 240, fat: 75 };

type Unit = "count" | "cup" | "tbsp" | "tsp" | "oz" | "g" | "slice" | "piece" | "scoop" | "can";

// [name, aliases, unit, grams per unit, kcal, protein, carbs, fat] per one unit.
type FoodRow = readonly [string, readonly string[], Unit, number, number, number, number, number];

const FOODS: readonly FoodRow[] = [
  [
    "Egg",
    ["eggs", "egg", "fried egg", "scrambled eggs", "boiled egg"],
    "count",
    50,
    72,
    6.3,
    0.4,
    4.8,
  ],
  ["Egg white", ["egg whites", "egg white"], "count", 33, 17, 3.6, 0.2, 0.1],
  ["Bacon", ["bacon", "strips of bacon"], "slice", 8, 43, 3, 0.1, 3.3],
  ["Sausage", ["sausage", "sausages", "sausage link"], "count", 25, 80, 4, 0.5, 7],
  [
    "Toast",
    ["toast", "bread", "slice of bread", "slices of bread", "wheat bread"],
    "slice",
    30,
    80,
    3,
    14,
    1,
  ],
  ["Bagel", ["bagel", "bagels"], "count", 100, 270, 10, 53, 1.5],
  ["English muffin", ["english muffin"], "count", 57, 130, 5, 26, 1],
  ["Oatmeal", ["oatmeal", "oats", "porridge"], "cup", 234, 166, 6, 28, 3.6],
  ["Cereal", ["cereal", "cheerios", "granola"], "cup", 30, 110, 2, 24, 1],
  ["Milk", ["milk", "glass of milk"], "cup", 244, 122, 8, 12, 4.8],
  ["Greek yogurt", ["greek yogurt"], "cup", 170, 100, 17, 6, 0.7],
  ["Yogurt", ["yogurt", "yoghurt"], "cup", 170, 150, 6, 25, 3],
  ["Banana", ["banana", "bananas"], "count", 118, 105, 1.3, 27, 0.4],
  ["Apple", ["apple", "apples"], "count", 182, 95, 0.5, 25, 0.3],
  ["Orange", ["orange", "oranges", "clementine", "clementines"], "count", 131, 62, 1.2, 15, 0.2],
  [
    "Berries",
    ["berries", "strawberries", "blueberries", "raspberries"],
    "cup",
    150,
    70,
    1,
    17,
    0.4,
  ],
  ["Grapes", ["grapes"], "cup", 151, 104, 1, 27, 0.2],
  ["Avocado", ["avocado", "avocados"], "count", 150, 240, 3, 13, 22],
  ["Peanut butter", ["peanut butter", "almond butter"], "tbsp", 16, 94, 3.5, 3.5, 8],
  [
    "PB&J sandwich",
    [
      "peanut butter and jelly",
      "peanut butter and jelly sandwich",
      "pb and j",
      "pbj",
      "pbj sandwich",
      "pb&j",
      "pb&j sandwich",
    ],
    "count",
    100,
    380,
    13,
    45,
    17,
  ],
  [
    "Nuts",
    ["almonds", "nuts", "cashews", "walnuts", "peanuts", "pistachios"],
    "oz",
    28,
    164,
    6,
    6,
    14,
  ],
  ["Trail mix", ["trail mix"], "oz", 28, 131, 4, 13, 8],
  [
    "Chicken breast",
    ["chicken breast", "chicken", "grilled chicken", "rotisserie chicken"],
    "oz",
    28,
    47,
    8.8,
    0,
    1,
  ],
  ["Chicken thigh", ["chicken thigh", "chicken thighs"], "count", 85, 180, 21, 0, 10],
  ["Fried chicken", ["fried chicken"], "piece", 140, 360, 30, 12, 21],
  [
    "Chicken nuggets",
    ["chicken nuggets", "nuggets", "chicken tenders", "tenders"],
    "piece",
    16,
    45,
    2.3,
    2.7,
    2.8,
  ],
  ["Ground beef", ["ground beef", "hamburger meat", "beef"], "oz", 28, 70, 7, 0, 4.5],
  ["Steak", ["steak", "sirloin", "ribeye"], "oz", 28, 67, 7.7, 0, 3.8],
  ["Salmon", ["salmon"], "oz", 28, 58, 6.3, 0, 3.5],
  ["Tuna", ["tuna"], "can", 142, 120, 27, 0, 1],
  ["Shrimp", ["shrimp"], "oz", 28, 28, 6.8, 0, 0.1],
  ["Turkey", ["turkey", "deli turkey", "turkey slices"], "oz", 28, 30, 5, 1, 0.5],
  ["Ham", ["ham"], "oz", 28, 35, 5, 1, 1],
  ["Pork chop", ["pork chop", "pork chops", "pork"], "count", 150, 290, 40, 0, 13],
  ["Meatballs", ["meatballs", "meatball"], "piece", 30, 70, 5, 2, 5],
  ["Tofu", ["tofu"], "cup", 252, 188, 20, 4.6, 12],
  ["White rice", ["rice", "white rice"], "cup", 158, 205, 4.3, 45, 0.4],
  ["Brown rice", ["brown rice"], "cup", 195, 218, 4.5, 46, 1.6],
  ["Pasta", ["pasta", "spaghetti", "noodles", "penne", "macaroni"], "cup", 140, 220, 8, 43, 1.3],
  [
    "Mac and cheese",
    ["mac and cheese", "macaroni and cheese", "mac n cheese"],
    "cup",
    200,
    350,
    13,
    45,
    13,
  ],
  [
    "Marinara",
    ["marinara", "pasta sauce", "spaghetti sauce", "tomato sauce"],
    "cup",
    250,
    140,
    4,
    22,
    4,
  ],
  [
    "Potato",
    ["potato", "potatoes", "baked potato", "mashed potatoes"],
    "count",
    173,
    161,
    4.3,
    37,
    0.2,
  ],
  ["Sweet potato", ["sweet potato", "sweet potatoes", "yam"], "count", 114, 103, 2.3, 24, 0.2],
  ["French fries", ["fries", "french fries"], "count", 117, 365, 4, 48, 17],
  [
    "Flour tortilla",
    ["tortilla", "tortillas", "flour tortilla", "wrap"],
    "count",
    49,
    146,
    4,
    25,
    3.6,
  ],
  ["Corn tortilla", ["corn tortilla", "corn tortillas"], "count", 26, 57, 1.5, 12, 0.7],
  ["Quinoa", ["quinoa"], "cup", 185, 222, 8, 39, 3.6],
  [
    "Black beans",
    ["beans", "black beans", "pinto beans", "refried beans"],
    "cup",
    172,
    227,
    15,
    41,
    0.9,
  ],
  ["Lentils", ["lentils"], "cup", 198, 230, 18, 40, 0.8],
  ["Broccoli", ["broccoli"], "cup", 91, 31, 2.5, 6, 0.3],
  [
    "Salad greens",
    ["salad", "side salad", "greens", "lettuce", "mixed greens"],
    "cup",
    47,
    8,
    0.6,
    1.5,
    0.1,
  ],
  [
    "Chicken salad",
    ["chicken salad", "chicken caesar salad", "cobb salad"],
    "count",
    350,
    400,
    32,
    12,
    24,
  ],
  ["Spinach", ["spinach"], "cup", 30, 7, 0.9, 1.1, 0.1],
  ["Carrots", ["carrots", "carrot", "baby carrots"], "cup", 128, 52, 1.2, 12, 0.3],
  ["Green beans", ["green beans"], "cup", 125, 44, 2.4, 10, 0.4],
  ["Corn", ["corn"], "cup", 145, 132, 5, 29, 1.8],
  ["Peas", ["peas"], "cup", 160, 134, 8.6, 25, 0.4],
  ["Tomato", ["tomato", "tomatoes"], "count", 123, 22, 1.1, 4.8, 0.2],
  ["Cucumber", ["cucumber", "cucumbers"], "cup", 104, 16, 0.7, 3.8, 0.1],
  ["Celery", ["celery"], "count", 40, 6, 0.3, 1.2, 0.1],
  [
    "Cheese",
    ["cheese", "cheddar", "cheese slice", "mozzarella", "shredded cheese"],
    "slice",
    28,
    113,
    7,
    0.4,
    9.3,
  ],
  ["String cheese", ["string cheese"], "count", 28, 80, 7, 1, 6],
  ["Cottage cheese", ["cottage cheese"], "cup", 226, 183, 28, 10, 2.5],
  ["Cream cheese", ["cream cheese"], "tbsp", 14.5, 51, 0.9, 0.8, 5],
  ["Butter", ["butter"], "tbsp", 14, 102, 0.1, 0, 11.5],
  ["Olive oil", ["olive oil", "oil"], "tbsp", 13.5, 119, 0, 0, 13.5],
  [
    "Dressing",
    ["ranch", "dressing", "salad dressing", "caesar dressing"],
    "tbsp",
    15,
    65,
    0.2,
    1,
    6.5,
  ],
  ["Mayonnaise", ["mayo", "mayonnaise"], "tbsp", 14, 94, 0.1, 0.1, 10],
  ["Ketchup", ["ketchup"], "tbsp", 17, 20, 0.2, 5, 0],
  ["Salsa", ["salsa"], "tbsp", 16, 5, 0.3, 1, 0],
  ["Guacamole", ["guacamole", "guac"], "tbsp", 15, 25, 0.3, 1.5, 2.2],
  ["Sour cream", ["sour cream"], "tbsp", 12, 28, 0.4, 0.6, 2.8],
  ["Hummus", ["hummus"], "tbsp", 15, 35, 1, 2, 2.5],
  ["Honey", ["honey"], "tbsp", 21, 64, 0, 17, 0],
  ["Syrup", ["syrup", "maple syrup"], "tbsp", 20, 52, 0, 13, 0],
  ["Jam", ["jam", "jelly"], "tbsp", 20, 56, 0, 14, 0],
  ["Sugar", ["sugar"], "tsp", 4, 16, 0, 4, 0],
  [
    "Protein shake",
    ["protein shake", "protein powder", "whey", "shake"],
    "scoop",
    30,
    120,
    24,
    3,
    1.5,
  ],
  ["Protein bar", ["protein bar"], "count", 60, 200, 20, 22, 7],
  ["Granola bar", ["granola bar", "cereal bar"], "count", 42, 190, 4, 29, 7],
  ["Pizza", ["pizza", "slice of pizza", "slices of pizza"], "slice", 107, 285, 12, 36, 10],
  ["Burger", ["burger", "hamburger", "cheeseburger"], "count", 220, 500, 26, 40, 25],
  [
    "Sandwich",
    ["sandwich", "turkey sandwich", "ham sandwich", "sub"],
    "count",
    200,
    350,
    20,
    40,
    10,
  ],
  ["Burrito", ["burrito"], "count", 300, 600, 25, 70, 22],
  ["Taco", ["taco", "tacos"], "count", 100, 170, 9, 13, 9],
  ["Hot dog", ["hot dog", "hot dogs"], "count", 98, 290, 10, 24, 17],
  ["Sushi roll", ["sushi", "sushi roll", "california roll"], "count", 180, 255, 9, 38, 7],
  ["Ramen", ["ramen", "instant noodles"], "count", 85, 380, 8, 52, 14],
  ["Soup", ["soup", "chicken noodle soup"], "cup", 248, 62, 3, 7, 2.4],
  ["Chili", ["chili"], "cup", 256, 260, 18, 22, 11],
  ["Pancake", ["pancake", "pancakes"], "count", 77, 175, 5, 22, 7],
  ["Waffle", ["waffle", "waffles"], "count", 75, 220, 6, 25, 11],
  ["Muffin", ["muffin", "muffins"], "count", 113, 385, 5, 55, 16],
  ["Donut", ["donut", "doughnut", "donuts"], "count", 64, 260, 3, 31, 14],
  ["Cookie", ["cookie", "cookies"], "count", 30, 150, 1.5, 20, 7],
  ["Ice cream", ["ice cream"], "cup", 132, 274, 4.6, 32, 14],
  ["Chocolate", ["chocolate", "candy bar"], "oz", 28, 155, 2, 17, 9],
  ["Chips", ["chips", "potato chips", "tortilla chips"], "oz", 28, 152, 2, 15, 10],
  ["Popcorn", ["popcorn"], "cup", 8, 31, 1, 6, 0.4],
  ["Crackers", ["crackers", "cracker"], "piece", 3, 16, 0.3, 2.2, 0.6],
  ["Jerky", ["jerky", "beef jerky"], "oz", 28, 116, 9.4, 3.1, 7.3],
  ["Smoothie", ["smoothie"], "count", 473, 250, 4, 55, 1.5],
  ["Orange juice", ["orange juice", "oj", "juice"], "cup", 248, 112, 1.7, 26, 0.5],
  ["Soda", ["soda", "coke", "pop", "sprite"], "can", 355, 150, 0, 39, 0],
  ["Diet soda", ["diet soda", "diet coke", "coke zero"], "can", 355, 0, 0, 0, 0],
  ["Hot chocolate", ["hot chocolate", "hot cocoa"], "cup", 250, 190, 8, 27, 6],
  ["Herbal tea", ["herbal tea", "tea"], "cup", 240, 2, 0, 0.5, 0],
  ["Water", ["water", "sparkling water"], "cup", 240, 0, 0, 0, 0],
];

const UNIT_WORDS: Record<string, Unit> = {
  cup: "cup",
  cups: "cup",
  glass: "cup",
  glasses: "cup",
  bowl: "cup",
  bowls: "cup",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbsp: "tbsp",
  tsp: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  g: "g",
  gram: "g",
  grams: "g",
  lb: "oz",
  lbs: "oz",
  pound: "oz",
  pounds: "oz",
  slice: "slice",
  slices: "slice",
  strip: "slice",
  strips: "slice",
  piece: "piece",
  pieces: "piece",
  scoop: "scoop",
  scoops: "scoop",
  can: "can",
  cans: "can",
  serving: "count",
  servings: "count",
  handful: "oz",
  handfuls: "oz",
};
/** Spoken units that stand for a multiple of their base unit. */
const UNIT_SCALE: Record<string, number> = {
  bowl: 1.5,
  bowls: 1.5,
  lb: 16,
  lbs: 16,
  pound: 16,
  pounds: 16,
};
const CUPS_PER_UNIT: Partial<Record<Unit, number>> = { cup: 1, tbsp: 1 / 16, tsp: 1 / 48 };
const GRAMS_PER_UNIT: Partial<Record<Unit, number>> = { g: 1, oz: 28.35 };

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  couple: 2,
  few: 3,
  some: 1,
  half: 0.5,
  quarter: 0.25,
  dozen: 12,
  double: 2,
};

interface FoodEntry {
  readonly row: FoodRow;
  readonly alias: string;
}

const FOOD_ALIASES: readonly FoodEntry[] = FOODS.flatMap((row) =>
  [row[0].toLowerCase(), ...row[1]].map((alias) => ({ row, alias })),
).toSorted((left, right) => right.alias.length - left.alias.length);

const JOINED_ALIASES = FOOD_ALIASES.filter((entry) => / and | n /.test(entry.alias));

const round = (value: number) => Math.round(value);
const round1 = (value: number) => Math.round(value * 10) / 10;

const FRACTION_WORD = /^(\d+)\/(\d+)$/;

function wordValue(word: string): number | null {
  const fraction = FRACTION_WORD.exec(word);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  if (/^\d+(\.\d+)?$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? null;
}

/** Leading amount: "two", "half an", "one and a half", "2 1/2", "a couple". */
function parseQuantity(words: readonly string[]): { quantity: number; used: number } {
  let whole: number | null = null;
  let fraction: number | null = null;
  let used = 0;
  for (; used < words.length; used += 1) {
    const word = words[used]!;
    if (word === "a" || word === "an") continue;
    if (word === "and" && whole !== null && wordValue(words[used + 1] ?? "") !== null) continue;
    const value = wordValue(word);
    if (value === null) break;
    if (value < 1) fraction = value;
    else whole = value;
  }
  if (whole === null && fraction === null) return { quantity: 1, used };
  return { quantity: (whole ?? 0) + (fraction ?? 0), used };
}

/** Base units a bare mention means: "chicken" is a cooked piece, not one ounce. */
const BARE_PORTION: Record<string, number> = {
  "Chicken breast": 5,
  "Ground beef": 4,
  Steak: 6,
  Salmon: 5,
  Shrimp: 4,
  Turkey: 2,
  Ham: 2,
  "Salad greens": 2,
};

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : String(round1(value));
}

function unitLabel(unit: Unit, amount: number): string {
  if (unit === "oz" || unit === "g" || unit === "tbsp" || unit === "tsp") return unit;
  return amount === 1 ? unit : `${unit}s`;
}

function portionLabel(quantity: number, spokenUnit: string | null, row: FoodRow): string {
  if (spokenUnit) return `${formatAmount(quantity)} ${spokenUnit}`;
  const bare = BARE_PORTION[row[0]];
  const amount = quantity * (bare ?? 1);
  if (row[2] === "count") return formatAmount(amount);
  return `${formatAmount(amount)} ${unitLabel(row[2], amount)}`;
}

/** Portions of a food's base unit that `quantity spokenUnit` amounts to. */
function unitMultiplier(quantity: number, spoken: string | null, row: FoodRow): number {
  const base = row[2];
  if (!spoken) return quantity * (BARE_PORTION[row[0]] ?? 1);
  const unit = UNIT_WORDS[spoken]!;
  const amount = quantity * (UNIT_SCALE[spoken] ?? 1);
  if (unit === base) return amount;
  const spokenGrams = GRAMS_PER_UNIT[unit];
  if (spokenGrams) return (amount * spokenGrams) / row[3];
  const spokenCups = CUPS_PER_UNIT[unit];
  const baseCups = CUPS_PER_UNIT[base];
  if (spokenCups && baseCups) return (amount * spokenCups) / baseCups;
  return amount;
}

function scaleRow(row: FoodRow, multiplier: number): Macros {
  return {
    kcal: round(row[4] * multiplier),
    protein: round1(row[5] * multiplier),
    carbs: round1(row[6] * multiplier),
    fat: round1(row[7] * multiplier),
  };
}

const LEAD_IN =
  /^(?:(?:so|um+|uh+|okay|ok|well|and|then|also)\s+)*(?:for (?:breakfast|lunch|dinner|supper|a snack|snack)\s*,?\s*)?(?:i\s+(?:just\s+)?(?:had|ate|have|got|grabbed|drank|am having)\s+)?(?:for (?:breakfast|lunch|dinner|supper|a snack|snack)\s*,?\s*)?/;

/** Where `alias` ends in `text`, or -1. */
function aliasEnd(text: string, alias: string): number {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&");
  const match = new RegExp(`(?:^|[^a-z])(${escaped}(?:e?s)?)(?=$|[^a-z])`).exec(text);
  return match ? match.index + match[0].length : -1;
}

/**
 * The food a phrase names. English puts the head noun last ("chicken burrito"
 * is a burrito), so the alias ending latest wins, then the longest.
 */
function matchFood(text: string): FoodEntry | undefined {
  let best: { entry: FoodEntry; end: number } | undefined;
  for (const entry of FOOD_ALIASES) {
    const end = aliasEnd(text, entry.alias);
    if (end < 0) continue;
    if (
      !best ||
      end > best.end ||
      (end === best.end && entry.alias.length > best.entry.alias.length)
    ) {
      best = { entry, end };
    }
  }
  return best?.entry;
}

function parseChunk(chunk: string, makeId: () => string): FoodItem | null {
  const cleaned = chunk
    .replace(LEAD_IN, "")
    .replace(
      /\b(of|some|like|about|maybe|around|roughly|big|small|large|medium|little|huge|full|regular|the)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  const words = cleaned.split(" ");
  const { quantity, used } = parseQuantity(words);
  let rest = words.slice(used);
  let spokenUnit: string | null = null;
  const first = rest[0];
  if (first && first in UNIT_WORDS) {
    spokenUnit = first;
    rest = rest.slice(1);
  }
  const numberWithUnit = /^(\d+(?:\.\d+)?)(g|oz)$/.exec(words[0] ?? "");
  let amount = quantity;
  if (numberWithUnit) {
    amount = Number(numberWithUnit[1]);
    spokenUnit = numberWithUnit[2]!;
    rest = words.slice(1);
  }
  const foodText = rest.join(" ").replace(/_and_/g, " and ");
  if (!foodText) return null;
  const match = matchFood(` ${foodText} `);
  if (!match) {
    return {
      id: makeId(),
      name: capitalize(foodText),
      portion: spokenUnit ? `${amount} ${spokenUnit}` : String(amount),
      kcal: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      matched: false,
    };
  }
  const multiplier = unitMultiplier(amount, spokenUnit, match.row);
  return {
    id: makeId(),
    name: match.row[0],
    portion: portionLabel(amount, spokenUnit, match.row),
    ...scaleRow(match.row, multiplier),
    matched: true,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Turns "two eggs, toast with butter and a banana" into food rows. */
export function estimateMeal(text: string, makeId: () => string): FoodItem[] {
  let normalized = ` ${text.toLowerCase().replace(/[’']/g, "'")} `.replace(
    /\b(\d+|one|two|three|four|five|six)\s+and\s+a\s+half\b/g,
    (_match, whole: string) => String((NUMBER_WORDS[whole] ?? Number(whole)) + 0.5),
  );
  for (const entry of JOINED_ALIASES) {
    normalized = normalized.replaceAll(` ${entry.alias} `, ` ${entry.alias.replace(/ /g, "_")} `);
  }
  return normalized
    .split(/,|;|\.(?!\d)|\n|\band\b|\bwith\b|\bplus\b|\balong with\b|\bthen\b|\bon the side\b/)
    .map((chunk) => chunk.replace(/_/g, " ").trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => parseChunk(chunk, makeId))
    .filter((item): item is FoodItem => item !== null && !/^(i|and|then|also)$/i.test(item.name));
}

export function inferMealSlot(text: string, at: Date): MealSlot {
  const lower = text.toLowerCase();
  if (/\bbreakfast\b/.test(lower)) return "breakfast";
  if (/\blunch\b/.test(lower)) return "lunch";
  if (/\b(dinner|supper)\b/.test(lower)) return "dinner";
  if (/\bsnack\b/.test(lower)) return "snack";
  const hour = at.getHours();
  if (hour < 11) return "breakfast";
  if (hour < 16) return "lunch";
  return "dinner";
}

export const ZERO_MACROS: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export function sumMacros(items: readonly Macros[]): Macros {
  const total = items.reduce(
    (sum, item) => ({
      kcal: sum.kcal + (Number(item.kcal) || 0),
      protein: sum.protein + (Number(item.protein) || 0),
      carbs: sum.carbs + (Number(item.carbs) || 0),
      fat: sum.fat + (Number(item.fat) || 0),
    }),
    ZERO_MACROS,
  );
  return {
    kcal: round(total.kcal),
    protein: round1(total.protein),
    carbs: round1(total.carbs),
    fat: round1(total.fat),
  };
}

export interface FoodDay {
  readonly date: string;
  readonly meals: ReadonlyArray<{
    readonly slot: MealSlot;
    readonly meals: readonly Meal[];
    readonly totals: Macros;
  }>;
  readonly consumed: Macros;
  readonly goals: Macros;
  /** Goal minus consumed; negative once over. */
  readonly remaining: Macros;
}

/** The day table: each meal slot with its totals, then consumed and remaining against goals. */
export function foodDay(meals: readonly Meal[], date: string, goals: Macros): FoodDay {
  const today = meals.filter((meal) => meal.date === date);
  const bySlot = MEAL_SLOTS.map((slot) => {
    const slotMeals = today.filter((meal) => meal.slot === slot);
    return { slot, meals: slotMeals, totals: sumMacros(slotMeals.flatMap((meal) => meal.items)) };
  }).filter((group) => group.meals.length > 0);
  const consumed = sumMacros(today.flatMap((meal) => meal.items));
  return {
    date,
    meals: bySlot,
    consumed,
    goals,
    remaining: {
      kcal: round(goals.kcal - consumed.kcal),
      protein: round1(goals.protein - consumed.protein),
      carbs: round1(goals.carbs - consumed.carbs),
      fat: round1(goals.fat - consumed.fat),
    },
  };
}

/** Normalizes a model's food rows, dropping anything without a name. */
export function foodItemsFromAi(value: unknown, makeId: () => string): FoodItem[] | null {
  const items = (value as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  const rows = items.flatMap((raw): FoodItem[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) return [];
    const number = (key: string) => Math.max(0, Number(item[key]) || 0);
    return [
      {
        id: makeId(),
        name: capitalize(name),
        portion: typeof item.portion === "string" ? item.portion : "",
        kcal: round(number("kcal")),
        protein: round1(number("protein")),
        carbs: round1(number("carbs")),
        fat: round1(number("fat")),
        matched: true,
      },
    ];
  });
  return rows.length > 0 ? rows : null;
}
