import { z } from "zod";

export const STATUSES = ["draft", "published"] as const;
export const ANNOTATION_TYPES = ["emoji", "icon", "meaning"] as const;
export const LINK_TYPES = ["antecedent"] as const;
export const ANNOTATION_CONTENT_TYPES = ["text", "emoji", "image"] as const;
export const GROUP_ANNOTATION_LANE_MODES = ["grouped", "split"] as const;
export const NOTE_CATEGORIES = ["translation", "context", "application", "review"] as const;
export const MEDIA_TYPES = ["image"] as const;
export const PARTS_OF_SPEECH = [
  "",
  "noun",
  "pronoun",
  "verb",
  "adjective",
  "adverb",
  "article",
  "preposition",
  "conjunction",
  "interjection"
] as const;
export const WORD_COLOR_CATEGORIES = [
  "",
  "god",
  "good_angels",
  "bad_angels",
  "person_name",
  "group_name",
  "people",
  "things",
  "place_name",
  "place",
  "time",
  "number"
] as const;
export const USER_ROLES = ["author", "reviewer", "administrator", "publisher"] as const;
export const COMMENT_STATUSES = ["open", "resolved"] as const;
export const EXPORT_JOB_STATUSES = ["queued", "running", "completed", "failed"] as const;
export const EXPORT_JOB_MODES = ["export", "publish"] as const;
export const EXPORT_SCOPE_TYPES = ["chapter", "book"] as const;
export const AUDIT_ACTIONS = [
  "save",
  "autosave",
  "checkpoint",
  "restore",
  "approve",
  "reject",
  "comment.create",
  "comment.resolve",
  "import",
  "export",
  "publish",
  "export.job",
  "delete",
  "login"
] as const;

export type Status = typeof STATUSES[number];
export type AnnotationType = typeof ANNOTATION_TYPES[number];
export type LinkType = typeof LINK_TYPES[number];
export type AnnotationContentType = typeof ANNOTATION_CONTENT_TYPES[number];
export type GroupAnnotationLaneMode = typeof GROUP_ANNOTATION_LANE_MODES[number];
export type NoteCategory = typeof NOTE_CATEGORIES[number];
export type MediaType = typeof MEDIA_TYPES[number];
export type PartOfSpeech = typeof PARTS_OF_SPEECH[number];
export type WordColorCategory = typeof WORD_COLOR_CATEGORIES[number];
export type UserRole = typeof USER_ROLES[number];
export type CommentStatus = typeof COMMENT_STATUSES[number];
export type ExportJobStatus = typeof EXPORT_JOB_STATUSES[number];
export type ExportJobMode = typeof EXPORT_JOB_MODES[number];
export type ExportScopeType = typeof EXPORT_SCOPE_TYPES[number];
export type AuditAction = typeof AUDIT_ACTIONS[number];

export const referenceSchema = z.object({
  book: z.string().min(1),
  chapter: z.number().int().positive(),
  verse: z.number().int().positive()
});

export const tokenSchema = z.object({
  id: z.string().min(1),
  verseId: z.string().min(1),
  order: z.number().int().nonnegative(),
  surfaceText: z.string().min(1),
  normalizedText: z.string().default(""),
  partOfSpeech: z.string().default(""),
  wordColorCategory: z.enum(WORD_COLOR_CATEGORIES).default(""),
  morphology: z.string().optional(),
  isProperNoun: z.boolean().default(false),
  isEditorial: z.boolean().default(false)
});

const annotationTypeSchema = z.preprocess(
  (value) => {
    if (value === "gloss" || value === "note marker") {
      return "meaning";
    }
    return value;
  },
  z.enum(ANNOTATION_TYPES)
);

export const annotationContentSegmentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(ANNOTATION_CONTENT_TYPES),
  value: z.string().min(1)
});

const annotationContentSchema = z.array(annotationContentSegmentSchema).default([]);

export const tokenAnnotationSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") {
      return value;
    }
    const source = value as Record<string, unknown>;
    return {
      ...source,
      orderIndex: source.orderIndex === 2 ? 1 : source.orderIndex
    };
  },
  z.object({
    id: z.string().min(1),
    tokenId: z.string().min(1),
    type: annotationTypeSchema,
    value: z.string().min(1),
    content: annotationContentSchema.optional(),
    label: z.string().optional(),
    placement: z.enum(["above", "below", "before", "after"]).optional(),
    orderIndex: z.number().int().nonnegative().optional(),
    styleKey: z.string().optional()
  })
);

export const groupAnnotationSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  subgroupId: z.string().min(1).optional(),
  type: annotationTypeSchema,
  value: z.string().min(1),
  content: annotationContentSchema.optional(),
  label: z.string().optional(),
  wordColorCategory: z.enum(WORD_COLOR_CATEGORIES).default(""),
  orderIndex: z.preprocess((value) => value === 2 ? 1 : value, z.number().int().nonnegative().optional()),
  styleKey: z.string().optional()
});

export const annotationSubgroupSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") {
      return value;
    }
    const source = value as Record<string, unknown>;
    return {
      ...source,
      lane: source.lane === 2 ? 1 : (source.lane ?? 1)
    };
  },
  z.object({
    id: z.string().min(1),
    lane: z.number().int().nonnegative(),
    tokenIds: z.array(z.string().min(1)).min(2)
  })
);

export const tokenLinkSchema = z.object({
  id: z.string().min(1),
  sourceTokenId: z.string().min(1),
  targetTokenId: z.string().min(1),
  type: z.enum(LINK_TYPES),
  label: z.string().optional(),
  wordColorCategory: z.enum(WORD_COLOR_CATEGORIES).default(""),
  renderingHint: z.string().optional()
});

export const tokenGroupSchema = z.object({
  id: z.string().min(1),
  verseId: z.string().min(1),
  tokenIds: z.array(z.string().min(1)).min(2),
  annotationLaneModes: z.preprocess(
    (value) => {
      if (Array.isArray(value) && value.length >= 2) {
        return [value[0], value[1]];
      }
      if (value === "grouped" || value === "split") {
        return ["split", value];
      }
      return ["split", "grouped"];
    },
    z.tuple([z.enum(GROUP_ANNOTATION_LANE_MODES), z.enum(GROUP_ANNOTATION_LANE_MODES)])
  ),
  annotationSubgroups: z.array(annotationSubgroupSchema).default([]),
  annotations: z.array(groupAnnotationSchema).default([])
});

export const verseAnnotationSchema = z.object({
  id: z.string().min(1),
  verseId: z.string().min(1),
  category: z.enum(NOTE_CATEGORIES),
  body: z.string().min(1)
});

export const verseMediaSchema = z.object({
  id: z.string().min(1),
  verseId: z.string().min(1),
  mediaType: z.enum(MEDIA_TYPES),
  assetRef: z.string().min(1),
  caption: z.string().default(""),
  altText: z.string().default(""),
  orderIndex: z.number().int().nonnegative(),
  displayHint: z.string().optional()
});

export const editorLayoutSchema = z.object({
  annotationPlacements: z.record(z.string(), z.object({
    region: z.enum(["above", "below", "inline"]).default("above"),
    xOffset: z.number().min(-100).max(100).default(0),
    yOffset: z.number().min(-100).max(100).default(0)
  })).default({}),
  notePanelPlacement: z.enum(["right", "bottom"]).default("right"),
  mediaOrder: z.array(z.string()).default([])
});

export const metadataSchema = z.object({
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  createdBy: z.string().min(1),
  updatedBy: z.string().min(1),
  version: z.number().int().positive(),
  status: z.preprocess(
    (value) => (value === "published" ? "published" : "draft"),
    z.enum(STATUSES)
  ),
  publishMetadata: z.record(z.string(), z.unknown()).optional()
});

export const verseSchema = z.preprocess(
  migrateLegacySpans,
  z.object({
    verseId: z.string().min(1),
    reference: referenceSchema,
    sourceText: z.string().min(1),
    tokens: z.array(tokenSchema),
    tokenAnnotations: z.array(tokenAnnotationSchema).default([]),
    tokenGroups: z.array(tokenGroupSchema).default([]),
    tokenLinks: z.array(tokenLinkSchema).default([]),
    verseAnnotations: z.array(verseAnnotationSchema).default([]),
    verseMedia: z.array(verseMediaSchema).default([]),
    editorLayout: editorLayoutSchema.default({
      annotationPlacements: {},
      notePanelPlacement: "right",
      mediaOrder: []
    }),
    metadata: metadataSchema
  })
);

export const userSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(USER_ROLES),
  email: z.string().email(),
  active: z.boolean().default(true)
});

export const reviewCommentSchema = z.object({
  id: z.string().min(1),
  verseId: z.string().min(1),
  anchorType: z.enum(["verse", "token", "annotation", "link", "note", "media"]),
  anchorId: z.string().optional(),
  body: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
  status: z.enum(COMMENT_STATUSES).default("open")
});

export const revisionSchema = z.object({
  id: z.string().min(1),
  verseId: z.string().min(1),
  createdAt: z.string().min(1),
  createdBy: z.string().min(1),
  kind: z.enum(["autosave", "checkpoint", "manual-save", "restore"]),
  summary: z.string().min(1),
  verse: verseSchema
});

export const mediaLibraryAssetSchema = z.object({
  id: z.string().min(1),
  mediaType: z.enum(MEDIA_TYPES),
  assetRef: z.string().min(1),
  caption: z.string().default(""),
  altText: z.string().default(""),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().min(1),
  createdBy: z.string().min(1)
});

export const auditLogEntrySchema = z.object({
  id: z.string().min(1),
  action: z.enum(AUDIT_ACTIONS),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  actorId: z.string().min(1),
  timestamp: z.string().min(1),
  details: z.record(z.string(), z.unknown()).default({})
});

export const exportJobSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(EXPORT_JOB_MODES),
  scopeType: z.enum(EXPORT_SCOPE_TYPES),
  book: z.string().min(1),
  chapter: z.number().int().positive().optional(),
  status: z.enum(EXPORT_JOB_STATUSES),
  createdAt: z.string().min(1),
  completedAt: z.string().optional(),
  createdBy: z.string().min(1),
  artifactDir: z.string().optional(),
  manifestPath: z.string().optional(),
  verseCount: z.number().int().nonnegative().default(0),
  errorCount: z.number().int().nonnegative().default(0),
  warnings: z.array(z.string()).default([]),
  errorMessage: z.string().optional()
});

export const publishManifestSchema = z.object({
  jobId: z.string().min(1),
  mode: z.enum(EXPORT_JOB_MODES),
  scopeType: z.enum(EXPORT_SCOPE_TYPES),
  book: z.string().min(1),
  chapter: z.number().int().positive().optional(),
  generatedAt: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  verseCount: z.number().int().nonnegative(),
  mediaAssets: z.array(z.object({
    verseId: z.string().min(1),
    mediaId: z.string().min(1),
    assetRef: z.string().min(1),
    caption: z.string(),
    altText: z.string()
  })),
  files: z.array(z.object({
    path: z.string().min(1),
    kind: z.enum(["manifest", "verse-json", "chapter-json", "book-json", "app-ready-json"])
  }))
});

export type Reference = z.infer<typeof referenceSchema>;
export type Token = z.infer<typeof tokenSchema>;
export type AnnotationContentSegment = z.infer<typeof annotationContentSegmentSchema>;
export type TokenAnnotation = z.infer<typeof tokenAnnotationSchema>;
export type GroupAnnotation = z.infer<typeof groupAnnotationSchema>;
export type TokenGroup = z.infer<typeof tokenGroupSchema>;
export type TokenLink = z.infer<typeof tokenLinkSchema>;
export type VerseAnnotation = z.infer<typeof verseAnnotationSchema>;
export type VerseMedia = z.infer<typeof verseMediaSchema>;
export type EditorLayout = z.infer<typeof editorLayoutSchema>;
export type Metadata = z.infer<typeof metadataSchema>;
export type Verse = z.infer<typeof verseSchema>;
export type User = z.infer<typeof userSchema>;
export type ReviewComment = z.infer<typeof reviewCommentSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type MediaLibraryAsset = z.infer<typeof mediaLibraryAssetSchema>;
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
export type ExportJob = z.infer<typeof exportJobSchema>;
export type PublishManifest = z.infer<typeof publishManifestSchema>;

export type Selection =
  | { type: "verse" }
  | { type: "token"; id: string }
  | { type: "group"; id: string }
  | { type: "annotation-subgroup"; id: string }
  | { type: "annotation-slot"; ownerType: "token" | "group" | "subgroup"; ownerId: string; lane: number }
  | { type: "annotation"; id: string }
  | { type: "link"; id: string }
  | { type: "note"; id: string }
  | { type: "media"; id: string };

export type ValidationIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type ChapterVerseSummary = {
  verseId: string;
  verse: number;
  status: Status;
  validationState: "valid" | "warning" | "error";
  openCommentCount: number;
  revisionCount: number;
  updatedAt: string;
};

type LegacySpanAnnotation = {
  id: string;
  verseId: string;
  startTokenId: string;
  endTokenId: string;
  value: string;
  label?: string;
  wordColorCategory?: WordColorCategory;
};

function migrateLegacySpans(input: unknown): unknown {
  if (!input || typeof input !== "object" || !("spanAnnotations" in (input as Record<string, unknown>))) {
    return input;
  }

  const source = input as Record<string, unknown>;
  const spanAnnotations = Array.isArray(source.spanAnnotations) ? source.spanAnnotations as LegacySpanAnnotation[] : [];
  if (spanAnnotations.length === 0) {
    const { spanAnnotations: _unused, ...rest } = source;
    return rest;
  }

  const tokenGroups = Array.isArray(source.tokenGroups) ? [...source.tokenGroups as Record<string, unknown>[]] : [];
  spanAnnotations.forEach((span) => {
    const groupId = createId("group");
    tokenGroups.push({
      id: groupId,
      verseId: span.verseId,
      tokenIds: [span.startTokenId, span.endTokenId],
      annotations: [{
        id: span.id,
        groupId,
        type: "meaning",
        value: span.value,
        content: [{ id: `${span.id}-text`, type: "text", value: span.value }],
        label: span.label ?? "margin note",
        styleKey: "margin-note",
        orderIndex: 0
      }]
    });
  });

  const { spanAnnotations: _unused, ...rest } = source;
  return {
    ...rest,
    tokenGroups
  };
}

export type ChapterSummary = {
  book: string;
  chapter: number;
  verses: ChapterVerseSummary[];
  completeness: number;
  errors: number;
  warnings: number;
};

export function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeTokenOrders(tokens: Token[]): Token[] {
  return tokens.map((token, index) => ({ ...token, order: index }));
}

export function validateVerse(verse: Verse): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const parsed = verseSchema.safeParse(migrateLegacySpans(verse));

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        path: issue.path.join("."),
        message: issue.message,
        severity: "error"
      });
    }
    return issues;
  }

  const tokenIds = new Set<string>();
  for (const token of verse.tokens) {
    if (tokenIds.has(token.id)) {
      issues.push({ path: "tokens", message: `Duplicate token ID: ${token.id}`, severity: "error" });
    }
    tokenIds.add(token.id);
  }

  verse.tokens.forEach((token: Token, index: number) => {
    if (token.order !== index) {
      issues.push({
        path: `tokens.${index}.order`,
        message: "Token order should be sequential and zero-based.",
        severity: "warning"
      });
    }
  });

  const annotationIds = new Set<string>();
  for (const annotation of verse.tokenAnnotations) {
    if (annotationIds.has(annotation.id)) {
      issues.push({ path: "tokenAnnotations", message: `Duplicate annotation ID: ${annotation.id}`, severity: "error" });
    }
    annotationIds.add(annotation.id);
    if (!tokenIds.has(annotation.tokenId)) {
      issues.push({
        path: "tokenAnnotations",
        message: `Annotation ${annotation.id} references missing token ${annotation.tokenId}.`,
        severity: "error"
      });
    }
  }

  const groupIds = new Set<string>();
  const groupedTokenIds = new Map<string, string>();
  const groupAnnotationIds = new Set<string>();
  for (const group of verse.tokenGroups) {
    if (groupIds.has(group.id)) {
      issues.push({ path: "tokenGroups", message: `Duplicate token group ID: ${group.id}`, severity: "error" });
    }
    groupIds.add(group.id);

    if (group.verseId !== verse.verseId) {
      issues.push({ path: "tokenGroups", message: `Token group ${group.id} belongs to a different verse.`, severity: "error" });
    }

    const groupIndexes = group.tokenIds.map((tokenId) => verse.tokens.findIndex((token) => token.id === tokenId));
    if (groupIndexes.some((index) => index === -1)) {
      issues.push({ path: "tokenGroups", message: `Token group ${group.id} references a missing token.`, severity: "error" });
      continue;
    }

    if (!groupIndexes.every((index, position) => position === 0 || index === groupIndexes[position - 1] + 1)) {
      issues.push({ path: "tokenGroups", message: `Token group ${group.id} must contain contiguous tokens.`, severity: "error" });
    }

    group.tokenIds.forEach((tokenId) => {
      const existingGroupId = groupedTokenIds.get(tokenId);
      if (existingGroupId && existingGroupId !== group.id) {
        issues.push({ path: "tokenGroups", message: `Token ${tokenId} appears in multiple groups (${existingGroupId}, ${group.id}).`, severity: "error" });
      }
      groupedTokenIds.set(tokenId, group.id);
    });

    const subgroupIds = new Set<string>();
    const subgroupedTokenLaneKeys = new Set<string>();
    for (const subgroup of group.annotationSubgroups) {
      if (subgroupIds.has(subgroup.id)) {
        issues.push({ path: "tokenGroups", message: `Duplicate annotation subgroup ID: ${subgroup.id}`, severity: "error" });
      }
      subgroupIds.add(subgroup.id);
      const subgroupIndexes = subgroup.tokenIds.map((tokenId) => verse.tokens.findIndex((token) => token.id === tokenId));
      if (subgroupIndexes.some((index) => index === -1)) {
        issues.push({ path: "tokenGroups", message: `Annotation subgroup ${subgroup.id} references a missing token.`, severity: "error" });
        continue;
      }
      if (!subgroup.tokenIds.every((tokenId) => group.tokenIds.includes(tokenId))) {
        issues.push({ path: "tokenGroups", message: `Annotation subgroup ${subgroup.id} includes a token outside group ${group.id}.`, severity: "error" });
      }
      const laneMode = group.annotationLaneModes[subgroup.lane] ?? "split";
      if (laneMode !== "split") {
        issues.push({ path: "tokenGroups", message: `Annotation subgroup ${subgroup.id} targets lane ${subgroup.lane + 1} but group ${group.id} is not split on that lane.`, severity: "error" });
      }
      if (!subgroupIndexes.every((index, position) => position === 0 || index === subgroupIndexes[position - 1] + 1)) {
        issues.push({ path: "tokenGroups", message: `Annotation subgroup ${subgroup.id} must contain contiguous tokens.`, severity: "error" });
      }
      subgroup.tokenIds.forEach((tokenId) => {
        const laneKey = `${subgroup.lane}:${tokenId}`;
        if (subgroupedTokenLaneKeys.has(laneKey)) {
          issues.push({ path: "tokenGroups", message: `Token ${tokenId} appears in multiple annotation subgroups on lane ${subgroup.lane} inside group ${group.id}.`, severity: "error" });
        }
        subgroupedTokenLaneKeys.add(laneKey);
      });
    }

    const inlineGroupAnnotations = group.annotations.filter((annotation) => annotation.styleKey !== "margin-note" && !annotation.subgroupId);
    const inlineGroupAnnotationsByLane = new Map<number, number>();
    inlineGroupAnnotations.forEach((annotation) => {
      const lane = annotation.orderIndex ?? 1;
      inlineGroupAnnotationsByLane.set(lane, (inlineGroupAnnotationsByLane.get(lane) ?? 0) + 1);
    });
    [0, 1].forEach((lane) => {
      const laneMode = group.annotationLaneModes[lane] ?? "split";
      const sharedCount = inlineGroupAnnotationsByLane.get(lane) ?? 0;
      if (laneMode === "grouped" && sharedCount > 1) {
        issues.push({
          path: "tokenGroups",
          message: `Token group ${group.id} has too many shared annotations on lane ${lane + 1}.`,
          severity: "error"
        });
      }
      if (laneMode === "split" && sharedCount > 0) {
        issues.push({
          path: "tokenGroups",
          message: `Token group ${group.id} is using split mode on lane ${lane + 1} but still has a shared group annotation there.`,
          severity: "error"
        });
      }
    });

    const subgroupAnnotationCounts = new Map<string, number>();
    group.annotations
      .filter((annotation) => annotation.styleKey !== "margin-note" && annotation.subgroupId)
      .forEach((annotation) => {
        const subgroupId = annotation.subgroupId!;
        subgroupAnnotationCounts.set(subgroupId, (subgroupAnnotationCounts.get(subgroupId) ?? 0) + 1);
        if (!group.annotationSubgroups.some((subgroup) => subgroup.id === subgroupId)) {
          issues.push({ path: "tokenGroups", message: `Group annotation ${annotation.id} references missing annotation subgroup ${subgroupId}.`, severity: "error" });
        }
      });
    subgroupAnnotationCounts.forEach((count, subgroupId) => {
      if (count > 1) {
        issues.push({ path: "tokenGroups", message: `Annotation subgroup ${subgroupId} has too many shared annotations.`, severity: "error" });
      }
    });

    const tokenAnnotationCounts = new Map<string, number>();
    const subgroupLaneByTokenId = new Map<string, Set<number>>();
    group.annotationSubgroups.forEach((subgroup) => {
      subgroup.tokenIds.forEach((tokenId) => {
        const occupiedLanes = subgroupLaneByTokenId.get(tokenId) ?? new Set<number>();
        occupiedLanes.add(subgroup.lane);
        subgroupLaneByTokenId.set(tokenId, occupiedLanes);
      });
    });
    verse.tokenAnnotations.forEach((annotation) => {
      if (group.tokenIds.includes(annotation.tokenId)) {
        tokenAnnotationCounts.set(annotation.tokenId, (tokenAnnotationCounts.get(annotation.tokenId) ?? 0) + 1);
        const annotationLane = annotation.orderIndex ?? 0;
        if (subgroupLaneByTokenId.get(annotation.tokenId)?.has(annotationLane)) {
          issues.push({
            path: "tokenGroups",
            message: `Token ${annotation.tokenId} has both a token annotation and an annotation subgroup on lane ${annotationLane} inside group ${group.id}.`,
            severity: "error"
          });
        }
      }
    });
    tokenAnnotationCounts.forEach((count, tokenId) => {
      if (count > 2) {
        issues.push({
          path: "tokenGroups",
          message: `Token ${tokenId} has too many token annotations for the available token lanes inside group ${group.id}.`,
          severity: "error"
        });
      }
    });

    group.annotations.forEach((annotation) => {
      if (groupAnnotationIds.has(annotation.id) || annotationIds.has(annotation.id)) {
        issues.push({ path: "tokenGroups", message: `Duplicate group annotation ID: ${annotation.id}`, severity: "error" });
      }
      groupAnnotationIds.add(annotation.id);
      if (annotation.groupId !== group.id) {
        issues.push({
          path: "tokenGroups",
          message: `Group annotation ${annotation.id} points to the wrong group ${annotation.groupId}.`,
          severity: "error"
        });
      }
    });
  }

  Object.keys(verse.editorLayout.annotationPlacements).forEach((annotationId) => {
    if (!annotationIds.has(annotationId) && !groupAnnotationIds.has(annotationId)) {
      issues.push({
        path: `editorLayout.annotationPlacements.${annotationId}`,
        message: `Layout data exists for missing annotation ${annotationId}.`,
        severity: "warning"
      });
    }
  });

  const linkIds = new Set<string>();
  for (const link of verse.tokenLinks) {
    if (linkIds.has(link.id)) {
      issues.push({ path: "tokenLinks", message: `Duplicate link ID: ${link.id}`, severity: "error" });
    }
    linkIds.add(link.id);
    if (!tokenIds.has(link.sourceTokenId) || !tokenIds.has(link.targetTokenId)) {
      issues.push({
        path: "tokenLinks",
        message: `Link ${link.id} references a missing source or target token.`,
        severity: "error"
      });
    }
  }

  const mediaIds = new Set<string>();
  for (const media of verse.verseMedia) {
    if (mediaIds.has(media.id)) {
      issues.push({ path: "verseMedia", message: `Duplicate media ID: ${media.id}`, severity: "error" });
    }
    mediaIds.add(media.id);
    if (!media.assetRef) {
      issues.push({ path: "verseMedia", message: `Media ${media.id} is missing an asset reference.`, severity: "error" });
    }
  }

  const mediaOrderIds = new Set<string>();
  verse.editorLayout.mediaOrder.forEach((mediaId, index) => {
    if (mediaOrderIds.has(mediaId)) {
      issues.push({
        path: `editorLayout.mediaOrder.${index}`,
        message: `Media order contains duplicate media ID ${mediaId}.`,
        severity: "warning"
      });
    }
    mediaOrderIds.add(mediaId);
    if (!mediaIds.has(mediaId)) {
      issues.push({
        path: `editorLayout.mediaOrder.${index}`,
        message: `Media order references missing media ${mediaId}.`,
        severity: "warning"
      });
    }
  });

  return issues;
}

export function summarizeValidationState(issues: ValidationIssue[]): "valid" | "warning" | "error" {
  if (issues.some((issue) => issue.severity === "error")) {
    return "error";
  }
  if (issues.some((issue) => issue.severity === "warning")) {
    return "warning";
  }
  return "valid";
}

export function tokenizeSourceText(verseId: string, sourceText: string): Token[] {
  return sourceText
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((surfaceText, index) => ({
      id: createId("tok"),
      verseId,
      order: index,
      surfaceText,
      normalizedText: surfaceText.toLowerCase(),
      partOfSpeech: "",
      wordColorCategory: "",
      isProperNoun: false,
      isEditorial: false
    }));
}
