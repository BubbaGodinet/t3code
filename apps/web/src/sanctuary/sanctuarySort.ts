/**
 * Local sorting for Echo. Ramble splits into "on my mind" notes and tasks;
 * gratitude only gets tidied. Both run instantly and offline; a model, when
 * one is available, may refine a ramble afterwards.
 */

export interface RambleSort {
  readonly onMind: string[];
  readonly tasks: string[];
}

const ACTION_VERBS =
  "call|email|text|message|buy|pick up|drop off|schedule|book|pay|send|finish|fix|clean|make|write|order|return|renew|sign|submit|cancel|check|get|take|plan|prep|reply|respond|follow up|mow|wash|file|print|mail|visit|ask|tell|review|update|register|research|read|study|pray|practice|start|set up|sort|organize|move|bring|grab|charge|refill";

const FILLER = String.raw`(?:(?:and|so|also|oh|okay|ok|um+|uh+|then|plus|well)\s*,?\s+)*`;

const TASK_LEAD_IN = new RegExp(
  `^${FILLER}(?:${[
    String.raw`i\s+(?:really\s+|still\s+|also\s+)?(?:need|have|got|gotta|should|must|want|ought)\s+to\s+`,
    String.raw`i\s+(?:really\s+)?(?:should|must|gotta)\s+(?=(?:${ACTION_VERBS})\b)`,
    String.raw`i(?:'ll| will)\s+(?:need\s+to\s+)?`,
    String.raw`(?:don't|do not|dont)\s+forget\s+to\s+`,
    String.raw`remember\s+to\s+`,
    String.raw`remind\s+me\s+to\s+`,
    String.raw`need\s+to\s+`,
    String.raw`have\s+to\s+`,
    String.raw`gotta\s+`,
    String.raw`(?:to\s*do|todo)\s*:?\s+`,
    String.raw`(?:tomorrow|today|tonight|this week)\s*,?\s+i\s+(?:need|have|want|should)\s+to\s+`,
  ].join("|")})`,
  "i",
);
const LEADING_FILLER = new RegExp(`^${FILLER}`, "i");

const IMPERATIVE = new RegExp(`^(?:${ACTION_VERBS})\\b`, "i");
const SECOND_TASK = new RegExp(`,?\\s+and\\s+(?=(?:${ACTION_VERBS})\\b)`, "i");

function tidy(text: string): string {
  const trimmed = text
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "")
    .trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function sentences(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+|;\s*|\s+(?:and then|also|oh and|plus)\s+/i)
    .map((sentence) => sentence.replace(/[.!?]+$/, "").trim())
    .filter((sentence) => sentence.length > 0);
}

/** Ramble to notes and tasks. Every sentence lands in exactly one list. */
export function sortRamble(text: string): RambleSort {
  const onMind: string[] = [];
  const tasks: string[] = [];
  for (const sentence of sentences(text)) {
    const leadIn = TASK_LEAD_IN.exec(sentence);
    const body = leadIn ? sentence.slice(leadIn[0].length) : sentence;
    if (leadIn || IMPERATIVE.test(sentence.replace(LEADING_FILLER, ""))) {
      for (const task of body.split(SECOND_TASK)) {
        const cleaned = tidy(task);
        if (cleaned) tasks.push(cleaned);
      }
      continue;
    }
    const note = tidy(sentence.replace(LEADING_FILLER, ""));
    if (note.split(" ").length >= 2) onMind.push(note);
  }
  return { onMind, tasks };
}

/** Light cleanup for a gratitude entry: fillers, spacing, capitals, a closing period. */
export function tidyGratitude(text: string): string {
  let cleaned = text
    .replace(/\r/g, "")
    .replace(/\b(?:um+|uh+|like,)\s*/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\bi\b/g, "I")
    .replace(/\bi'(m|ve|ll|d)\b/gi, (_match, rest: string) => `I'${rest.toLowerCase()}`)
    .trim();
  cleaned = cleaned.replace(
    /(^|[.!?]\s+|\n)([a-z])/g,
    (_match, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`,
  );
  if (cleaned && !/[.!?]$/.test(cleaned)) cleaned += ".";
  return cleaned;
}

/** Normalizes a model's ramble sort; null when it is not usable. */
export function rambleSortFromAi(value: unknown): RambleSort | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const strings = (key: string) =>
    Array.isArray(record[key])
      ? (record[key] as unknown[])
          .filter((item): item is string => typeof item === "string")
          .map(tidy)
          .filter(Boolean)
      : null;
  const onMind = strings("onMind");
  const tasks = strings("tasks");
  if (!onMind || !tasks || onMind.length + tasks.length === 0) return null;
  return { onMind, tasks };
}
