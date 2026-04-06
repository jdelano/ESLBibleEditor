/// <reference types="vite/client" />

import {
  ChapterSummary,
  ExportJob,
  ExportJobMode,
  ExportScopeType,
  MediaLibraryAsset,
  PublishManifest,
  ValidationIssue,
  Verse,
  createId,
  exportJobSchema,
  mediaLibraryAssetSchema,
  publishManifestSchema,
  summarizeValidationState,
  tokenizeSourceText,
  validateVerse,
  verseSchema
} from "@schema/index";
import { autoTagTokens } from "./tagging";

type ReferenceChapter = {
  chapter: number;
  verses: number;
};

type ReferenceBook = {
  abbr: string;
  book: string;
  chapters: ReferenceChapter[];
};

type KJVVerseRecord = {
  book: string;
  chapter: number;
  verse: number;
  text: string;
};

type NavigationVerseState = "saved" | "generated";

type NavigationData = {
  books: Array<{
    abbr: string;
    book: string;
    chapterCount: number;
    savedVerseCount: number;
    chapters: Array<{
      chapter: number;
      verseCount: number;
      savedVerseCount: number;
      verses: Array<{
        verseId: string;
        verse: number;
        status: string;
        validationState: "valid" | "warning" | "error";
        revisionCount: number;
        state: NavigationVerseState;
      }>;
    }>;
  }>;
};

type DashboardData = {
  chapters: ChapterSummary[];
  mediaLibraryCount: number;
  exportJobs: ExportJob[];
};

type VerseContext = {
  verse: Verse;
  validationIssues: ValidationIssue[];
};

type ExportJobDetails = {
  job: ExportJob;
  manifest: PublishManifest | null;
};

type ExportPackagePayload = {
  manifest: PublishManifest;
  verses: Verse[];
  appReady: {
    scopeType: ExportScopeType;
    book: string;
    chapter?: number;
    verses: Array<{
      verseId: string;
      reference: Verse["reference"];
      sourceText: string;
      tokens: Array<{
        id: string;
        text: string;
        annotations: Verse["tokenAnnotations"];
      }>;
      tokenGroups: Verse["tokenGroups"];
      links: Verse["tokenLinks"];
      notes: Verse["verseAnnotations"];
      media: Verse["verseMedia"];
    }>;
  };
};

type BibleAssets = {
  references: ReferenceBook[];
  referencesByBook: Map<string, ReferenceBook>;
  kjvByVerseId: Map<string, KJVVerseRecord>;
};

const STORAGE_KEYS = {
  verses: "kjveasy:verses",
  mediaLibrary: "kjveasy:media-library",
  exportJobs: "kjveasy:export-jobs",
  manifests: "kjveasy:manifests"
} as const;

const seedMediaLibrary: MediaLibraryAsset[] = [
  {
    id: "library_img_1",
    mediaType: "image",
    assetRef: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
    caption: "Landscape light",
    altText: "Sunlight over hills",
    tags: ["light", "hope", "landscape"],
    createdAt: "2026-04-05T12:00:00.000Z",
    createdBy: "system"
  },
  {
    id: "library_img_2",
    mediaType: "image",
    assetRef: "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=900&q=80",
    caption: "Mountains and valley",
    altText: "Mountain valley scene",
    tags: ["creation", "mountains"],
    createdAt: "2026-04-05T12:00:00.000Z",
    createdBy: "system"
  }
];

let bibleAssetsPromise: Promise<BibleAssets> | null = null;

function readStoredJson<T>(key: string, fallback: T): T {
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback));
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback));
    return fallback;
  }
}

function writeStoredJson<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function makeVerseId(book: string, chapter: number, verse: number): string {
  return `${book.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${chapter}-${verse}`;
}

function sortVerses(verses: Verse[]): Verse[] {
  return [...verses].sort((a, b) => {
    if (a.reference.book !== b.reference.book) {
      return a.reference.book.localeCompare(b.reference.book);
    }
    if (a.reference.chapter !== b.reference.chapter) {
      return a.reference.chapter - b.reference.chapter;
    }
    return a.reference.verse - b.reference.verse;
  });
}

function buildGeneratedVerse(record: KJVVerseRecord): Verse {
  const verseId = makeVerseId(record.book, record.chapter, record.verse);
  const now = new Date().toISOString();
  const tokens = autoTagTokens(tokenizeSourceText(verseId, record.text));

  return verseSchema.parse({
    verseId,
    reference: {
      book: record.book,
      chapter: record.chapter,
      verse: record.verse
    },
    sourceText: record.text,
    tokens,
    tokenAnnotations: [],
    tokenGroups: [],
    tokenLinks: [],
    verseAnnotations: [],
    verseMedia: [],
    editorLayout: {
      annotationPlacements: {},
      notePanelPlacement: "right",
      mediaOrder: []
    },
    metadata: {
      createdAt: now,
      updatedAt: now,
      createdBy: "system",
      updatedBy: "system",
      version: 1,
      status: "draft"
    }
  });
}

async function loadBibleAssets(): Promise<BibleAssets> {
  if (!bibleAssetsPromise) {
    bibleAssetsPromise = Promise.all([
      fetch(`${import.meta.env.BASE_URL}assets/references.json`).then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to load references.json.");
        }
        return response.json() as Promise<ReferenceBook[]>;
      }),
      fetch(`${import.meta.env.BASE_URL}assets/kjv.json`).then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to load kjv.json.");
        }
        return response.json() as Promise<KJVVerseRecord[]>;
      })
    ]).then(([references, kjv]) => ({
      references,
      referencesByBook: new Map(references.map((entry) => [entry.book, entry])),
      kjvByVerseId: new Map(kjv.map((entry) => [makeVerseId(entry.book, entry.chapter, entry.verse), entry]))
    }));
  }

  return bibleAssetsPromise;
}

function listSavedVerses(): Verse[] {
  ensureLocalData();
  return sortVerses(
    readStoredJson<Verse[]>(STORAGE_KEYS.verses, []).map((entry) => verseSchema.parse(entry))
  );
}

function saveVerses(verses: Verse[]) {
  writeStoredJson(STORAGE_KEYS.verses, sortVerses(verses));
}

function getSavedVerseMap(): Map<string, Verse> {
  return new Map(listSavedVerses().map((verse) => [verse.verseId, verse]));
}

function getMediaLibrary(): MediaLibraryAsset[] {
  ensureLocalData();
  return readStoredJson<MediaLibraryAsset[]>(STORAGE_KEYS.mediaLibrary, seedMediaLibrary).map((entry) => mediaLibraryAssetSchema.parse(entry));
}

function getExportJobs(): ExportJob[] {
  ensureLocalData();
  return readStoredJson<ExportJob[]>(STORAGE_KEYS.exportJobs, []).map((entry) => exportJobSchema.parse(entry));
}

function saveExportJobs(jobs: ExportJob[]) {
  writeStoredJson(STORAGE_KEYS.exportJobs, jobs);
}

function getManifests(): Record<string, PublishManifest> {
  ensureLocalData();
  const raw = readStoredJson<Record<string, PublishManifest>>(STORAGE_KEYS.manifests, {});
  return Object.fromEntries(Object.entries(raw).map(([jobId, manifest]) => [jobId, publishManifestSchema.parse(manifest)]));
}

function saveManifest(jobId: string, manifest: PublishManifest) {
  const manifests = getManifests();
  manifests[jobId] = manifest;
  writeStoredJson(STORAGE_KEYS.manifests, manifests);
}

async function getVerseById(verseId: string): Promise<Verse | null> {
  const savedVerse = getSavedVerseMap().get(verseId);
  if (savedVerse) {
    return savedVerse;
  }

  const assets = await loadBibleAssets();
  const record = assets.kjvByVerseId.get(verseId);
  return record ? buildGeneratedVerse(record) : null;
}

async function listVersesByScope(scopeType: ExportScopeType, book: string, chapter?: number): Promise<Verse[]> {
  const assets = await loadBibleAssets();
  const savedVerseMap = getSavedVerseMap();
  const referenceBook = assets.referencesByBook.get(book);

  if (!referenceBook) {
    return [];
  }

  const chapters = scopeType === "book"
    ? referenceBook.chapters
    : referenceBook.chapters.filter((entry) => entry.chapter === chapter);

  const verses = chapters.flatMap((chapterEntry) =>
    Array.from({ length: chapterEntry.verses }, (_, index) => {
      const verseNumber = index + 1;
      const verseId = makeVerseId(book, chapterEntry.chapter, verseNumber);
      const savedVerse = savedVerseMap.get(verseId);
      if (savedVerse) {
        return savedVerse;
      }

      const record = assets.kjvByVerseId.get(verseId);
      if (!record) {
        throw new Error(`Missing KJV source text for ${book} ${chapterEntry.chapter}:${verseNumber}.`);
      }
      return buildGeneratedVerse(record);
    })
  );

  return sortVerses(verses);
}

function buildExportPackage(job: ExportJob, verses: Verse[]): ExportPackagePayload {
  const mediaAssets = verses.flatMap((verse) =>
    verse.verseMedia.map((media) => ({
      verseId: verse.verseId,
      mediaId: media.id,
      assetRef: media.assetRef,
      caption: media.caption,
      altText: media.altText
    }))
  );

  const manifest: PublishManifest = {
    jobId: job.id,
    mode: job.mode,
    scopeType: job.scopeType,
    book: job.book,
    chapter: job.chapter,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    verseCount: verses.length,
    mediaAssets,
    files: [
      { path: "manifest.json", kind: "manifest" },
      ...verses.map((verse) => ({ path: `verses/${verse.verseId}.json`, kind: "verse-json" as const })),
      {
        path: job.scopeType === "chapter" ? `chapter-${job.book}-${job.chapter}.json` : `book-${job.book}.json`,
        kind: job.scopeType === "chapter" ? "chapter-json" : "book-json"
      },
      { path: "app-ready.json", kind: "app-ready-json" }
    ]
  };

  return {
    manifest,
    verses,
    appReady: {
      scopeType: job.scopeType,
      book: job.book,
      chapter: job.chapter,
      verses: verses.map((verse) => ({
        verseId: verse.verseId,
        reference: verse.reference,
        sourceText: verse.sourceText,
        tokens: verse.tokens.map((token) => ({
          id: token.id,
          text: token.surfaceText,
          annotations: verse.tokenAnnotations.filter((annotation) => annotation.tokenId === token.id)
        })),
        tokenGroups: verse.tokenGroups,
        links: verse.tokenLinks,
        notes: verse.verseAnnotations,
        media: verse.verseMedia
      }))
    }
  };
}

async function getChapterSummary(book: string, chapter: number, savedVerseMap?: Map<string, Verse>): Promise<ChapterSummary> {
  const assets = await loadBibleAssets();
  const referenceBook = assets.referencesByBook.get(book);
  const chapterMeta = referenceBook?.chapters.find((entry) => entry.chapter === chapter);
  const savedMap = savedVerseMap ?? getSavedVerseMap();

  if (!referenceBook || !chapterMeta) {
    return {
      book,
      chapter,
      verses: [],
      completeness: 0,
      errors: 0,
      warnings: 0
    };
  }

  const summaries = Array.from({ length: chapterMeta.verses }, (_, index) => {
    const verseNumber = index + 1;
    const verseId = makeVerseId(book, chapter, verseNumber);
    const savedVerse = savedMap.get(verseId);
    const issues = savedVerse ? validateVerse(savedVerse) : [];

    return {
      verseId,
      verse: verseNumber,
      status: savedVerse?.metadata.status ?? "draft",
      validationState: savedVerse ? summarizeValidationState(issues) : "valid",
      openCommentCount: 0,
      revisionCount: 0,
      updatedAt: savedVerse?.metadata.updatedAt ?? ""
    };
  });

  return {
    book,
    chapter,
    verses: summaries,
    completeness: summaries.length === 0 ? 0 : summaries.filter((entry) => entry.status === "published").length / summaries.length,
    errors: summaries.filter((entry) => entry.validationState === "error").length,
    warnings: summaries.filter((entry) => entry.validationState === "warning").length
  };
}

export function ensureLocalData() {
  readStoredJson<Verse[]>(STORAGE_KEYS.verses, []);

  const existingMedia = readStoredJson<MediaLibraryAsset[]>(STORAGE_KEYS.mediaLibrary, []);
  if (existingMedia.length === 0) {
    writeStoredJson(STORAGE_KEYS.mediaLibrary, seedMediaLibrary);
  }

  readStoredJson<ExportJob[]>(STORAGE_KEYS.exportJobs, []);
  readStoredJson<Record<string, PublishManifest>>(STORAGE_KEYS.manifests, {});
}

export function downloadJsonFile(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function getNavigationData(): Promise<NavigationData> {
  const assets = await loadBibleAssets();
  const savedVerseMap = getSavedVerseMap();

  return {
    books: assets.references.map((book) => {
      const chapters = book.chapters.map((chapter) => {
        const verses = Array.from({ length: chapter.verses }, (_, index) => {
          const verseNumber = index + 1;
          const verseId = makeVerseId(book.book, chapter.chapter, verseNumber);
          const savedVerse = savedVerseMap.get(verseId);
          const issues = savedVerse ? validateVerse(savedVerse) : [];

          return {
            verseId,
            verse: verseNumber,
            status: savedVerse?.metadata.status ?? "draft",
            validationState: savedVerse ? summarizeValidationState(issues) : "valid" as const,
            revisionCount: 0,
            state: savedVerse ? "saved" as const : "generated" as const
          };
        });

        return {
          chapter: chapter.chapter,
          verseCount: chapter.verses,
          savedVerseCount: verses.filter((entry) => entry.state === "saved").length,
          verses
        };
      });

      return {
        abbr: book.abbr,
        book: book.book,
        chapterCount: book.chapters.length,
        savedVerseCount: chapters.reduce((sum, chapter) => sum + chapter.savedVerseCount, 0),
        chapters
      };
    })
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const assets = await loadBibleAssets();
  const savedVerseMap = getSavedVerseMap();
  const chapterPromises = assets.references.flatMap((book) =>
    book.chapters.map((chapter) => getChapterSummary(book.book, chapter.chapter, savedVerseMap))
  );

  return {
    chapters: await Promise.all(chapterPromises),
    mediaLibraryCount: getMediaLibrary().length,
    exportJobs: getExportJobs().slice(0, 10)
  };
}

export async function getVerseContextData(verseId: string): Promise<VerseContext> {
  const verse = await getVerseById(verseId);
  if (!verse) {
    throw new Error("Verse not found.");
  }

  return {
    verse,
    validationIssues: validateVerse(verse)
  };
}

export async function getMediaLibraryAssets(): Promise<{ assets: MediaLibraryAsset[] }> {
  return { assets: getMediaLibrary() };
}

export async function saveVerseData(verse: Verse): Promise<VerseContext> {
  const issues = validateVerse(verse);
  if (issues.some((issue) => issue.severity === "error")) {
    throw new Error("Verse validation failed.");
  }

  const savedVerses = listSavedVerses();
  const nextVerses = savedVerses.some((entry) => entry.verseId === verse.verseId)
    ? savedVerses.map((entry) => (entry.verseId === verse.verseId ? verse : entry))
    : [...savedVerses, verse];
  saveVerses(nextVerses);
  return getVerseContextData(verse.verseId);
}

export async function importVerseData(payload: unknown): Promise<{ verse: Verse }> {
  const parsed = verseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Imported JSON does not match the canonical schema.");
  }
  return { verse: parsed.data };
}

export async function exportVerseData(verseId: string): Promise<Verse> {
  const verse = await getVerseById(verseId);
  if (!verse) {
    throw new Error("Verse not found.");
  }
  return verse;
}

export async function getExportJobData(jobId: string): Promise<ExportJobDetails> {
  const job = getExportJobs().find((entry) => entry.id === jobId);
  if (!job) {
    throw new Error("Export job not found.");
  }
  return {
    job,
    manifest: getManifests()[jobId] ?? null
  };
}

export async function createExportJobData(mode: ExportJobMode, scopeType: ExportScopeType, book: string, chapter?: number): Promise<ExportJobDetails> {
  const verses = await listVersesByScope(scopeType, book, chapter);
  const warnings = verses.flatMap((verse) =>
    validateVerse(verse)
      .filter((issue) => issue.severity === "warning")
      .map((issue) => `${verse.verseId}: ${issue.message}`)
  );
  const blocking = verses.flatMap((verse) =>
    validateVerse(verse)
      .filter((issue) => issue.severity === "error")
      .map((issue) => `${verse.verseId}: ${issue.message}`)
  );

  const baseJob: ExportJob = {
    id: createId("job"),
    mode,
    scopeType,
    book,
    chapter,
    status: blocking.length > 0 ? "failed" : "completed",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    createdBy: "local-user",
    verseCount: verses.length,
    errorCount: blocking.length,
    warnings,
    errorMessage: blocking.length > 0 ? "Export blocked by validation errors." : undefined
  };

  let manifests = getManifests();

  if (blocking.length === 0) {
    const payload = buildExportPackage(baseJob, verses);
    saveManifest(baseJob.id, payload.manifest);
    manifests = getManifests();
    downloadJsonFile(
      `${mode}-${scopeType}-${book.toLowerCase()}${chapter ? `-${chapter}` : ""}.json`,
      payload
    );

    if (mode === "publish") {
      const savedVerseMap = getSavedVerseMap();
      verses.forEach((verse) => {
        savedVerseMap.set(verse.verseId, {
          ...verse,
          metadata: {
            ...verse.metadata,
            status: "published",
            updatedAt: new Date().toISOString(),
            publishMetadata: {
              ...(verse.metadata.publishMetadata ?? {}),
              publishedAt: new Date().toISOString(),
              publishJobId: baseJob.id
            }
          }
        });
      });
      saveVerses([...savedVerseMap.values()]);
    }
  }

  saveExportJobs([baseJob, ...getExportJobs()].slice(0, 200));
  return {
    job: baseJob,
    manifest: manifests[baseJob.id] ?? null
  };
}
