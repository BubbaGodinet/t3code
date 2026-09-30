import { DAILY_VERSES } from "./sanctuaryDailyVerses";

/**
 * The Latter-day Saint standard works. Verse text is vendored under
 * `public/sanctuary/scriptures` from public-domain editions; the Church's
 * copyrighted chapter headings and footnotes are not included, so each chapter
 * links out to Gospel Library for those.
 */
export const SCRIPTURE_VOLUMES = [
  { id: "old-testament", title: "Old Testament", group: "Holy Bible (KJV)", slug: "ot" },
  { id: "new-testament", title: "New Testament", group: "Holy Bible (KJV)", slug: "nt" },
  { id: "book-of-mormon", title: "Book of Mormon", group: "Book of Mormon", slug: "bofm" },
  {
    id: "doctrine-and-covenants",
    title: "Doctrine and Covenants",
    group: "Doctrine and Covenants",
    slug: "dc-testament",
  },
  {
    id: "pearl-of-great-price",
    title: "Pearl of Great Price",
    group: "Pearl of Great Price",
    slug: "pgp",
  },
] as const;

export type ScriptureVolumeId = (typeof SCRIPTURE_VOLUMES)[number]["id"];

/** One volume: books of chapters of verses. Verse n is at index n - 1. */
export interface ScriptureVolume {
  readonly volume: string;
  readonly books: ReadonlyArray<
    readonly [name: string, chapters: ReadonlyArray<readonly string[]>]
  >;
}

export interface ScripturePlace {
  readonly volume: ScriptureVolumeId;
  readonly book: string;
  readonly chapter: number;
  readonly verse?: number;
}

const GOSPEL_LIBRARY_BOOKS: Record<string, string> = {
  Genesis: "gen",
  Exodus: "ex",
  Leviticus: "lev",
  Numbers: "num",
  Deuteronomy: "deut",
  Joshua: "josh",
  Judges: "judg",
  Ruth: "ruth",
  "1 Samuel": "1-sam",
  "2 Samuel": "2-sam",
  "1 Kings": "1-kgs",
  "2 Kings": "2-kgs",
  "1 Chronicles": "1-chr",
  "2 Chronicles": "2-chr",
  Ezra: "ezra",
  Nehemiah: "neh",
  Esther: "esth",
  Job: "job",
  Psalms: "ps",
  Proverbs: "prov",
  Ecclesiastes: "eccl",
  "Song of Solomon": "song",
  Isaiah: "isa",
  Jeremiah: "jer",
  Lamentations: "lam",
  Ezekiel: "ezek",
  Daniel: "dan",
  Hosea: "hosea",
  Joel: "joel",
  Amos: "amos",
  Obadiah: "obad",
  Jonah: "jonah",
  Micah: "micah",
  Nahum: "nahum",
  Habakkuk: "hab",
  Zephaniah: "zeph",
  Haggai: "hag",
  Zechariah: "zech",
  Malachi: "mal",
  Matthew: "matt",
  Mark: "mark",
  Luke: "luke",
  John: "john",
  Acts: "acts",
  Romans: "rom",
  "1 Corinthians": "1-cor",
  "2 Corinthians": "2-cor",
  Galatians: "gal",
  Ephesians: "eph",
  Philippians: "philip",
  Colossians: "col",
  "1 Thessalonians": "1-thes",
  "2 Thessalonians": "2-thes",
  "1 Timothy": "1-tim",
  "2 Timothy": "2-tim",
  Titus: "titus",
  Philemon: "philem",
  Hebrews: "heb",
  James: "james",
  "1 Peter": "1-pet",
  "2 Peter": "2-pet",
  "1 John": "1-jn",
  "2 John": "2-jn",
  "3 John": "3-jn",
  Jude: "jude",
  Revelation: "rev",
  "1 Nephi": "1-ne",
  "2 Nephi": "2-ne",
  Jacob: "jacob",
  Enos: "enos",
  Jarom: "jarom",
  Omni: "omni",
  "Words of Mormon": "w-of-m",
  Mosiah: "mosiah",
  Alma: "alma",
  Helaman: "hel",
  "3 Nephi": "3-ne",
  "4 Nephi": "4-ne",
  Mormon: "morm",
  Ether: "ether",
  Moroni: "moro",
  "D&C": "dc",
  Moses: "moses",
  Abraham: "abr",
  "Joseph Smith—Matthew": "js-m",
  "Joseph Smith—History": "js-h",
  "Articles of Faith": "a-of-f",
};

export function scriptureVolumeMeta(id: ScriptureVolumeId) {
  return SCRIPTURE_VOLUMES.find((volume) => volume.id === id) ?? SCRIPTURE_VOLUMES[0];
}

export function gospelLibraryUrl(place: ScripturePlace): string {
  const volume = scriptureVolumeMeta(place.volume);
  const book = GOSPEL_LIBRARY_BOOKS[place.book] ?? "";
  const base = `https://www.churchofjesuschrist.org/study/scriptures/${volume.slug}/${book}/${place.chapter}?lang=eng`;
  return place.verse ? `${base}&id=p${place.verse}#p${place.verse}` : base;
}

/** "Alma 32:21", "D&C 4", "Psalm 23:1". */
export function scriptureReference(place: ScripturePlace): string {
  const book = place.book === "Psalms" && place.verse ? "Psalm" : place.book;
  return place.verse ? `${book} ${place.chapter}:${place.verse}` : `${book} ${place.chapter}`;
}

/** Single-chapter books read as the book alone; D&C chapters are sections. */
export function chapterLabel(place: ScripturePlace, chapterCount: number): string {
  if (place.volume === "doctrine-and-covenants") return `Section ${place.chapter}`;
  if (chapterCount === 1) return place.book;
  return `${place.book} ${place.chapter}`;
}

const volumeCache = new Map<ScriptureVolumeId, Promise<ScriptureVolume>>();

export function loadScriptureVolume(id: ScriptureVolumeId): Promise<ScriptureVolume> {
  const cached = volumeCache.get(id);
  if (cached) return cached;
  const loading = fetch(`/sanctuary/scriptures/${id}.json`).then((response) => {
    if (!response.ok) throw new Error(`Scripture volume ${id} is missing.`);
    return response.json() as Promise<ScriptureVolume>;
  });
  loading.catch(() => volumeCache.delete(id));
  volumeCache.set(id, loading);
  return loading;
}

export interface DailyVerse extends ScripturePlace {
  readonly verse: number;
  readonly text: string;
}

/** The same verse all day, a different one each day, cycling the curated list. */
export function verseOfTheDay(date: Date): DailyVerse {
  const dayNumber = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000,
  );
  const index = ((dayNumber % DAILY_VERSES.length) + DAILY_VERSES.length) % DAILY_VERSES.length;
  const [volume, book, chapter, verse, text] = DAILY_VERSES[index]!;
  return { volume, book, chapter, verse, text };
}

/** The chapter after (or before) `place`, crossing books but not volumes. */
export function adjacentChapter(
  volume: ScriptureVolume,
  place: ScripturePlace,
  step: 1 | -1,
): ScripturePlace | null {
  const bookIndex = volume.books.findIndex(([name]) => name === place.book);
  if (bookIndex < 0) return null;
  const chapterCount = volume.books[bookIndex]![1].length;
  const chapter = place.chapter + step;
  if (chapter >= 1 && chapter <= chapterCount)
    return { volume: place.volume, book: place.book, chapter };
  const nextBook = volume.books[bookIndex + step];
  if (!nextBook) return null;
  return {
    volume: place.volume,
    book: nextBook[0],
    chapter: step === 1 ? 1 : nextBook[1].length,
  };
}
