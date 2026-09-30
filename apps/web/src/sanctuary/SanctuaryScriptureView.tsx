import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../lib/utils";
import {
  adjacentChapter,
  chapterLabel,
  gospelLibraryUrl,
  loadScriptureVolume,
  SCRIPTURE_VOLUMES,
  scriptureVolumeMeta,
  type ScripturePlace,
  type ScriptureVolume,
  type ScriptureVolumeId,
} from "./sanctuaryScripture";
import { useSanctuaryStore } from "./sanctuaryStore";
import {
  EmptyNote,
  SanctuaryButton,
  SanctuaryDetail,
  SectionTitle,
  glassTile,
  openExternal,
} from "./SanctuaryUi";

type Level =
  | { readonly kind: "volumes" }
  | { readonly kind: "books"; readonly volume: ScriptureVolumeId }
  | { readonly kind: "chapters"; readonly volume: ScriptureVolumeId; readonly book: string }
  | { readonly kind: "reader"; readonly place: ScripturePlace };

function useVolume(id: ScriptureVolumeId | null) {
  const [state, setState] = useState<{
    id: ScriptureVolumeId;
    volume: ScriptureVolume | null;
  } | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    loadScriptureVolume(id).then(
      (volume) => !cancelled && setState({ id, volume }),
      () => !cancelled && setState({ id, volume: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);
  const current = state?.id === id ? state : null;
  return { volume: current?.volume ?? null, failed: current !== null && current.volume === null };
}

/** The standard works: volume, book, chapter, then the chapter itself. Remembers where you were. */
export function SanctuaryScripture({
  onBack,
  initial,
}: {
  onBack: () => void;
  initial: ScripturePlace | null;
}) {
  const savedPlace = useSanctuaryStore((state) => state.document.scripture.place);
  const update = useSanctuaryStore((state) => state.update);
  const [level, setLevel] = useState<Level>(() => {
    const place = initial ?? savedPlace;
    return place ? { kind: "reader", place } : { kind: "volumes" };
  });

  const volumeId =
    level.kind === "volumes" ? null : level.kind === "reader" ? level.place.volume : level.volume;
  const { volume, failed } = useVolume(volumeId);

  const openChapter = (place: ScripturePlace) => {
    setLevel({ kind: "reader", place });
    update((document) => ({
      ...document,
      scripture: { place: { volume: place.volume, book: place.book, chapter: place.chapter } },
    }));
  };

  const up = () => {
    if (level.kind === "reader")
      setLevel({ kind: "chapters", volume: level.place.volume, book: level.place.book });
    else if (level.kind === "chapters") setLevel({ kind: "books", volume: level.volume });
    else if (level.kind === "books") setLevel({ kind: "volumes" });
    else onBack();
  };

  const title =
    level.kind === "volumes"
      ? "Scriptures"
      : level.kind === "books"
        ? scriptureVolumeMeta(level.volume).title
        : level.kind === "chapters"
          ? level.book
          : "Scriptures";

  return (
    <SanctuaryDetail
      title={title}
      onBack={onBack}
      actions={
        level.kind !== "volumes" ? (
          <SanctuaryButton onClick={up}>
            <ChevronLeftIcon className="size-4" />
            {level.kind === "reader" ? "Chapters" : level.kind === "chapters" ? "Books" : "Volumes"}
          </SanctuaryButton>
        ) : null
      }
    >
      {level.kind === "volumes" ? (
        <VolumeList
          savedPlace={savedPlace}
          onVolume={(id) => setLevel({ kind: "books", volume: id })}
          onResume={openChapter}
        />
      ) : failed ? (
        <EmptyNote>This volume could not be opened. Reload ARGUS and try again.</EmptyNote>
      ) : !volume ? (
        <EmptyNote>Opening {scriptureVolumeMeta(volumeId!).title}…</EmptyNote>
      ) : level.kind === "books" ? (
        <BookList
          volume={volume}
          onBook={(book, chapters) =>
            chapters === 1
              ? openChapter({ volume: level.volume, book, chapter: 1 })
              : setLevel({ kind: "chapters", volume: level.volume, book })
          }
        />
      ) : level.kind === "chapters" ? (
        <ChapterGrid
          volume={volume}
          volumeId={level.volume}
          book={level.book}
          current={savedPlace}
          onChapter={openChapter}
        />
      ) : (
        <ChapterReader volume={volume} place={level.place} onPlace={openChapter} />
      )}
    </SanctuaryDetail>
  );
}

function VolumeList({
  savedPlace,
  onVolume,
  onResume,
}: {
  savedPlace: ScripturePlace | null;
  onVolume: (id: ScriptureVolumeId) => void;
  onResume: (place: ScripturePlace) => void;
}) {
  const groups = [...new Set(SCRIPTURE_VOLUMES.map((volume) => volume.group))];
  return (
    <div className="mx-auto max-w-2xl">
      {savedPlace ? (
        <button
          type="button"
          onClick={() => onResume(savedPlace)}
          className={cn(
            glassTile,
            "mb-8 flex w-full items-center justify-between px-5 py-4 text-left hover:bg-white/8",
          )}
        >
          <span>
            <span className="block text-xs text-white/55">Continue reading</span>
            <span className="mt-1 block text-base text-white">{chapterLabel(savedPlace, 0)}</span>
          </span>
          <ChevronRightIcon className="size-4 text-white/50" />
        </button>
      ) : null}
      {groups.map((group) => (
        <div key={group}>
          <SectionTitle>{group}</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCRIPTURE_VOLUMES.filter((volume) => volume.group === group).map((volume) => (
              <button
                key={volume.id}
                type="button"
                onClick={() => onVolume(volume.id)}
                className={cn(glassTile, "px-5 py-4 text-left text-white hover:bg-white/8")}
              >
                {volume.title}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="mt-8 text-xs leading-5 text-white/40">
        Verse text from public-domain editions, kept on this device. Chapter headings, footnotes,
        and study helps are in Gospel Library.
      </p>
    </div>
  );
}

function BookList({
  volume,
  onBook,
}: {
  volume: ScriptureVolume;
  onBook: (book: string, chapters: number) => void;
}) {
  return (
    <div className="mx-auto grid max-w-3xl gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {volume.books.map(([name, chapters]) => (
        <button
          key={name}
          type="button"
          onClick={() => onBook(name, chapters.length)}
          className={cn(
            glassTile,
            "flex items-center justify-between px-4 py-3 text-left text-sm text-white hover:bg-white/8",
          )}
        >
          {name === "D&C" ? "Doctrine and Covenants" : name}
          <span className="text-xs text-white/40">{chapters.length}</span>
        </button>
      ))}
    </div>
  );
}

function ChapterGrid({
  volume,
  volumeId,
  book,
  current,
  onChapter,
}: {
  volume: ScriptureVolume;
  volumeId: ScriptureVolumeId;
  book: string;
  current: ScripturePlace | null;
  onChapter: (place: ScripturePlace) => void;
}) {
  const chapters = volume.books.find(([name]) => name === book)?.[1] ?? [];
  return (
    <div className="mx-auto max-w-3xl">
      {volumeId === "doctrine-and-covenants" ? <SectionTitle>Sections</SectionTitle> : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-2">
        {chapters.map((_verses, index) => {
          const chapter = index + 1;
          const here = current?.book === book && current.chapter === chapter;
          return (
            <button
              key={chapter}
              type="button"
              onClick={() => onChapter({ volume: volumeId, book, chapter })}
              className={cn(
                "h-11 rounded-xl border text-sm transition-colors",
                here
                  ? "border-white/60 bg-white/15 text-white"
                  : "border-white/10 text-white/80 hover:bg-white/10",
              )}
            >
              {chapter}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChapterReader({
  volume,
  place,
  onPlace,
}: {
  volume: ScriptureVolume;
  place: ScripturePlace;
  onPlace: (place: ScripturePlace) => void;
}) {
  const top = useRef<HTMLDivElement>(null);
  const highlighted = useRef<HTMLParagraphElement>(null);
  const book = volume.books.find(([name]) => name === place.book);
  const verses = book?.[1][place.chapter - 1] ?? [];
  const previous = adjacentChapter(volume, place, -1);
  const next = adjacentChapter(volume, place, 1);

  useEffect(() => {
    const target = place.verse ? highlighted.current : top.current;
    target?.scrollIntoView({ block: place.verse ? "center" : "start" });
  }, [place]);

  if (!book || verses.length === 0)
    return <EmptyNote>That chapter is not in this volume.</EmptyNote>;

  return (
    <article className="mx-auto max-w-2xl" ref={top}>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-serif text-2xl text-white">{chapterLabel(place, book[1].length)}</h3>
        <SanctuaryButton onClick={() => openExternal(gospelLibraryUrl(place))}>
          Open in Gospel Library
          <ExternalLinkIcon className="size-3.5" />
        </SanctuaryButton>
      </header>
      <div className="space-y-3 font-serif text-[1.05rem] leading-8 text-white/90">
        {verses.map((text, index) => {
          const verse = index + 1;
          const isHighlighted = place.verse === verse;
          return (
            <p
              key={verse}
              ref={isHighlighted ? highlighted : undefined}
              className={cn("rounded-lg px-2 -mx-2", isHighlighted && "bg-white/10")}
            >
              <sup className="mr-1.5 font-sans text-[0.65rem] text-white/45">{verse}</sup>
              {text}
            </p>
          );
        })}
      </div>
      <footer className="mt-10 flex items-center justify-between">
        {previous ? (
          <SanctuaryButton onClick={() => onPlace(previous)}>
            <ChevronLeftIcon className="size-4" />
            {chapterLabel(previous, 0)}
          </SanctuaryButton>
        ) : (
          <span />
        )}
        {next ? (
          <SanctuaryButton onClick={() => onPlace(next)}>
            {chapterLabel(next, 0)}
            <ChevronRightIcon className="size-4" />
          </SanctuaryButton>
        ) : null}
      </footer>
    </article>
  );
}
