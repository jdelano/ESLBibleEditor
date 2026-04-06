import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  ChapterSummary,
  ExportJobMode,
  ExportScopeType,
  ReviewComment,
  Verse,
  createId,
  reviewCommentSchema,
  validateVerse,
  verseSchema
} from "../../../packages/schema/src";
import {
  createExportJobRecord,
  ensureSeedData,
  getChapterSummary,
  getExportJob,
  getExportJobs,
  getMediaLibrary,
  getReviewComments,
  getVerse,
  getVerseComments,
  listVerses,
  readManifest,
  runExportJob,
  saveVerse,
  upsertReviewComment
} from "./store";

type NavigationVerseEntry = {
  verseId: string;
  verse: number;
  status: string;
  validationState: "valid" | "warning" | "error";
  openCommentCount: number;
  revisionCount: number;
};

function requireActorId(req: express.Request): string {
  return String(req.header("x-user-id") ?? req.query.userId ?? "user_author_1");
}

function toNavigation(verses: Verse[]): { books: Array<{ book: string; chapters: Array<{ chapter: number; verses: NavigationVerseEntry[] }> }> } {
  const chapterMap = new Map<string, ChapterSummary>();
  for (const verse of verses) {
    const key = `${verse.reference.book}:${verse.reference.chapter}`;
    if (!chapterMap.has(key)) {
      chapterMap.set(key, getChapterSummary(verse.reference.book, verse.reference.chapter));
    }
  }

  const byBook = new Map<string, Map<number, NavigationVerseEntry[]>>();
  for (const summary of chapterMap.values()) {
    const book = byBook.get(summary.book) ?? new Map<number, NavigationVerseEntry[]>();
    book.set(summary.chapter, summary.verses);
    byBook.set(summary.book, book);
  }

  return {
    books: [...byBook.entries()].map(([book, chapters]) => ({
      book,
      chapters: [...chapters.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([chapter, verseEntries]) => ({ chapter, verses: verseEntries }))
    }))
  };
}

function loadVerseContext(verseId: string) {
  const verse = getVerse(verseId);
  if (!verse) {
    return null;
  }

  return {
    verse,
    validationIssues: validateVerse(verse),
    comments: getVerseComments(verseId)
  };
}

export function createApp() {
  ensureSeedData();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/navigation", (_req, res) => {
    res.json(toNavigation(listVerses()));
  });

  app.get("/api/dashboard", (_req, res) => {
    const verses = listVerses();
    const chapters = new Map<string, ChapterSummary>();
    for (const verse of verses) {
      const key = `${verse.reference.book}:${verse.reference.chapter}`;
      if (!chapters.has(key)) {
        chapters.set(key, getChapterSummary(verse.reference.book, verse.reference.chapter));
      }
    }

    res.json({
      chapters: [...chapters.values()],
      mediaLibraryCount: getMediaLibrary().length,
      exportJobs: getExportJobs().slice(0, 10)
    });
  });

  app.get("/api/chapters/:book/:chapter", (req, res) => {
    res.json(getChapterSummary(req.params.book, Number(req.params.chapter)));
  });

  app.get("/api/media-library", (_req, res) => {
    res.json({ assets: getMediaLibrary() });
  });

  app.get("/api/export-jobs", (_req, res) => {
    res.json({ jobs: getExportJobs() });
  });

  app.get("/api/export-jobs/:jobId", (req, res) => {
    const job = getExportJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ message: "Export job not found." });
    }
    return res.json({ job, manifest: readManifest(job) });
  });

  app.get("/api/export-jobs/:jobId/manifest", (req, res) => {
    const job = getExportJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ message: "Export job not found." });
    }
    const manifest = readManifest(job);
    if (!manifest) {
      return res.status(404).json({ message: "Manifest not found for this job." });
    }
    return res.json(manifest);
  });

  app.post("/api/export-jobs", (req, res) => {
    const actorId = requireActorId(req);
    const mode = (req.body.mode ?? "export") as ExportJobMode;
    const scopeType = req.body.scopeType as ExportScopeType;
    const book = String(req.body.book ?? "");
    const chapter = req.body.chapter ? Number(req.body.chapter) : undefined;

    if (!["export", "publish"].includes(mode) || !["chapter", "book"].includes(scopeType) || !book) {
      return res.status(400).json({ message: "Invalid export job payload." });
    }
    if (scopeType === "chapter" && !chapter) {
      return res.status(400).json({ message: "Chapter export jobs require a chapter number." });
    }

    const job = createExportJobRecord(mode, scopeType, book, actorId, chapter);
    const completed = runExportJob(job);
    return res.status(completed.status === "failed" ? 400 : 201).json({ job: completed, manifest: readManifest(completed) });
  });

  app.get("/api/review-comments", (req, res) => {
    const verseId = typeof req.query.verseId === "string" ? req.query.verseId : undefined;
    const comments = verseId ? getVerseComments(verseId) : getReviewComments();
    res.json({ comments });
  });

  app.post("/api/review-comments", (req, res) => {
    const actorId = requireActorId(req);
    const payload = {
      id: createId("comment"),
      verseId: req.body.verseId,
      anchorType: req.body.anchorType,
      anchorId: req.body.anchorId,
      body: req.body.body,
      createdBy: actorId,
      createdAt: new Date().toISOString(),
      status: "open" as const
    };

    const parsed = reviewCommentSchema.safeParse(payload);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid review comment.", issues: parsed.error.issues });
    }

    upsertReviewComment(parsed.data);
    return res.status(201).json({ comment: parsed.data });
  });

  app.put("/api/review-comments/:commentId/resolve", (req, res) => {
    const existing = getReviewComments().find((entry) => entry.id === req.params.commentId);
    if (!existing) {
      return res.status(404).json({ message: "Comment not found." });
    }
    const next: ReviewComment = { ...existing, status: "resolved" };
    upsertReviewComment(next);
    return res.json({ comment: next });
  });

  app.get("/api/verses/:verseId", (req, res) => {
    const context = loadVerseContext(req.params.verseId);
    if (!context) {
      return res.status(404).json({ message: "Verse not found." });
    }
    return res.json(context);
  });

  app.post("/api/verses", (req, res) => {
    const parsed = verseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid verse payload.", issues: parsed.error.issues });
    }
    const verse = parsed.data;
    const issues = validateVerse(verse);
    if (issues.some((issue) => issue.severity === "error")) {
      return res.status(400).json({ message: "Verse validation failed.", validationIssues: issues });
    }
    saveVerse(verse);
    return res.status(201).json({ verse, validationIssues: issues });
  });

  app.put("/api/verses/:verseId", (req, res) => {
    const mode = req.query.mode === "autosave" ? "autosave" : req.query.mode === "checkpoint" ? "checkpoint" : "manual-save";
    if (req.params.verseId !== req.body.verseId) {
      return res.status(400).json({ message: "URL verse ID does not match payload verse ID." });
    }
    const parsed = verseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid verse payload.", issues: parsed.error.issues });
    }
    const verse = parsed.data;
    const issues = validateVerse(verse);
    if (issues.some((issue) => issue.severity === "error")) {
      return res.status(400).json({ message: "Verse validation failed.", validationIssues: issues });
    }

    saveVerse(verse);
    return res.json(loadVerseContext(verse.verseId));
  });

  app.post("/api/import", (req, res) => {
    const parsed = verseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Imported JSON does not match the canonical schema.", issues: parsed.error.issues });
    }
    const verse = parsed.data;
    return res.json({ verse, validationIssues: validateVerse(verse) });
  });

  app.get("/api/verses/:verseId/export", (req, res) => {
    const verse = getVerse(req.params.verseId);
    if (!verse) {
      return res.status(404).json({ message: "Verse not found." });
    }
    return res.json(verse);
  });

  return app;
}
