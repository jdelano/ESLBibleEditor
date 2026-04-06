import fs from "fs";
import path from "path";
import {
  ChapterSummary,
  ExportJob,
  ExportJobMode,
  ExportScopeType,
  MediaLibraryAsset,
  PublishManifest,
  ReviewComment,
  Verse,
  createId,
  exportJobSchema,
  mediaLibraryAssetSchema,
  publishManifestSchema,
  reviewCommentSchema,
  summarizeValidationState,
  validateVerse,
  verseSchema
} from "../../../packages/schema/src";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    const pkgPath = path.join(current, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg.name === "kjveasy-isl-editor") {
          return current;
        }
      } catch {
        // ignore malformed package.json while walking up
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

const repoRoot = findRepoRoot(__dirname);

function getDataDir() {
  return process.env.DATA_DIR
    ? path.resolve(process.cwd(), process.env.DATA_DIR)
    : path.join(repoRoot, "apps", "api", "data");
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function getVersesDir() {
  return ensureDir(path.join(getDataDir(), "verses"));
}

function getCollectionFile(name: string) {
  ensureDir(getDataDir());
  return path.join(getDataDir(), `${name}.json`);
}

function getArtifactsDir() {
  return ensureDir(path.join(getDataDir(), "artifacts"));
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJsonFile<T>(filePath: string, data: T) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function getSeedVersesDir() {
  return path.join(repoRoot, "sample-data", "verses");
}

function seedMediaLibrary(): MediaLibraryAsset[] {
  const now = "2026-04-05T12:00:00.000Z";
  return [
    {
      id: "library_img_1",
      mediaType: "image",
      assetRef: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
      caption: "Landscape light",
      altText: "Sunlight over hills",
      tags: ["light", "hope", "landscape"],
      createdAt: now,
      createdBy: "system"
    },
    {
      id: "library_img_2",
      mediaType: "image",
      assetRef: "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=900&q=80",
      caption: "Mountains and valley",
      altText: "Mountain valley scene",
      tags: ["creation", "mountains"],
      createdAt: now,
      createdBy: "system"
    }
  ];
}

export function ensureSeedData() {
  const versesDir = getVersesDir();
  if (fs.readdirSync(versesDir).length === 0) {
    for (const file of fs.readdirSync(getSeedVersesDir())) {
      fs.copyFileSync(path.join(getSeedVersesDir(), file), path.join(versesDir, file));
    }
  }

  getReviewComments();
  getMediaLibrary();
  getExportJobs();
}

export function listVerses(): Verse[] {
  const versesDir = getVersesDir();
  return fs
    .readdirSync(versesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(versesDir, file), "utf8");
      return verseSchema.parse(JSON.parse(raw));
    })
    .sort((a, b) => {
      if (a.reference.book !== b.reference.book) {
        return a.reference.book.localeCompare(b.reference.book);
      }
      if (a.reference.chapter !== b.reference.chapter) {
        return a.reference.chapter - b.reference.chapter;
      }
      return a.reference.verse - b.reference.verse;
    });
}

export function getVerse(verseId: string): Verse | null {
  const filePath = path.join(getVersesDir(), `${verseId}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return verseSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function saveVerse(verse: Verse): Verse {
  const filePath = path.join(getVersesDir(), `${verse.verseId}.json`);
  writeJsonFile(filePath, verse);
  return verse;
}

export function getReviewComments(): ReviewComment[] {
  const filePath = getCollectionFile("review-comments");
  return readJsonFile<ReviewComment[]>(filePath, []).map((entry) => reviewCommentSchema.parse(entry));
}

export function saveReviewComments(comments: ReviewComment[]) {
  writeJsonFile(getCollectionFile("review-comments"), comments);
}

export function getMediaLibrary(): MediaLibraryAsset[] {
  const filePath = getCollectionFile("media-library");
  return readJsonFile(filePath, seedMediaLibrary()).map((entry) => mediaLibraryAssetSchema.parse(entry));
}

export function saveMediaLibrary(assets: MediaLibraryAsset[]) {
  writeJsonFile(getCollectionFile("media-library"), assets);
}

export function getExportJobs(): ExportJob[] {
  const filePath = getCollectionFile("export-jobs");
  return readJsonFile<ExportJob[]>(filePath, []).map((entry) => exportJobSchema.parse(entry));
}

export function saveExportJobs(jobs: ExportJob[]) {
  writeJsonFile(getCollectionFile("export-jobs"), jobs);
}

export function getVerseComments(verseId: string): ReviewComment[] {
  return getReviewComments().filter((comment) => comment.verseId === verseId);
}

export function upsertReviewComment(comment: ReviewComment) {
  const comments = getReviewComments();
  const next = comments.some((entry) => entry.id === comment.id)
    ? comments.map((entry) => (entry.id === comment.id ? comment : entry))
    : [comment, ...comments];
  saveReviewComments(next);
}

export function getChapterSummary(book: string, chapter: number): ChapterSummary {
  const verses = listVerses().filter((verse) => verse.reference.book === book && verse.reference.chapter === chapter);
  const comments = getReviewComments();
  const summaries = verses.map((verse) => {
    const issues = validateVerse(verse);
    return {
      verseId: verse.verseId,
      verse: verse.reference.verse,
      status: verse.metadata.status,
      validationState: summarizeValidationState(issues),
      openCommentCount: comments.filter((comment) => comment.verseId === verse.verseId && comment.status === "open").length,
      revisionCount: 0,
      updatedAt: verse.metadata.updatedAt
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

export function listVersesByScope(scopeType: ExportScopeType, book: string, chapter?: number): Verse[] {
  const allVerses = listVerses().filter((verse) => verse.reference.book === book);
  if (scopeType === "book") {
    return allVerses;
  }
  return allVerses.filter((verse) => verse.reference.chapter === chapter);
}

export function createExportJobRecord(mode: ExportJobMode, scopeType: ExportScopeType, book: string, createdBy: string, chapter?: number): ExportJob {
  const jobs = getExportJobs();
  const next: ExportJob = {
    id: createId("job"),
    mode,
    scopeType,
    book,
    chapter,
    status: "queued",
    createdAt: new Date().toISOString(),
    createdBy,
    verseCount: 0,
    errorCount: 0,
    warnings: []
  };
  saveExportJobs([next, ...jobs].slice(0, 200));
  return next;
}

export function updateExportJob(job: ExportJob) {
  const jobs = getExportJobs();
  const next = jobs.some((entry) => entry.id === job.id) ? jobs.map((entry) => (entry.id === job.id ? job : entry)) : [job, ...jobs];
  saveExportJobs(next.slice(0, 200));
}

export function getExportJob(jobId: string): ExportJob | null {
  return getExportJobs().find((job) => job.id === jobId) ?? null;
}

export function readManifest(job: ExportJob): PublishManifest | null {
  if (!job.manifestPath || !fs.existsSync(job.manifestPath)) {
    return null;
  }
  return publishManifestSchema.parse(JSON.parse(fs.readFileSync(job.manifestPath, "utf8")));
}

export function runExportJob(job: ExportJob): ExportJob {
  const running: ExportJob = { ...job, status: "running" };
  updateExportJob(running);

  try {
    const verses = listVersesByScope(job.scopeType, job.book, job.chapter);
    const validation = verses.flatMap((verse) =>
      validateVerse(verse).map((issue) => ({
        verseId: verse.verseId,
        issue
      }))
    );
    const blocking = validation.filter((entry) => entry.issue.severity === "error");
    const warnings = validation.filter((entry) => entry.issue.severity === "warning");

    if (blocking.length > 0) {
      const failed: ExportJob = {
        ...running,
        status: "failed",
        completedAt: new Date().toISOString(),
        verseCount: verses.length,
        errorCount: blocking.length,
        warnings: warnings.map((entry) => `${entry.verseId}: ${entry.issue.message}`),
        errorMessage: "Export blocked by validation errors."
      };
      updateExportJob(failed);
      return failed;
    }

    const artifactDir = ensureDir(path.join(getArtifactsDir(), running.id));
    const versesDir = ensureDir(path.join(artifactDir, "verses"));

    const manifestFiles: PublishManifest["files"] = [];
    const mediaAssets: PublishManifest["mediaAssets"] = [];

    verses.forEach((verse) => {
      const verseFileName = `${verse.verseId}.json`;
      writeJsonFile(path.join(versesDir, verseFileName), verse);
      manifestFiles.push({ path: `verses/${verseFileName}`, kind: "verse-json" });
      verse.verseMedia.forEach((media) => {
        mediaAssets.push({
          verseId: verse.verseId,
          mediaId: media.id,
          assetRef: media.assetRef,
          caption: media.caption,
          altText: media.altText
        });
      });
    });

    const chapterOrBookAggregatePath =
      job.scopeType === "chapter"
        ? path.join(artifactDir, `chapter-${job.book}-${job.chapter}.json`)
        : path.join(artifactDir, `book-${job.book}.json`);
    writeJsonFile(chapterOrBookAggregatePath, {
      book: job.book,
      chapter: job.chapter,
      verses
    });
    manifestFiles.push({
      path: path.basename(chapterOrBookAggregatePath),
      kind: job.scopeType === "chapter" ? "chapter-json" : "book-json"
    });

    const appReadyPath = path.join(artifactDir, "app-ready.json");
    writeJsonFile(appReadyPath, {
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
        links: verse.tokenLinks,
        notes: verse.verseAnnotations,
        media: verse.verseMedia
      }))
    });
    manifestFiles.push({ path: "app-ready.json", kind: "app-ready-json" });

    const manifest: PublishManifest = {
      jobId: running.id,
      mode: running.mode,
      scopeType: running.scopeType,
      book: running.book,
      chapter: running.chapter,
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      verseCount: verses.length,
      mediaAssets,
      files: [
        { path: "manifest.json", kind: "manifest" },
        ...manifestFiles
      ]
    };
    const manifestPath = path.join(artifactDir, "manifest.json");
    writeJsonFile(manifestPath, manifest);

    if (running.mode === "publish") {
      verses.forEach((verse) => {
        saveVerse({
          ...verse,
          metadata: {
            ...verse.metadata,
            status: "published",
            updatedAt: new Date().toISOString(),
            publishMetadata: {
              ...(verse.metadata.publishMetadata ?? {}),
              publishedAt: new Date().toISOString(),
              publishJobId: running.id
            }
          }
        });
      });
    }

    const completed: ExportJob = {
      ...running,
      status: "completed",
      completedAt: new Date().toISOString(),
      artifactDir,
      manifestPath,
      verseCount: verses.length,
      errorCount: 0,
      warnings: warnings.map((entry) => `${entry.verseId}: ${entry.issue.message}`)
    };
    updateExportJob(completed);
    return completed;
  } catch (error) {
    const failed: ExportJob = {
      ...running,
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : "Unknown export error"
    };
    updateExportJob(failed);
    return failed;
  }
}
