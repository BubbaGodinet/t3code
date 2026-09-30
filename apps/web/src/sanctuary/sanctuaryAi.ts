import { foodItemsFromAi, type FoodItem } from "./sanctuaryFood";
import { newId } from "./sanctuaryModel";
import { rambleSortFromAi, type RambleSort } from "./sanctuarySort";
import { sanctuaryDesktop, useSanctuaryStore } from "./sanctuaryStore";

/**
 * Optional refinement after Echo's instant local pass. On-device first (the
 * browser's built-in model, when the runtime ships one), then Claude through
 * the desktop app only if ANTHROPIC_API_KEY is already set. Never a T3 thread.
 */
export type RefinedBy = "on-device" | "claude";

const ON_DEVICE_PROMPTS = {
  food: 'Estimate nutrition for this meal. Reply with only JSON: {"items":[{"name":string,"portion":string,"kcal":number,"protein":number,"carbs":number,"fat":number}]}. Meal: ',
  ramble:
    'Sort this brain dump. Reply with only JSON: {"onMind":string[],"tasks":string[]}. tasks are concrete to-dos as short imperatives; onMind is everything else. Do not invent anything. Text: ',
} as const;

interface OnDeviceModel {
  availability(): Promise<string>;
  create(): Promise<{ prompt(text: string): Promise<string>; destroy(): void }>;
}

async function askOnDevice(task: "food" | "ramble", text: string): Promise<unknown> {
  const model = (globalThis as { LanguageModel?: OnDeviceModel }).LanguageModel;
  if (!model || (await model.availability().catch(() => "unavailable")) !== "available")
    return null;
  const session = await model.create();
  try {
    const reply = await session.prompt(`${ON_DEVICE_PROMPTS[task]}${text}`);
    return JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1));
  } catch {
    return null;
  } finally {
    session.destroy();
  }
}

async function ask(
  task: "food" | "ramble",
  text: string,
): Promise<{ value: unknown; by: RefinedBy } | null> {
  const local = await askOnDevice(task, text).catch(() => null);
  if (local) return { value: local, by: "on-device" };
  const bridge = sanctuaryDesktop();
  if (!bridge || !useSanctuaryStore.getState().capabilities.claude) return null;
  const remote = await bridge.ai(task, text).catch(() => null);
  return remote ? { value: remote, by: "claude" } : null;
}

export async function refineMeal(
  text: string,
): Promise<{ items: FoodItem[]; by: RefinedBy } | null> {
  const answer = await ask("food", text);
  const items = answer ? foodItemsFromAi(answer.value, newId) : null;
  return answer && items ? { items, by: answer.by } : null;
}

export async function refineRamble(
  text: string,
): Promise<{ sorted: RambleSort; by: RefinedBy } | null> {
  const answer = await ask("ramble", text);
  const sorted = answer ? rambleSortFromAi(answer.value) : null;
  return answer && sorted ? { sorted, by: answer.by } : null;
}
