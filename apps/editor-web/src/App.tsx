import { ChangeEvent, CSSProperties, Fragment, KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ANNOTATION_TYPES,
  AnnotationContentSegment,
  ChapterSummary,
  ExportJob,
  GroupAnnotation,
  PublishManifest,
  LINK_TYPES,
  MediaLibraryAsset,
  NOTE_CATEGORIES,
  PARTS_OF_SPEECH,
  Selection,
  Token,
  TokenAnnotation,
  TokenGroup,
  TokenLink,
  ValidationIssue,
  Verse,
  VerseAnnotation,
  VerseMedia,
  WORD_COLOR_CATEGORIES,
  createId,
  normalizeTokenOrders,
  tokenizeSourceText,
  validateVerse
} from "@schema/index";
import { Button, Field, Panel, SectionTitle } from "@ui/index";
import {
  createExportJobData,
  downloadJsonFile,
  ensureLocalData,
  exportVerseData,
  getDashboardData,
  getExportJobData,
  getMediaLibraryAssets,
  getNavigationData,
  getVerseContextData,
  importVerseData,
  saveVerseData
} from "./dataStore";
import { inferPartOfSpeech, inferWordColorCategory } from "./tagging";

type NavigationVerseEntry = {
  verseId: string;
  verse: number;
  status: string;
  validationState: "valid" | "warning" | "error";
  revisionCount: number;
  state: "saved" | "generated";
};

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
      verses: NavigationVerseEntry[];
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

type ActionableIssue = {
  issue: ValidationIssue;
  key: string;
  canFix: boolean;
  focusLabel: string;
  fixLabel?: string;
};

type TokenPosition = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LinkDragState = {
  sourceTokenId: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isDragging: boolean;
};

type EditorAnnotationRecord =
  | { annotation: TokenAnnotation; ownerType: "token"; ownerId: string }
  | { annotation: GroupAnnotation; ownerType: "group" | "subgroup"; ownerId: string };

type TokenVisualItem =
  | { kind: "token"; token: Token }
  | { kind: "group"; group: TokenGroup; tokens: Token[] };

function getLowestUnusedLane(orderIndexes: number[], maxLanes: number): number | null {
  for (let lane = 0; lane < maxLanes; lane += 1) {
    if (!orderIndexes.includes(lane)) {
      return lane;
    }
  }
  return null;
}

function annotationSlotKey(ownerType: "token" | "group" | "subgroup", ownerId: string, lane: number): string {
  return `${ownerType}:${ownerId}:${lane}`;
}

function isMarginNoteAnnotation(annotation: Pick<GroupAnnotation | TokenAnnotation, "styleKey">): boolean {
  return annotation.styleKey === "margin-note";
}

function getGroupLaneMode(group: TokenGroup, lane: number): "grouped" | "split" {
  return group.annotationLaneModes?.[lane] ?? (lane === 0 ? "split" : "grouped");
}

function setGroupLaneMode(group: TokenGroup, lane: number, mode: "grouped" | "split"): TokenGroup {
  const nextModes: ["grouped" | "split", "grouped" | "split"] = [
    getGroupLaneMode(group, 0),
    getGroupLaneMode(group, 1)
  ];
  nextModes[lane] = mode;
  return {
    ...group,
    annotationLaneModes: nextModes
  };
}

function cloneVerse(verse: Verse): Verse {
  return JSON.parse(JSON.stringify(verse)) as Verse;
}

function updateToken(verse: Verse, tokenId: string, patch: Partial<Token>): Verse {
  return {
    ...verse,
    tokens: verse.tokens.map((token: Token) => (token.id === tokenId ? { ...token, ...patch } : token))
  };
}

function updateAnnotation(verse: Verse, annotationId: string, patch: Partial<TokenAnnotation>): Verse {
  return {
    ...verse,
    tokenAnnotations: verse.tokenAnnotations.map((annotation: TokenAnnotation) =>
      annotation.id === annotationId ? { ...annotation, ...patch } : annotation
    )
  };
}

function updateGroup(verse: Verse, groupId: string, patch: Partial<TokenGroup>): Verse {
  return {
    ...verse,
    tokenGroups: verse.tokenGroups.map((group: TokenGroup) => (group.id === groupId ? { ...group, ...patch } : group))
  };
}

function updateGroupAnnotation(verse: Verse, annotationId: string, patch: Partial<GroupAnnotation>): Verse {
  return {
    ...verse,
    tokenGroups: verse.tokenGroups.map((group: TokenGroup) => ({
      ...group,
      annotations: group.annotations.map((annotation: GroupAnnotation) =>
        annotation.id === annotationId ? { ...annotation, ...patch } : annotation
      )
    }))
  };
}

function updateLink(verse: Verse, linkId: string, patch: Partial<TokenLink>): Verse {
  return {
    ...verse,
    tokenLinks: verse.tokenLinks.map((link: TokenLink) => (link.id === linkId ? { ...link, ...patch } : link))
  };
}

function updateNote(verse: Verse, noteId: string, patch: Partial<VerseAnnotation>): Verse {
  return {
    ...verse,
    verseAnnotations: verse.verseAnnotations.map((note: VerseAnnotation) => (note.id === noteId ? { ...note, ...patch } : note))
  };
}

function updateMedia(verse: Verse, mediaId: string, patch: Partial<VerseMedia>): Verse {
  return {
    ...verse,
    verseMedia: verse.verseMedia.map((media: VerseMedia) => (media.id === mediaId ? { ...media, ...patch } : media))
  };
}

function setMetadataTouch(verse: Verse): Verse {
  return {
    ...verse,
    metadata: {
      ...verse.metadata,
      updatedAt: new Date().toISOString(),
      updatedBy: "author",
      version: verse.metadata.version + 1
    }
  };
}

function updateAnnotationLayout(
  verse: Verse,
  annotationId: string,
  patch: Partial<{ region: "above" | "below" | "inline"; xOffset: number; yOffset: number }>
): Verse {
  const current = verse.editorLayout.annotationPlacements[annotationId] ?? { region: "above" as const, xOffset: 0, yOffset: 0 };
  return {
    ...verse,
    editorLayout: {
      ...verse.editorLayout,
      annotationPlacements: {
        ...verse.editorLayout.annotationPlacements,
        [annotationId]: {
          ...current,
          ...patch
        }
      }
    }
  };
}

const WORD_COLOR_LABELS: Record<string, string> = {
  "": "unassigned",
  god: "God",
  good_angels: "Good angels",
  bad_angels: "Bad angels",
  person_name: "Person name",
  group_name: "Group name",
  people: "People",
  things: "Things",
  place_name: "Place name",
  place: "Place",
  time: "Time",
  number: "Number"
};

const ANNOTATION_TYPE_LABELS: Record<typeof ANNOTATION_TYPES[number], string> = {
  emoji: "emoji",
  icon: "icon",
  meaning: "meaning"
};

const WORD_COLOR_STYLES: Record<string, string> = {
  "": "#102033",
  god: "#7a3db8",
  good_angels: "#d29a00",
  bad_angels: "#9e8d54",
  person_name: "#5bb8ff",
  group_name: "#2d6fdb",
  people: "#1f97d4",
  things: "#f07d2c",
  place_name: "#14943f",
  place: "#74b94a",
  time: "#8b4a22",
  number: "#ff2222"
};

const DEFAULT_LINK_COLOR = "#000000";
const ANNOTATION_IMAGE_DRAG_MIME = "application/x-kjveasy-annotation-image";

const TOOLBAR_ICONS = {
  undo: "↶",
  redo: "↷",
  retokenize: "↻",
  pos: "Aa",
  color: "◐",
  margin: "▤",
  group: "⊞",
  ungroup: "⊟",
  annotationUp: "↑",
  annotationDown: "↓",
  split: "/",
  linkLeft: "⇠",
  linkRight: "⇢",
  delete: "🗑"
};

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized;
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getDominantWordColor(tokens: Token[]): Token["wordColorCategory"] {
  const counts = new Map<Token["wordColorCategory"], number>();
  tokens.forEach((token) => {
    const category = token.wordColorCategory ?? "";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  });

  return [...counts.entries()].sort((left, right) => {
    if (left[1] !== right[1]) {
      return right[1] - left[1];
    }
    if (left[0] === "") {
      return 1;
    }
    if (right[0] === "") {
      return -1;
    }
    return 0;
  })[0]?.[0] ?? "";
}

function buildLinkPath(x1: number, y1: number, x2: number, y2: number, laneY: number): string {
  const direction = x2 >= x1 ? 1 : -1;
  const verticalDrop = Math.max(6, laneY - Math.max(y1, y2));
  const radius = Math.max(4, Math.min(10, Math.abs(x2 - x1) / 4, verticalDrop));
  const startVerticalEnd = Math.max(y1 + 4, laneY - radius);
  const endVerticalStart = Math.max(y2 + 4, laneY - radius);
  return [
    `M ${x1} ${y1}`,
    `L ${x1} ${startVerticalEnd}`,
    `Q ${x1} ${laneY} ${x1 + direction * radius} ${laneY}`,
    `L ${x2 - direction * radius} ${laneY}`,
    `Q ${x2} ${laneY} ${x2} ${endVerticalStart}`,
    `L ${x2} ${y2}`
  ].join(" ");
}

function isDataImage(value: string): boolean {
  return value.startsWith("data:image/");
}

function summarizeAnnotationContent(content: AnnotationContentSegment[]): string {
  if (content.length === 0) {
    return "";
  }
  return content
    .map((segment) => {
      if (segment.type === "image") {
        return "[image]";
      }
      return segment.value;
    })
    .join(" ")
    .trim();
}

function getAnnotationContent(annotation: Pick<TokenAnnotation, "id" | "value" | "type" | "content">): AnnotationContentSegment[] {
  if (annotation.content && annotation.content.length > 0) {
    return annotation.content;
  }
  if (isDataImage(annotation.value)) {
    return [{ id: `${annotation.id}-image`, type: "image", value: annotation.value }];
  }
  return [{
    id: `${annotation.id}-text`,
    type: annotation.type === "emoji" ? "emoji" : "text",
    value: annotation.value
  }];
}

function setAnnotationContent<T extends Pick<TokenAnnotation, "type">>(
  annotation: T,
  content: AnnotationContentSegment[]
): Partial<T> & { value: string; content: AnnotationContentSegment[] } {
  const normalizedContent = content.filter((segment) => segment.value.trim().length > 0 || segment.type === "image");
  return {
    value: summarizeAnnotationContent(normalizedContent),
    content: normalizedContent
  } as Partial<T> & { value: string; content: AnnotationContentSegment[] };
}

function getAnnotationTextValue(annotation: Pick<TokenAnnotation, "id" | "value" | "type" | "content">): string {
  return getAnnotationContent(annotation)
    .filter((segment) => segment.type !== "image")
    .map((segment) => segment.value)
    .join(" ");
}

function updateAnnotationTextValue<T extends Pick<TokenAnnotation, "id" | "value" | "type" | "content">>(
  annotation: T,
  nextText: string
): Partial<T> & { value: string; content: AnnotationContentSegment[] } {
  const imageSegments = getAnnotationContent(annotation).filter((segment) => segment.type === "image");
  const textSegments = nextText.trim().length > 0
    ? [{ id: `${annotation.id}-text`, type: "text" as const, value: nextText }]
    : [];
  return setAnnotationContent(annotation, [...textSegments, ...imageSegments]);
}

function updateAnnotationSegmentValue<T extends Pick<TokenAnnotation, "id" | "value" | "type" | "content">>(
  annotation: T,
  segmentId: string,
  nextValue: string
): Partial<T> & { value: string; content: AnnotationContentSegment[] } {
  const nextContent = getAnnotationContent(annotation).map((segment) => (
    segment.id === segmentId ? { ...segment, value: nextValue } : segment
  ));
  return setAnnotationContent(annotation, nextContent);
}

function removeAnnotationSegment<T extends Pick<TokenAnnotation, "id" | "value" | "type" | "content">>(
  annotation: T,
  segmentId: string
): Partial<T> & { value: string; content: AnnotationContentSegment[] } {
  const content = getAnnotationContent(annotation);
  const currentIndex = content.findIndex((segment) => segment.id === segmentId);
  if (currentIndex === -1) {
    return setAnnotationContent(annotation, content);
  }
  const previousSegment = content[currentIndex - 1];
  const nextSegment = content[currentIndex + 1];
  const nextContent = content.filter((segment) => segment.id !== segmentId);
  if (
    previousSegment
    && nextSegment
    && previousSegment.type !== "image"
    && nextSegment.type !== "image"
  ) {
    const mergedSegment: AnnotationContentSegment = {
      ...previousSegment,
      value: `${previousSegment.value}${nextSegment.value}`
    };
    const filteredWithoutNeighbors = nextContent.filter((segment) => segment.id !== previousSegment.id && segment.id !== nextSegment.id);
    filteredWithoutNeighbors.splice(currentIndex - 1, 0, mergedSegment);
    return setAnnotationContent(annotation, filteredWithoutNeighbors);
  }
  return setAnnotationContent(annotation, nextContent);
}

function removeAnnotationSegmentWithFocus<T extends Pick<TokenAnnotation, "id" | "value" | "type" | "content">>(
  annotation: T,
  segmentId: string
): {
  patch: Partial<T> & { value: string; content: AnnotationContentSegment[] };
  focusSegmentId: string | null;
  focusOffset: number | null;
} {
  const content = getAnnotationContent(annotation);
  const currentIndex = content.findIndex((segment) => segment.id === segmentId);
  if (currentIndex === -1) {
    return {
      patch: setAnnotationContent(annotation, content),
      focusSegmentId: null,
      focusOffset: null
    };
  }

  const previousSegment = content[currentIndex - 1];
  const nextSegment = content[currentIndex + 1];
  if (previousSegment && nextSegment && previousSegment.type !== "image" && nextSegment.type !== "image") {
    return {
      patch: removeAnnotationSegment(annotation, segmentId),
      focusSegmentId: previousSegment.id,
      focusOffset: previousSegment.value.length
    };
  }
  if (previousSegment && previousSegment.type !== "image") {
    return {
      patch: removeAnnotationSegment(annotation, segmentId),
      focusSegmentId: previousSegment.id,
      focusOffset: previousSegment.value.length
    };
  }
  if (nextSegment && nextSegment.type !== "image") {
    return {
      patch: removeAnnotationSegment(annotation, segmentId),
      focusSegmentId: nextSegment.id,
      focusOffset: 0
    };
  }
  return {
    patch: removeAnnotationSegment(annotation, segmentId),
    focusSegmentId: null,
    focusOffset: null
  };
}

function moveAnnotationSegment<T extends Pick<TokenAnnotation, "id" | "value" | "type" | "content">>(
  annotation: T,
  segmentId: string,
  direction: "left" | "right"
): Partial<T> & { value: string; content: AnnotationContentSegment[] } {
  const content = [...getAnnotationContent(annotation)];
  const currentIndex = content.findIndex((segment) => segment.id === segmentId);
  if (currentIndex === -1) {
    return setAnnotationContent(annotation, content);
  }
  const targetIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= content.length) {
    return setAnnotationContent(annotation, content);
  }
  [content[currentIndex], content[targetIndex]] = [content[targetIndex], content[currentIndex]];
  return setAnnotationContent(annotation, content);
}

function insertImageIntoAnnotationContent<T extends Pick<TokenAnnotation, "id" | "value" | "type" | "content">>(
  annotation: T,
  imageValue: string,
  segmentId: string | null,
  caretOffset: number | null
): { patch: Partial<T> & { value: string; content: AnnotationContentSegment[] }; insertedSegmentId: string } {
  const content = [...getAnnotationContent(annotation)];
  const insertedSegmentId = createId("seg");
  const imageSegment: AnnotationContentSegment = { id: insertedSegmentId, type: "image", value: imageValue };

  if (!segmentId) {
    return {
      patch: setAnnotationContent(annotation, [...content, imageSegment]),
      insertedSegmentId
    };
  }

  const currentIndex = content.findIndex((segment) => segment.id === segmentId);
  if (currentIndex === -1) {
    return {
      patch: setAnnotationContent(annotation, [...content, imageSegment]),
      insertedSegmentId
    };
  }

  const currentSegment = content[currentIndex];
  if (currentSegment.type === "image") {
    const nextContent = [...content];
    nextContent.splice(currentIndex + 1, 0, imageSegment);
    return {
      patch: setAnnotationContent(annotation, nextContent),
      insertedSegmentId
    };
  }

  const splitOffset = Math.max(0, Math.min(caretOffset ?? currentSegment.value.length, currentSegment.value.length));
  const before = currentSegment.value.slice(0, splitOffset);
  const after = currentSegment.value.slice(splitOffset);
  const replacement: AnnotationContentSegment[] = [];

  if (before.length > 0) {
    replacement.push({ ...currentSegment, value: before });
  }
  replacement.push(imageSegment);
  if (after.length > 0) {
    replacement.push({ id: createId("seg"), type: currentSegment.type, value: after });
  }

  const nextContent = [...content];
  nextContent.splice(currentIndex, 1, ...replacement);
  return {
    patch: setAnnotationContent(annotation, nextContent),
    insertedSegmentId
  };
}

function mergeTextBoundaryBeforeSegment<T extends Pick<TokenAnnotation, "id" | "value" | "type" | "content">>(
  annotation: T,
  segmentId: string
): {
  patch: Partial<T> & { value: string; content: AnnotationContentSegment[] };
  focusSegmentId: string | null;
  focusOffset: number | null;
} {
  const content = getAnnotationContent(annotation);
  const currentIndex = content.findIndex((segment) => segment.id === segmentId);
  if (currentIndex <= 0) {
    return {
      patch: setAnnotationContent(annotation, content),
      focusSegmentId: segmentId,
      focusOffset: 0
    };
  }

  const currentSegment = content[currentIndex];
  const previousSegment = content[currentIndex - 1];
  const previousTextSegment = previousSegment?.type === "image" ? content[currentIndex - 2] : previousSegment;

  if (!currentSegment || currentSegment.type === "image") {
    return {
      patch: setAnnotationContent(annotation, content),
      focusSegmentId: null,
      focusOffset: null
    };
  }

  if (previousTextSegment && previousTextSegment.type !== "image") {
    const previousTextIndex = content.findIndex((segment) => segment.id === previousTextSegment.id);
    const boundaryIds = new Set<string>([previousTextSegment.id, currentSegment.id]);
    if (previousSegment?.type === "image") {
      boundaryIds.add(previousSegment.id);
    }
    const mergedValue = `${previousTextSegment.value}${currentSegment.value}`;
    const nextContent = content.filter((segment) => !boundaryIds.has(segment.id));
    nextContent.splice(previousTextIndex, 0, {
      ...previousTextSegment,
      value: mergedValue
    });
    return {
      patch: setAnnotationContent(annotation, nextContent),
      focusSegmentId: previousTextSegment.id,
      focusOffset: previousTextSegment.value.length
    };
  }

  if (previousSegment?.type === "image") {
    const nextContent = content.filter((segment) => segment.id !== previousSegment.id);
    return {
      patch: setAnnotationContent(annotation, nextContent),
      focusSegmentId: currentSegment.id,
      focusOffset: 0
    };
  }

  return {
    patch: setAnnotationContent(annotation, content),
    focusSegmentId: segmentId,
    focusOffset: 0
  };
}

function deleteBackwardFromAnnotationEnd<T extends Pick<TokenAnnotation, "id" | "value" | "type" | "content">>(
  annotation: T
): {
  patch: Partial<T> & { value: string; content: AnnotationContentSegment[] };
  focusSegmentId: string | null;
  focusOffset: number | null;
} {
  const content = getAnnotationContent(annotation);
  if (content.length === 0) {
    return {
      patch: setAnnotationContent(annotation, content),
      focusSegmentId: null,
      focusOffset: null
    };
  }

  const lastSegment = content[content.length - 1];
  if (lastSegment.type === "image") {
    const previousSegment = content.length > 1 ? content[content.length - 2] : null;
    return {
      patch: removeAnnotationSegment(annotation, lastSegment.id),
      focusSegmentId: previousSegment?.id ?? null,
      focusOffset: previousSegment && previousSegment.type !== "image" ? previousSegment.value.length : null
    };
  }

  if (lastSegment.value.length > 0) {
    const nextValue = lastSegment.value.slice(0, -1);
    if (nextValue.length > 0) {
      return {
        patch: updateAnnotationSegmentValue(annotation, lastSegment.id, nextValue),
        focusSegmentId: lastSegment.id,
        focusOffset: nextValue.length
      };
    }
    const previousSegment = content.length > 1 ? content[content.length - 2] : null;
    return {
      patch: removeAnnotationSegment(annotation, lastSegment.id),
      focusSegmentId: previousSegment?.id ?? null,
      focusOffset: previousSegment && previousSegment.type !== "image" ? previousSegment.value.length : null
    };
  }

  return {
    patch: setAnnotationContent(annotation, content),
    focusSegmentId: lastSegment.id,
    focusOffset: 0
  };
}

function deleteLastCharacterFromTextSegment<T extends Pick<TokenAnnotation, "id" | "value" | "type" | "content">>(
  annotation: T,
  segmentId: string
): {
  patch: Partial<T> & { value: string; content: AnnotationContentSegment[] };
  focusSegmentId: string | null;
  focusOffset: number | null;
} {
  const content = getAnnotationContent(annotation);
  const currentIndex = content.findIndex((segment) => segment.id === segmentId);
  if (currentIndex === -1) {
    return {
      patch: setAnnotationContent(annotation, content),
      focusSegmentId: null,
      focusOffset: null
    };
  }

  const currentSegment = content[currentIndex];
  if (currentSegment.type === "image") {
    return removeAnnotationSegmentWithFocus(annotation, segmentId);
  }

  if (currentSegment.value.length > 1) {
    const nextValue = currentSegment.value.slice(0, -1);
    return {
      patch: updateAnnotationSegmentValue(annotation, segmentId, nextValue),
      focusSegmentId: segmentId,
      focusOffset: nextValue.length
    };
  }

  const previousSegment = content[currentIndex - 1];
  return {
    patch: removeAnnotationSegment(annotation, segmentId),
    focusSegmentId: previousSegment?.id ?? null,
    focusOffset: previousSegment && previousSegment.type !== "image" ? previousSegment.value.length : null
  };
}

function moveGroupAnnotationsToToken(verse: Verse, group: TokenGroup, tokenId: string): Verse {
  if (group.annotations.length === 0) {
    return {
      ...verse,
      tokenGroups: verse.tokenGroups.filter((entry: TokenGroup) => entry.id !== group.id)
    };
  }

  const existingCount = verse.tokenAnnotations.filter((annotation: TokenAnnotation) => annotation.tokenId === tokenId).length;
  const migratedAnnotations = group.annotations.map((annotation: GroupAnnotation, index: number): TokenAnnotation => ({
    id: annotation.id,
    tokenId,
    type: annotation.type,
      value: annotation.value,
      content: annotation.content,
      label: annotation.label,
      placement: "above",
      orderIndex: existingCount + index,
      styleKey: undefined
    }));

  return {
    ...verse,
    tokenAnnotations: [...verse.tokenAnnotations, ...migratedAnnotations],
    tokenGroups: verse.tokenGroups.filter((entry: TokenGroup) => entry.id !== group.id)
  };
}

function cleanupGroups(verse: Verse): Verse {
  let nextVerse = { ...verse };
  const validTokenIds = new Set(nextVerse.tokens.map((token: Token) => token.id));
  const groupsToMigrate = nextVerse.tokenGroups.filter((group: TokenGroup) => group.tokenIds.filter((tokenId) => validTokenIds.has(tokenId)).length < 2);

  groupsToMigrate.forEach((group) => {
    const remainingTokenIds = group.tokenIds.filter((tokenId) => validTokenIds.has(tokenId));
    if (remainingTokenIds.length >= 1) {
      nextVerse = moveGroupAnnotationsToToken(nextVerse, { ...group, tokenIds: remainingTokenIds }, remainingTokenIds[0]);
    } else {
      nextVerse = {
        ...nextVerse,
        tokenGroups: nextVerse.tokenGroups.filter((entry: TokenGroup) => entry.id !== group.id)
      };
    }
  });

  nextVerse = {
    ...nextVerse,
    tokenGroups: nextVerse.tokenGroups.map((group: TokenGroup) => ({
      ...group,
      tokenIds: group.tokenIds.filter((tokenId) => validTokenIds.has(tokenId))
    }))
  };

  return nextVerse;
}

function readClipboardImageDataUrl(file: File, size = 44): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the pasted image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Could not decode the pasted image."));
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Could not prepare the image canvas."));
          return;
        }

        const sourceSize = Math.min(image.width, image.height);
        const sourceX = (image.width - sourceSize) / 2;
        const sourceY = (image.height - sourceSize) / 2;
        context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
        resolve(canvas.toDataURL("image/png"));
      };
      image.src = typeof reader.result === "string" ? reader.result : "";
    };
    reader.readAsDataURL(file);
  });
}

function getLayoutWarnings(verse: Verse): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];
  const grouped = new Map<string, Array<{ id: string; xOffset: number; yOffset: number }>>();

  verse.tokenAnnotations.forEach((annotation: TokenAnnotation) => {
    const layout = verse.editorLayout.annotationPlacements[annotation.id] ?? { region: "above", xOffset: 0, yOffset: 0 };
    const key = `${annotation.tokenId}:${layout.region}`;
    const entries = grouped.get(key) ?? [];
    entries.push({ id: annotation.id, xOffset: layout.xOffset, yOffset: layout.yOffset });
    grouped.set(key, entries);

    if (Math.abs(layout.xOffset) > 70 || Math.abs(layout.yOffset) > 70) {
      warnings.push({
        path: `editorLayout.annotationPlacements.${annotation.id}`,
        message: `Annotation ${annotation.id} is near the edge of its bounded region.`,
        severity: "warning"
      });
    }
  });

  grouped.forEach((entries: Array<{ id: string; xOffset: number; yOffset: number }>, key: string) => {
    if (entries.length > 2) {
      warnings.push({
        path: key,
        message: "This token has many annotations in the same region and may become hard to read.",
        severity: "warning"
      });
    }
  });

  return warnings;
}

function parseIssueId(message: string, prefixes: string[]): string | null {
  for (const prefix of prefixes) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = message.match(new RegExp(`${escaped}\\s+([^\\s.]+)`));
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function App() {
  const [navigation, setNavigation] = useState<NavigationData>({ books: [] });
  const [dashboard, setDashboard] = useState<DashboardData>({ chapters: [], mediaLibraryCount: 0, exportJobs: [] });
  const [selectedBook, setSelectedBook] = useState("");
  const [selectedChapter, setSelectedChapter] = useState(0);
  const [verse, setVerse] = useState<Verse | null>(null);
  const [mediaLibrary, setMediaLibrary] = useState<MediaLibraryAsset[]>([]);
  const [selection, setSelection] = useState<Selection>({ type: "verse" });
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>([]);
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([]);
  const [selectedAnnotationSlotKeys, setSelectedAnnotationSlotKeys] = useState<string[]>([]);
  const [selectedAnnotationSegmentId, setSelectedAnnotationSegmentId] = useState<string | null>(null);
  const [selectedAnnotationCaret, setSelectedAnnotationCaret] = useState<{ segmentId: string; offset: number } | null>(null);
  const [pendingAnnotationFocus, setPendingAnnotationFocus] = useState<{ segmentId: string; offset: number | null } | null>(null);
  const [message, setMessage] = useState("Loading chapter workspace...");
  const [isSaving, setIsSaving] = useState(false);
  const [selectedJob, setSelectedJob] = useState<ExportJob | null>(null);
  const [selectedManifest, setSelectedManifest] = useState<PublishManifest | null>(null);
  const [historyPast, setHistoryPast] = useState<Verse[]>([]);
  const [historyFuture, setHistoryFuture] = useState<Verse[]>([]);
  const [tokenPositions, setTokenPositions] = useState<Record<string, TokenPosition>>({});
  const [linkDrag, setLinkDrag] = useState<LinkDragState | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const isAutosaving = useRef(false);
  const suppressHistory = useRef(false);
  const suppressTokenClick = useRef(false);
  const tokenCanvasRef = useRef<HTMLDivElement | null>(null);
  const tokenRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const annotationSegmentRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const annotationTextInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const selectedAnnotationIdsRef = useRef<string[]>([]);
  const selectedAnnotationSlotKeysRef = useRef<string[]>([]);
  const selectionRef = useRef<Selection>({ type: "verse" });

  async function fetchNavigation() {
    const data = await getNavigationData();
    setNavigation(data);
    return data;
  }

  async function fetchDashboard() {
    const data = await getDashboardData();
    setDashboard(data);
    return data;
  }

  async function loadJob(jobId: string) {
    const data = await getExportJobData(jobId);
    setSelectedJob(data.job);
    setSelectedManifest(data.manifest);
  }

  async function fetchMediaLibrary() {
    const data = await getMediaLibraryAssets();
    setMediaLibrary(data.assets);
  }

  function requestAnnotationFocus(segmentId: string | null, offset: number | null = null) {
    setSelectedAnnotationSegmentId(segmentId);
    setSelectedAnnotationCaret(
      segmentId && offset !== null
        ? { segmentId, offset }
        : null
    );
    setPendingAnnotationFocus(segmentId ? { segmentId, offset } : null);
  }

  function replaceVerse(nextVerse: Verse) {
    suppressHistory.current = true;
    setVerse(nextVerse);
  }

  async function loadVerse(verseId: string) {
    const data = await getVerseContextData(verseId);
    replaceVerse(data.verse);
    setSelection({ type: "verse" });
    setSelectedTokenIds([]);
    setSelectedBook(data.verse.reference.book);
    setSelectedChapter(data.verse.reference.chapter);
    setHistoryPast([]);
    setHistoryFuture([]);
    setMessage(`Loaded ${data.verse.reference.book} ${data.verse.reference.chapter}:${data.verse.reference.verse}`);
  }

  useEffect(() => {
    ensureLocalData();
    Promise.all([fetchNavigation(), fetchDashboard(), fetchMediaLibrary()])
      .then(([nav, dash]) => {
        const firstChapter = dash.chapters[0] ?? {
          book: nav.books[0]?.book ?? "",
          chapter: nav.books[0]?.chapters[0]?.chapter ?? 0
        };
        setSelectedBook(firstChapter.book);
        setSelectedChapter(firstChapter.chapter);
        const firstVerse = nav.books[0]?.chapters[0]?.verses[0]?.verseId;
        if (firstVerse) {
          void loadVerse(firstVerse);
        } else {
          setMessage("No verse data found. Seed the sample data or import a verse.");
        }
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Failed to load the editor workspace.");
      });
  }, []);

  useEffect(() => {
    if (!verse || suppressHistory.current) {
      suppressHistory.current = false;
      return;
    }
    if (autosaveTimer.current) {
      window.clearTimeout(autosaveTimer.current);
    }
    autosaveTimer.current = window.setTimeout(async () => {
      if (!verse) {
        return;
      }
      try {
        isAutosaving.current = true;
        const data = await saveVerseData(verse);
        replaceVerse(data.verse);
        setMessage("Autosaved after your recent edit.");
        fetchNavigation();
        fetchDashboard();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Autosave failed.");
      } finally {
        isAutosaving.current = false;
      }
    }, 3000);

    return () => {
      if (autosaveTimer.current) {
        window.clearTimeout(autosaveTimer.current);
      }
    };
  }, [verse]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) {
        return;
      }

      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }

      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
      }

      if ((event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y") {
        event.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [verse, historyPast, historyFuture]);

  useEffect(() => {
    if (!verse) {
      return;
    }
    const activeVerse: Verse = verse;

    async function handlePaste(event: ClipboardEvent) {
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (!imageItem) {
        return;
      }

      if (!(selection.type === "token" && selectedTokenIds.length === 1) && selection.type !== "annotation") {
        setMessage("Select a single token or an icon annotation before pasting an image.");
        return;
      }

      const file = imageItem.getAsFile();
      if (!file) {
        return;
      }

      event.preventDefault();

      try {
        const dataUrl = await readClipboardImageDataUrl(file);

        if (selection.type === "annotation") {
          const existingTokenAnnotation = activeVerse.tokenAnnotations.find((entry: TokenAnnotation) => entry.id === selection.id);
          const existingGroupAnnotation = activeVerse.tokenGroups
            .flatMap((group: TokenGroup) => group.annotations)
            .find((entry: GroupAnnotation) => entry.id === selection.id);
          const existingAnnotation = existingTokenAnnotation ?? existingGroupAnnotation;
          if (!existingAnnotation) {
            setMessage("The selected annotation could not be found.");
            return;
          }
          const { patch, insertedSegmentId } = insertImageIntoAnnotationContent(
            existingAnnotation,
            dataUrl,
            selectedAnnotationSegmentId,
            selectedAnnotationCaret?.segmentId === selectedAnnotationSegmentId ? selectedAnnotationCaret.offset : null
          );
          if ("tokenId" in existingAnnotation) {
            applyVerseUpdate(updateAnnotation(activeVerse, existingAnnotation.id, patch));
          } else {
            applyVerseUpdate(updateGroupAnnotation(activeVerse, existingAnnotation.id, patch));
          }
          requestAnnotationFocus(insertedSegmentId, null);
          setMessage("Added the pasted image to the selected annotation.");
          return;
        }

        const tokenId = selectedTokenIds[0];
        const orderIndex = activeVerse.tokenAnnotations.filter((entry: TokenAnnotation) => entry.tokenId === tokenId).length;
        const tokenAnnotation: TokenAnnotation = {
          id: createId("ann"),
          tokenId,
          type: "icon",
          value: "[image]",
          content: [{ id: createId("seg"), type: "image", value: dataUrl }],
          label: "pasted icon",
          placement: "above",
          orderIndex
        };
        let nextVerse = { ...activeVerse, tokenAnnotations: [...activeVerse.tokenAnnotations, tokenAnnotation] };
        nextVerse = updateAnnotationLayout(nextVerse, tokenAnnotation.id, { region: "above", xOffset: 0, yOffset: 0 });
        applyVerseUpdate(nextVerse);
        setSelection({ type: "annotation", id: tokenAnnotation.id });
        setSelectedTokenIds([]);
        setMessage("Created an icon annotation from the pasted image.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not paste the image.");
      }
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [verse, selection, selectedTokenIds]);

  useEffect(() => {
    selectedAnnotationIdsRef.current = selectedAnnotationIds;
  }, [selectedAnnotationIds]);

  useEffect(() => {
    selectedAnnotationSlotKeysRef.current = selectedAnnotationSlotKeys;
  }, [selectedAnnotationSlotKeys]);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    if (selection.type !== "annotation") {
      setSelectedAnnotationSegmentId(null);
      setSelectedAnnotationCaret(null);
      setPendingAnnotationFocus(null);
    }
  }, [selection]);

  useEffect(() => {
    if (!pendingAnnotationFocus?.segmentId) {
      return;
    }
    window.requestAnimationFrame(() => {
      const textTarget = annotationTextInputRefs.current[pendingAnnotationFocus.segmentId];
      if (textTarget) {
        const offset = pendingAnnotationFocus.offset ?? textTarget.value.length;
        textTarget.focus();
        textTarget.setSelectionRange(offset ?? textTarget.value.length, offset ?? textTarget.value.length);
        setPendingAnnotationFocus(null);
        return;
      }
      const imageTarget = annotationSegmentRefs.current[pendingAnnotationFocus.segmentId];
      if (imageTarget) {
        imageTarget.focus();
      }
      setPendingAnnotationFocus(null);
    });
  }, [pendingAnnotationFocus]);

  useEffect(() => {
    if (!verse) {
      return;
    }
    const activeVerse = verse;

    function measureTokenPositions() {
      const canvas = tokenCanvasRef.current;
      if (!canvas) {
        return;
      }
      const canvasRect = canvas.getBoundingClientRect();
      const nextPositions: Record<string, TokenPosition> = {};
      activeVerse.tokens.forEach((token) => {
        const element = tokenRefs.current[token.id];
        if (!element) {
          return;
        }
        const rect = element.getBoundingClientRect();
        nextPositions[token.id] = {
          x: rect.left - canvasRect.left,
          y: rect.top - canvasRect.top,
          width: rect.width,
          height: rect.height
        };
      });
      setTokenPositions(nextPositions);
    }

    const frameId = window.requestAnimationFrame(measureTokenPositions);
    window.addEventListener("resize", measureTokenPositions);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", measureTokenPositions);
    };
  }, [verse]);

  useEffect(() => {
    if (selection.type === "annotation") {
      setSelectedAnnotationIds((current) => current.includes(selection.id) ? current : [selection.id]);
    } else if (selectedAnnotationIds.length > 0) {
      setSelectedAnnotationIds([]);
    }

    if (selection.type === "annotation-slot") {
      const key = annotationSlotKey(selection.ownerType, selection.ownerId, selection.lane);
      setSelectedAnnotationSlotKeys((current) => current.includes(key) ? current : [key]);
    } else if (selectedAnnotationSlotKeys.length > 0) {
      setSelectedAnnotationSlotKeys([]);
    }
  }, [selection]);

  useEffect(() => {
    if (!linkDrag || !verse) {
      return;
    }
    const activeVerse = verse;
    const activeDrag = linkDrag;

    function handlePointerMove(event: PointerEvent) {
      const canvas = tokenCanvasRef.current;
      if (!canvas) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const currentX = event.clientX - rect.left;
      const currentY = event.clientY - rect.top;
      const movedEnough = Math.hypot(currentX - activeDrag.startX, currentY - activeDrag.startY) > 8;
      setLinkDrag((current) => current ? {
        ...current,
        currentX,
        currentY,
        isDragging: current.isDragging || movedEnough
      } : null);
    }

    function handlePointerUp(event: PointerEvent) {
      const currentDrag = activeDrag;
      setLinkDrag(null);
      if (!currentDrag.isDragging) {
        return;
      }

      const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-token-id]");
      const targetTokenId = targetElement instanceof HTMLElement ? targetElement.dataset.tokenId : undefined;

      if (!targetTokenId || targetTokenId === currentDrag.sourceTokenId) {
        suppressTokenClick.current = true;
        return;
      }

      const sourceToken = activeVerse.tokens.find((entry: Token) => entry.id === currentDrag.sourceTokenId);
      const targetToken = activeVerse.tokens.find((entry: Token) => entry.id === targetTokenId);
      if (!sourceToken || !targetToken) {
        suppressTokenClick.current = true;
        return;
      }

      const duplicateLink = activeVerse.tokenLinks.find((entry: TokenLink) => entry.sourceTokenId === sourceToken.id && entry.targetTokenId === targetToken.id && entry.type === "antecedent");
      if (duplicateLink) {
        setSelection({ type: "link", id: duplicateLink.id });
        setSelectedTokenIds([]);
        setMessage("That antecedent link already exists.");
        suppressTokenClick.current = true;
        return;
      }

      const newLink: TokenLink = {
        id: createId("link"),
        sourceTokenId: sourceToken.id,
        targetTokenId: targetToken.id,
        type: "antecedent",
        wordColorCategory: sourceToken.wordColorCategory || targetToken.wordColorCategory || "",
        label: `${sourceToken.surfaceText} -> ${targetToken.surfaceText}`
      };
      applyVerseUpdate({ ...activeVerse, tokenLinks: [...activeVerse.tokenLinks, newLink] });
      setSelection({ type: "link", id: newLink.id });
      setSelectedTokenIds([]);
      setMessage(`Created a link from ${sourceToken.surfaceText} to ${targetToken.surfaceText}.`);
      suppressTokenClick.current = true;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [linkDrag, verse]);

  const issues = useMemo(() => {
    if (!verse) {
      return [];
    }
    return [...validateVerse(verse), ...getLayoutWarnings(verse)];
  }, [verse]);

  const selectedBookEntry = useMemo(
    () => navigation.books.find((entry) => entry.book === selectedBook) ?? null,
    [navigation.books, selectedBook]
  );

  const selectedChapterEntry = useMemo(
    () => selectedBookEntry?.chapters.find((entry) => entry.chapter === selectedChapter) ?? null,
    [selectedBookEntry, selectedChapter]
  );

  const nearbyVerseEntries = useMemo(() => {
    return (selectedChapterEntry?.verses ?? []).filter((entry: NavigationVerseEntry) => entry.verseId !== verse?.verseId);
  }, [selectedChapterEntry, verse]);

  function applyVerseUpdate(next: Verse) {
    if (!verse) {
      replaceVerse(next);
      return;
    }
    setHistoryPast((current) => [...current.slice(-49), cloneVerse(verse)]);
    setHistoryFuture([]);
    setVerse(setMetadataTouch(next));
  }

  function handleUndo() {
    if (!verse || historyPast.length === 0) {
      return;
    }
    const previous = historyPast[historyPast.length - 1];
    setHistoryPast((current) => current.slice(0, -1));
    setHistoryFuture((current) => [cloneVerse(verse), ...current].slice(0, 50));
    replaceVerse(previous);
    setMessage("Undid the last editing action.");
  }

  function handleRedo() {
    if (!verse || historyFuture.length === 0) {
      return;
    }
    const next = historyFuture[0];
    setHistoryFuture((current) => current.slice(1));
    setHistoryPast((current) => [...current, cloneVerse(verse)].slice(-50));
    replaceVerse(next);
    setMessage("Redid the next editing action.");
  }

  async function handleSave() {
    if (!verse) return;
    setIsSaving(true);
    try {
      const data = await saveVerseData(verse);
      replaceVerse(data.verse);
      setMessage("Verse saved.");
      await Promise.all([fetchNavigation(), fetchDashboard()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExport() {
    if (!verse) return;
    const data = await exportVerseData(verse.verseId);
    downloadJsonFile(`${verse.verseId}.json`, data);
    setMessage("Verse exported.");
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    try {
      const data = await importVerseData(parsed);
      replaceVerse(data.verse);
      setSelection({ type: "verse" });
      setSelectedTokenIds([]);
      setSelectedBook(data.verse.reference.book);
      setSelectedChapter(data.verse.reference.chapter);
      setSelectedJob(null);
      setSelectedManifest(null);
      setHistoryPast([]);
      setHistoryFuture([]);
      setMessage("Verse imported into the editor. Save to persist it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    }
  }

  async function handleCreateExportJob(mode: "export" | "publish", scopeType: "chapter" | "book") {
    if (!verse) return;
    try {
      const payload = {
        mode,
        scopeType,
        book: selectedBook || verse.reference.book,
        chapter: scopeType === "chapter" ? selectedChapter || verse.reference.chapter : undefined
      };
      const data = await createExportJobData(payload.mode, payload.scopeType, payload.book, payload.chapter);
      setSelectedJob(data.job);
      setSelectedManifest(data.manifest);
      await fetchDashboard();
      setMessage(
        data.job.status === "completed"
          ? `${mode === "publish" ? "Publish" : "Export"} package created.`
          : `${mode === "publish" ? "Publish" : "Export"} blocked: ${data.job.errorMessage ?? "validation failed"}`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create export job.");
    }
  }

  function handleAddVerseNote() {
    if (!verse) return;
    const newNote: VerseAnnotation = {
      id: createId("note"),
      verseId: verse.verseId,
      category: "context",
      body: "New verse note"
    };
    applyVerseUpdate({ ...verse, verseAnnotations: [...verse.verseAnnotations, newNote] });
    setSelection({ type: "note", id: newNote.id });
    setSelectedTokenIds([]);
  }

  function handleAddToken() {
    if (!verse) return;
    const newToken: Token = {
      id: createId("tok"),
      verseId: verse.verseId,
      order: verse.tokens.length,
      surfaceText: "new",
      normalizedText: "new",
      partOfSpeech: "",
      wordColorCategory: "",
      isProperNoun: false,
      isEditorial: false
    };
    applyVerseUpdate({ ...verse, tokens: [...verse.tokens, newToken] });
    setSelection({ type: "token", id: newToken.id });
    setSelectedTokenIds([newToken.id]);
  }

  function handleAddLink() {
    if (!verse || verse.tokens.length < 2) return;
    const source = verse.tokens[0];
    const target = verse.tokens[1];
    const newLink: TokenLink = {
      id: createId("link"),
      sourceTokenId: source.id,
      targetTokenId: target.id,
      type: "antecedent",
      wordColorCategory: source.wordColorCategory || target.wordColorCategory || "",
      label: `${source.surfaceText} -> ${target.surfaceText}`
    };
    applyVerseUpdate({ ...verse, tokenLinks: [...verse.tokenLinks, newLink] });
    setSelection({ type: "link", id: newLink.id });
    setSelectedTokenIds([]);
  }

  function handleSetLinkDirection(direction: "left" | "right") {
    if (!verse || !link) {
      return;
    }

    const sourceToken = verse.tokens.find((entry: Token) => entry.id === link.sourceTokenId);
    const targetToken = verse.tokens.find((entry: Token) => entry.id === link.targetTokenId);
    if (!sourceToken || !targetToken) {
      return;
    }

    const orderedTokens = [sourceToken, targetToken].sort((left, right) => left.order - right.order);
    const leftToken = orderedTokens[0];
    const rightToken = orderedTokens[1];
    const nextSourceTokenId = direction === "right" ? leftToken.id : rightToken.id;
    const nextTargetTokenId = direction === "right" ? rightToken.id : leftToken.id;

    if (link.sourceTokenId === nextSourceTokenId && link.targetTokenId === nextTargetTokenId) {
      return;
    }

    applyVerseUpdate(updateLink(verse, link.id, {
      sourceTokenId: nextSourceTokenId,
      targetTokenId: nextTargetTokenId,
      label: `${verse.tokens.find((entry: Token) => entry.id === nextSourceTokenId)?.surfaceText ?? nextSourceTokenId} -> ${verse.tokens.find((entry: Token) => entry.id === nextTargetTokenId)?.surfaceText ?? nextTargetTokenId}`
    }));
    setMessage(`Updated the selected link to point ${direction}.`);
  }

  function handleAddTokenAnnotation() {
    if (!verse) {
      return;
    }
    const annotationSlot = selectedAnnotationSlot();
    const targetGroup = annotationSlot?.ownerType === "group"
      ? verse.tokenGroups.find((entry: TokenGroup) => entry.id === annotationSlot.ownerId) ?? null
      : group;
    const targetSubgroup = annotationSlot?.ownerType === "subgroup"
      ? (() => {
          for (const groupEntry of verse.tokenGroups) {
            const subgroup = groupEntry.annotationSubgroups.find((entry) => entry.id === annotationSlot.ownerId);
            if (subgroup) {
              return { group: groupEntry, subgroup };
            }
          }
          return null;
        })()
      : null;
    const targetToken = annotationSlot?.ownerType === "token"
      ? verse.tokens.find((entry: Token) => entry.id === annotationSlot.ownerId) ?? null
      : token;

    if (targetSubgroup) {
      const existingSharedAnnotation = targetSubgroup.group.annotations.find((entry: GroupAnnotation) => entry.subgroupId === targetSubgroup.subgroup.id);
      if (existingSharedAnnotation) {
        setMessage("That annotation subgroup already has a shared annotation.");
        return;
      }
      const subgroupAnnotation: GroupAnnotation = {
        id: createId("ann"),
        groupId: targetSubgroup.group.id,
        subgroupId: targetSubgroup.subgroup.id,
        type: "meaning",
        value: "",
        content: [],
        label: "subgroup annotation",
        wordColorCategory: "",
        orderIndex: 0
      };
      applyVerseUpdate(updateGroup(verse, targetSubgroup.group.id, {
        annotations: [...targetSubgroup.group.annotations, subgroupAnnotation]
      }));
      setSelection({ type: "annotation", id: subgroupAnnotation.id });
      setSelectedTokenIds([]);
      return;
    }

    if (targetGroup) {
      const targetLane = annotationSlot?.ownerType === "group"
        ? annotationSlot.lane
        : ([0, 1].find((lane) =>
          getGroupLaneMode(targetGroup, lane) === "grouped"
          && targetGroup.annotations.filter((entry) => !isMarginNoteAnnotation(entry) && !entry.subgroupId && (entry.orderIndex ?? 1) === lane).length < 1
        ) ?? 1);
      if (getGroupLaneMode(targetGroup, targetLane) !== "grouped") {
        setMessage(`Annotation row ${targetLane + 1} is split, so add annotations to token or subgroup slots there.`);
        return;
      }
      if (targetGroup.annotations.filter((entry) => !isMarginNoteAnnotation(entry) && !entry.subgroupId && (entry.orderIndex ?? 1) === targetLane).length >= 1) {
        setMessage(`That group already has a shared annotation on row ${targetLane + 1}.`);
        return;
      }
      const groupAnnotation: GroupAnnotation = {
        id: createId("ann"),
        groupId: targetGroup.id,
        type: "meaning",
        value: "",
        content: [],
        label: "group annotation",
        wordColorCategory: "",
        orderIndex: targetLane
      };
      applyVerseUpdate(updateGroup(verse, targetGroup.id, { annotations: [...targetGroup.annotations, groupAnnotation] }));
      setSelection({ type: "annotation", id: groupAnnotation.id });
      setSelectedTokenIds([]);
      return;
    }
    if (!targetToken) return;
    const parentGroup = tokenGroupForToken.get(targetToken.id) ?? null;
    const existingTokenAnnotations = verse.tokenAnnotations
      .filter((entry: TokenAnnotation) => entry.tokenId === targetToken.id)
      .sort((left: TokenAnnotation, right: TokenAnnotation) => (left.orderIndex ?? 0) - (right.orderIndex ?? 0));
    const existingTokenAnnotationCount = existingTokenAnnotations.length;
    const maxTokenAnnotationRows = parentGroup ? [0, 1].filter((lane) => getGroupLaneMode(parentGroup, lane) === "split").length : 2;
    if (parentGroup && existingTokenAnnotationCount >= maxTokenAnnotationRows) {
      setMessage("That group has no open split token-annotation rows.");
      return;
    }
    const requestedLane = annotationSlot?.ownerType === "token" ? annotationSlot.lane : null;
    if (parentGroup && requestedLane !== null) {
      const occupyingSubgroup = parentGroup.annotationSubgroups.find((entry) => entry.lane === requestedLane && entry.tokenIds.includes(targetToken.id));
      if (occupyingSubgroup) {
        setMessage("That token lane is already part of an annotation subgroup.");
        return;
      }
      if (getGroupLaneMode(parentGroup, requestedLane) !== "split") {
        setMessage(`Split annotation row ${requestedLane + 1} before adding token annotations there.`);
        return;
      }
    }
    const nextOrderIndex = requestedLane ?? getLowestUnusedLane(existingTokenAnnotations.map((entry) => entry.orderIndex ?? 0), maxTokenAnnotationRows) ?? existingTokenAnnotationCount;
    const tokenAnnotation: TokenAnnotation = {
      id: createId("ann"),
      tokenId: targetToken.id,
      type: "meaning",
      value: "",
      content: [],
      label: "new annotation",
      placement: "above",
      orderIndex: nextOrderIndex
    };
    let nextVerse = { ...verse, tokenAnnotations: [...verse.tokenAnnotations, tokenAnnotation] };
    nextVerse = updateAnnotationLayout(nextVerse, tokenAnnotation.id, { region: "above", xOffset: 0, yOffset: 0 });
    applyVerseUpdate(nextVerse);
    setSelection({ type: "annotation", id: tokenAnnotation.id });
    setSelectedTokenIds([]);
  }

  function handleCreateGroup() {
    if (!verse) {
      return;
    }
    if (selectedGroupedLaneSelection && selectedGroupedLaneSelection.tokenIds.length > 1) {
      const selectedIdSet = new Set(selectedGroupedLaneSelection.tokenIds);
      const orderedSelectedTokens = verse.tokens.filter((entry: Token) => selectedIdSet.has(entry.id));
      const parentGroups = orderedSelectedTokens
        .map((entry: Token) => tokenGroupForToken.get(entry.id) ?? null)
        .filter((entry): entry is TokenGroup => Boolean(entry));
      const parentGroup = parentGroups[0];
      if (
        parentGroup
        && parentGroups.length === orderedSelectedTokens.length
        && parentGroups.every((entry) => entry.id === parentGroup.id)
        && getGroupLaneMode(parentGroup, selectedGroupedLaneSelection.lane) === "split"
      ) {
        const overlappingSubgroups = parentGroup.annotationSubgroups.filter((entry) => entry.lane === selectedGroupedLaneSelection.lane && entry.tokenIds.some((tokenId) => selectedIdSet.has(tokenId)));
        const subgroupAnnotationToKeep = parentGroup.annotations.find((entry: GroupAnnotation) => entry.subgroupId && overlappingSubgroups.some((subgroup) => subgroup.id === entry.subgroupId)) ?? null;
        const preservedAnnotations = parentGroup.annotations.filter((entry: GroupAnnotation) => {
          if (!entry.subgroupId) {
            return true;
          }
          return !overlappingSubgroups.some((subgroup) => subgroup.id === entry.subgroupId);
        });
        const rebuiltSubgroup = {
          id: overlappingSubgroups[0]?.id ?? createId("subgroup"),
          lane: selectedGroupedLaneSelection.lane,
          tokenIds: orderedSelectedTokens.map((entry: Token) => entry.id)
        };
        applyVerseUpdate(updateGroup(verse, parentGroup.id, {
          annotationSubgroups: [
            ...parentGroup.annotationSubgroups.filter((entry) => !overlappingSubgroups.some((subgroup) => subgroup.id === entry.id)),
            rebuiltSubgroup
          ],
          annotations: subgroupAnnotationToKeep
            ? [...preservedAnnotations, { ...subgroupAnnotationToKeep, subgroupId: rebuiltSubgroup.id }]
            : preservedAnnotations
        }));
        setSelection({ type: "annotation-subgroup", id: rebuiltSubgroup.id });
        setSelectedTokenIds([]);
        setSelectedAnnotationIds([]);
        setSelectedAnnotationSlotKeys([]);
        setMessage(`Grouped ${orderedSelectedTokens.length} annotation lane slots on row ${selectedGroupedLaneSelection.lane + 1}.`);
        return;
      }
    }
    if (selectedTokenIds.length < 2) {
      return;
    }
    const selectedIdSet = new Set(selectedTokenIds);
    const orderedSelectedTokens = verse.tokens.filter((entry: Token) => selectedIdSet.has(entry.id));
    const orderedIndexes = orderedSelectedTokens.map((entry: Token) => verse.tokens.findIndex((tokenItem: Token) => tokenItem.id === entry.id));
    const isContiguous = orderedIndexes.length > 1 && orderedIndexes.every((index: number, position: number) => position === 0 || index === orderedIndexes[position - 1] + 1);
    if (!isContiguous) {
      setMessage("Grouping requires a contiguous token selection.");
      return;
    }
    const parentGroups = orderedSelectedTokens
      .map((entry: Token) => tokenGroupForToken.get(entry.id) ?? null)
      .filter((entry): entry is TokenGroup => Boolean(entry));
    const sameParentGroup = parentGroups.length === orderedSelectedTokens.length
      && parentGroups.every((entry) => entry.id === parentGroups[0].id);
    if (sameParentGroup) {
      const parentGroup = parentGroups[0];
      if (getGroupLaneMode(parentGroup, selectedGroupedLaneSelection?.lane ?? 1) !== "split") {
      setMessage(`Split annotation row ${(selectedGroupedLaneSelection?.lane ?? 1) + 1} before grouping slots there.`);
      return;
    }
      const subgroupedTokenIds = new Set(parentGroup.annotationSubgroups.flatMap((entry) => entry.tokenIds));
      if (orderedSelectedTokens.some((entry: Token) => subgroupedTokenIds.has(entry.id))) {
      setMessage("Ungroup the selected annotation subgroup before creating another one on the same row.");
      return;
    }
      const subgroup = {
        id: createId("subgroup"),
        lane: 1,
        tokenIds: orderedSelectedTokens.map((entry: Token) => entry.id)
      };
      applyVerseUpdate(updateGroup(verse, parentGroup.id, {
        annotationSubgroups: [...parentGroup.annotationSubgroups, subgroup]
      }));
      setSelection({ type: "annotation-subgroup", id: subgroup.id });
      setSelectedTokenIds([]);
      setMessage(`Grouped ${orderedSelectedTokens.length} annotation lane slots on row 2.`);
      return;
    }
    const groupedTokenIds = new Set(verse.tokenGroups.flatMap((entry: TokenGroup) => entry.tokenIds));
    if (orderedSelectedTokens.some((entry: Token) => groupedTokenIds.has(entry.id))) {
      setMessage("Ungroup the selected tokens before creating a new group.");
      return;
    }
    const group: TokenGroup = {
      id: createId("group"),
      verseId: verse.verseId,
      tokenIds: orderedSelectedTokens.map((entry: Token) => entry.id),
      annotationLaneModes: ["split", "grouped"],
      annotationSubgroups: [],
      annotations: []
    };
    applyVerseUpdate({ ...verse, tokenGroups: [...verse.tokenGroups, group] });
    setSelection({ type: "group", id: group.id });
    setSelectedTokenIds([]);
    setMessage(`Grouped ${orderedSelectedTokens.length} tokens.`);
  }

  function handleUngroup() {
    if (!verse) {
      return;
    }
    const selectedSubgroup = selectedAnnotationSubgroup()
      ?? (annotationRecord?.ownerType === "subgroup"
        ? (() => {
            for (const groupEntry of verse.tokenGroups) {
              const subgroup = groupEntry.annotationSubgroups.find((entry) => entry.id === annotationRecord.ownerId);
              if (subgroup) {
                return { group: groupEntry, subgroup };
              }
            }
            return null;
          })()
        : null)
      ?? (annotationSlot?.ownerType === "subgroup"
        ? (() => {
            for (const groupEntry of verse.tokenGroups) {
              const subgroup = groupEntry.annotationSubgroups.find((entry) => entry.id === annotationSlot.ownerId);
              if (subgroup) {
                return { group: groupEntry, subgroup };
              }
            }
            return null;
          })()
        : null);
    if (selectedSubgroup) {
      const sharedAnnotation = selectedSubgroup.group.annotations.find((entry: GroupAnnotation) => entry.subgroupId === selectedSubgroup.subgroup.id) ?? null;
      let nextVerse: Verse = updateGroup(verse, selectedSubgroup.group.id, {
        annotationSubgroups: selectedSubgroup.group.annotationSubgroups.filter((entry) => entry.id !== selectedSubgroup.subgroup.id),
        annotations: selectedSubgroup.group.annotations.filter((entry) => entry.subgroupId !== selectedSubgroup.subgroup.id)
      });
      if (sharedAnnotation) {
        const movedAnnotation: TokenAnnotation = {
          id: sharedAnnotation.id,
          tokenId: selectedSubgroup.subgroup.tokenIds[0],
          type: sharedAnnotation.type,
          value: sharedAnnotation.value,
          content: sharedAnnotation.content,
          label: sharedAnnotation.label,
          placement: "above",
          styleKey: undefined,
          orderIndex: selectedSubgroup.subgroup.lane
        };
        nextVerse = {
          ...nextVerse,
          tokenAnnotations: [...nextVerse.tokenAnnotations, movedAnnotation]
        };
        applyVerseUpdate(nextVerse);
        setSelection({ type: "annotation", id: movedAnnotation.id });
        setSelectedTokenIds([]);
      } else {
        applyVerseUpdate(nextVerse);
        setSelection({ type: "annotation-slot", ownerType: "token", ownerId: selectedSubgroup.subgroup.tokenIds[0], lane: selectedSubgroup.subgroup.lane });
        setSelectedTokenIds([]);
      }
      setMessage("Ungrouped the annotation lane subgroup.");
      return;
    }
    const targetGroup = group;
    if (!targetGroup) {
      return;
    }
    const nextVerse = moveGroupAnnotationsToToken(verse, targetGroup, targetGroup.tokenIds[0]);
    applyVerseUpdate(nextVerse);
    setSelection({ type: "token", id: targetGroup.tokenIds[0] });
    setSelectedTokenIds([targetGroup.tokenIds[0]]);
    setMessage("Ungrouped the selected tokens and preserved the shared annotation on the first token.");
  }

  function handleMoveTokenLeft() {
    if (!verse || !token) return;
    const tokenIndex = verse.tokens.findIndex((entry: Token) => entry.id === token.id);
    if (tokenIndex <= 0) return;
    const nextTokens = [...verse.tokens];
    [nextTokens[tokenIndex - 1], nextTokens[tokenIndex]] = [nextTokens[tokenIndex], nextTokens[tokenIndex - 1]];
    applyVerseUpdate({ ...verse, tokens: normalizeTokenOrders(nextTokens) });
  }

  function handleMoveTokenRight() {
    if (!verse || !token) return;
    const tokenIndex = verse.tokens.findIndex((entry: Token) => entry.id === token.id);
    if (tokenIndex === -1 || tokenIndex >= verse.tokens.length - 1) return;
    const nextTokens = [...verse.tokens];
    [nextTokens[tokenIndex + 1], nextTokens[tokenIndex]] = [nextTokens[tokenIndex], nextTokens[tokenIndex + 1]];
    applyVerseUpdate({ ...verse, tokens: normalizeTokenOrders(nextTokens) });
  }

  function handleAutoPosTag() {
    if (!verse) return;
    const nextVerse: Verse = {
      ...verse,
      tokens: verse.tokens.map((token: Token) => ({
        ...token,
        partOfSpeech: inferPartOfSpeech(token)
      }))
    };
    applyVerseUpdate(nextVerse);
    setMessage(`Auto-tagged ${verse.tokens.length} token${verse.tokens.length === 1 ? "" : "s"} for part of speech.`);
  }

  function handleAutoWordColorTag() {
    if (!verse) return;
    const nextVerse: Verse = {
      ...verse,
      tokens: verse.tokens.map((token: Token, index: number, tokens: Token[]) => ({
        ...token,
        wordColorCategory: inferWordColorCategory(token, tokens, index)
      }))
    };
    applyVerseUpdate(nextVerse);
    setMessage(`Auto-colored ${verse.tokens.length} token${verse.tokens.length === 1 ? "" : "s"} using the PDF color legend.`);
  }

  function handleCreateMarginAnnotation() {
    if (!verse || !group) {
      return;
    }
    if (group.annotations.some((entry) => isMarginNoteAnnotation(entry))) {
      setMessage("That group already has a margin note.");
      return;
    }
    const groupTokens = group.tokenIds
      .map((tokenId) => verse.tokens.find((entry: Token) => entry.id === tokenId))
      .filter((entry): entry is Token => Boolean(entry));
      const marginAnnotation: GroupAnnotation = {
        id: createId("ann"),
        groupId: group.id,
        type: "meaning",
        value: "",
        content: [],
        label: "margin note",
        wordColorCategory: getDominantWordColor(groupTokens),
        styleKey: "margin-note",
        orderIndex: 0
      };
    applyVerseUpdate(updateGroup(verse, group.id, { annotations: [...group.annotations, marginAnnotation] }));
    setSelection({ type: "annotation", id: marginAnnotation.id });
    setSelectedTokenIds([]);
    setMessage(`Added a margin note for ${groupTokens.length} grouped tokens.`);
  }

  function handleMoveAnnotationLane(direction: "up" | "down") {
    if (!verse || !annotationRecord) {
      return;
    }

    if (direction === "down" && annotationRecord.ownerType === "token") {
      const targetGroup = tokenGroupForToken.get(annotationRecord.ownerId);
      if (!targetGroup) {
        return;
      }
      const annotationToMove = annotationRecord.annotation as TokenAnnotation;
      const targetLane = annotationToMove.orderIndex ?? 0;
      if (getGroupLaneMode(targetGroup, targetLane) !== "grouped") {
        setMessage(`Annotation row ${targetLane + 1} is split for this group.`);
        return;
      }
      const existingInlineGroupAnnotations = targetGroup.annotations.filter((entry) => !isMarginNoteAnnotation(entry) && !entry.subgroupId && (entry.orderIndex ?? 1) === targetLane);
      if (existingInlineGroupAnnotations.length >= 1) {
        setMessage(`That group already has a shared annotation on row ${targetLane + 1}.`);
        return;
      }
      const movedAnnotation: GroupAnnotation = {
        id: annotationToMove.id,
        groupId: targetGroup.id,
        type: annotationToMove.type,
        value: annotationToMove.value,
        content: annotationToMove.content,
        label: annotationToMove.label,
        wordColorCategory: "",
        styleKey: undefined,
        orderIndex: targetLane
      };
      applyVerseUpdate({
        ...verse,
        tokenAnnotations: verse.tokenAnnotations.filter((entry: TokenAnnotation) => entry.id !== annotationToMove.id),
        tokenGroups: verse.tokenGroups.map((entry: TokenGroup) => (
          entry.id === targetGroup.id
            ? { ...entry, annotations: [...entry.annotations, movedAnnotation] }
            : entry
        )),
        editorLayout: {
          ...verse.editorLayout,
          annotationPlacements: Object.fromEntries(
            Object.entries(verse.editorLayout.annotationPlacements).filter(([key]) => key !== annotationToMove.id)
          )
        }
      });
      setSelection({ type: "annotation", id: movedAnnotation.id });
      setSelectedTokenIds([]);
      setMessage(`Moved the selected annotation to shared row ${targetLane + 1}.`);
      return;
    }

    if (direction === "up" && annotationRecord.ownerType === "group") {
      const annotationToMove = annotationRecord.annotation as GroupAnnotation;
      splitGroupAnnotationToTokenLane(annotationToMove);
    }
  }

  function splitGroupAnnotationToTokenLane(annotationToMove: GroupAnnotation) {
    if (!verse) {
      return;
    }
    if (isMarginNoteAnnotation(annotationToMove)) {
      setMessage("Margin notes stay in the margin and cannot move into the token lanes.");
      return;
    }
    const targetGroup = verse.tokenGroups.find((entry: TokenGroup) => entry.id === annotationToMove.groupId);
    if (!targetGroup || targetGroup.tokenIds.length === 0) {
      return;
    }
    const targetToken = targetGroup.tokenIds
      .map((tokenId) => ({
        tokenId,
        nextLane: [0, 1]
          .filter((lane) => getGroupLaneMode(targetGroup, lane) === "split")
          .find((lane) => !verse.tokenAnnotations
            .filter((entry: TokenAnnotation) => entry.tokenId === tokenId)
            .some((entry: TokenAnnotation) => (entry.orderIndex ?? 0) === lane)) ?? null
      }))
      .find((entry) => entry.nextLane !== null);
    if (!targetToken || targetToken.nextLane === null) {
      setMessage("Each grouped token already has both token annotation rows in use.");
      return;
    }
    const movedAnnotation: TokenAnnotation = {
      id: annotationToMove.id,
      tokenId: targetToken.tokenId,
      type: annotationToMove.type,
      value: annotationToMove.value,
      content: annotationToMove.content,
      label: annotationToMove.label,
      placement: "above",
      styleKey: undefined,
      orderIndex: targetToken.nextLane
    };
    applyVerseUpdate({
      ...verse,
      tokenAnnotations: [...verse.tokenAnnotations, movedAnnotation],
      tokenGroups: verse.tokenGroups.map((entry: TokenGroup) => ({
        ...entry,
        annotations: entry.annotations.filter((annotation: GroupAnnotation) => annotation.id !== annotationToMove.id)
      }))
    });
    setSelection({ type: "annotation", id: movedAnnotation.id });
    setSelectedTokenIds([]);
    setMessage("Split the shared group annotation into the first open token annotation slot.");
  }

  function splitGroupAnnotationLane(targetGroup: TokenGroup, lane: number) {
    if (!verse) {
      return;
    }
    if (getGroupLaneMode(targetGroup, lane) === "split") {
      setMessage("That annotation row is already split.");
      return;
    }

    const sharedAnnotation = targetGroup.annotations.find((entry: GroupAnnotation) => !isMarginNoteAnnotation(entry) && !entry.subgroupId && (entry.orderIndex ?? 1) === lane) ?? null;
    let nextVerse: Verse = {
      ...verse,
      tokenGroups: verse.tokenGroups.map((entry: TokenGroup) => (
            entry.id === targetGroup.id
          ? {
              ...setGroupLaneMode(entry, lane, "split"),
              annotations: sharedAnnotation
                ? entry.annotations.filter((annotation: GroupAnnotation) => annotation.id !== sharedAnnotation.id)
                : entry.annotations
            }
          : entry
      ))
    };

    if (sharedAnnotation) {
      const targetTokenId = targetGroup.tokenIds[0];
      const movedAnnotation: TokenAnnotation = {
        id: sharedAnnotation.id,
        tokenId: targetTokenId,
        type: sharedAnnotation.type,
        value: sharedAnnotation.value,
        content: sharedAnnotation.content,
        label: sharedAnnotation.label,
        placement: "above",
        styleKey: undefined,
        orderIndex: lane
      };
      nextVerse = {
        ...nextVerse,
        tokenAnnotations: [...nextVerse.tokenAnnotations, movedAnnotation]
      };
      applyVerseUpdate(nextVerse);
      setSelection({ type: "annotation", id: movedAnnotation.id });
      setSelectedTokenIds([]);
      setMessage(`Split shared annotation row ${lane + 1} into per-token slots.`);
      return;
    }

    applyVerseUpdate(nextVerse);
    setSelection({ type: "annotation-slot", ownerType: "token", ownerId: targetGroup.tokenIds[0], lane });
    setSelectedTokenIds([]);
    setMessage(`Split shared annotation row ${lane + 1} into per-token slots.`);
  }

  function splitAnnotationSubgroup(targetGroup: TokenGroup, subgroupId: string) {
    if (!verse) {
      return;
    }
      const subgroup = targetGroup.annotationSubgroups.find((entry) => entry.id === subgroupId);
    if (!subgroup) {
      return;
    }
    const sharedAnnotation = targetGroup.annotations.find((entry: GroupAnnotation) => entry.subgroupId === subgroup.id) ?? null;
    let nextVerse = updateGroup(verse, targetGroup.id, {
      annotationSubgroups: targetGroup.annotationSubgroups.filter((entry) => entry.id !== subgroup.id),
      annotations: targetGroup.annotations.filter((entry) => entry.subgroupId !== subgroup.id)
    });
    if (sharedAnnotation) {
      const movedAnnotation: TokenAnnotation = {
        id: sharedAnnotation.id,
        tokenId: subgroup.tokenIds[0],
        type: sharedAnnotation.type,
        value: sharedAnnotation.value,
        content: sharedAnnotation.content,
        label: sharedAnnotation.label,
        placement: "above",
        styleKey: undefined,
        orderIndex: subgroup.lane
      };
      nextVerse = {
        ...nextVerse,
        tokenAnnotations: [...nextVerse.tokenAnnotations, movedAnnotation]
      };
      applyVerseUpdate(nextVerse);
      setSelection({ type: "annotation", id: movedAnnotation.id });
      setSelectedTokenIds([]);
    } else {
      applyVerseUpdate(nextVerse);
      setSelection({ type: "annotation-slot", ownerType: "token", ownerId: subgroup.tokenIds[0], lane: subgroup.lane });
      setSelectedTokenIds([]);
    }
    setMessage(`Split the grouped annotation lane on row ${subgroup.lane + 1} back into individual token slots.`);
  }

  function handleSplitLane() {
    const subgroupLaneToSplit = (() => {
      if (selection.type === "annotation-subgroup") {
        return selectedAnnotationSubgroup();
      }
      if (selection.type === "annotation-slot" && selection.ownerType === "subgroup") {
        for (const groupEntry of verse?.tokenGroups ?? []) {
          const subgroup = groupEntry.annotationSubgroups.find((entry) => entry.id === selection.ownerId);
          if (subgroup) {
            return { group: groupEntry, subgroup };
          }
        }
      }
      if (annotationRecord?.ownerType === "subgroup") {
        for (const groupEntry of verse?.tokenGroups ?? []) {
          const subgroup = groupEntry.annotationSubgroups.find((entry) => entry.id === annotationRecord.ownerId);
          if (subgroup) {
            return { group: groupEntry, subgroup };
          }
        }
      }
      return null;
    })();
    if (subgroupLaneToSplit) {
      splitAnnotationSubgroup(subgroupLaneToSplit.group, subgroupLaneToSplit.subgroup.id);
      return;
    }

    const groupLaneToSplit = (() => {
      if (annotationRecord?.ownerType === "group" && !isMarginNoteAnnotation(annotationRecord.annotation)) {
        const targetGroup = verse?.tokenGroups.find((entry: TokenGroup) => entry.id === annotationRecord.ownerId) ?? null;
        return targetGroup ? { group: targetGroup, lane: annotationRecord.annotation.orderIndex ?? 1 } : null;
      }
      if (selection.type === "annotation-slot" && selection.ownerType === "group") {
        const targetGroup = verse?.tokenGroups.find((entry: TokenGroup) => entry.id === selection.ownerId) ?? null;
        return targetGroup ? { group: targetGroup, lane: selection.lane } : null;
      }
      return null;
    })();

    if (groupLaneToSplit && getGroupLaneMode(groupLaneToSplit.group, groupLaneToSplit.lane) === "grouped") {
      splitGroupAnnotationLane(groupLaneToSplit.group, groupLaneToSplit.lane);
      return;
    }
  }

  function handleRetokenize() {
    if (!verse) return;
    const confirmed = window.confirm(
      "Retokenizing will rebuild the token list from the source text and may invalidate token-specific edits such as annotations, links, colors, and POS tags. Continue?"
    );
    if (!confirmed) {
      return;
    }

    const tokenized = tokenizeSourceText(verse.verseId, verse.sourceText);
    applyVerseUpdate({
      ...verse,
      tokens: tokenized,
      tokenAnnotations: [],
      tokenGroups: [],
      tokenLinks: [],
      editorLayout: {
        ...verse.editorLayout,
        annotationPlacements: {}
      }
    });
    setSelection({ type: "verse" });
    setSelectedTokenIds([]);
    setMessage("Retokenized the verse from source text.");
  }

  function handleDeleteSelection() {
    if (!verse || (selection.type === "verse" && selectedTokenIds.length === 0)) {
      return;
    }

    if (selection.type === "token" && selectedTokenIds.length > 0) {
      const selectedTokenIdSet = new Set(selectedTokenIds);
      const removedAnnotationIds = new Set(
        verse.tokenAnnotations
          .filter((entry: TokenAnnotation) => selectedTokenIdSet.has(entry.tokenId))
          .map((entry: TokenAnnotation) => entry.id)
      );
      const nextTokens = verse.tokens.filter((entry: Token) => !selectedTokenIdSet.has(entry.id));
      applyVerseUpdate(cleanupGroups({
        ...verse,
        tokens: normalizeTokenOrders(nextTokens),
        tokenAnnotations: verse.tokenAnnotations.filter((entry: TokenAnnotation) => !selectedTokenIdSet.has(entry.tokenId)),
        tokenGroups: verse.tokenGroups.map((entry: TokenGroup) => ({
          ...entry,
          tokenIds: entry.tokenIds.filter((tokenId) => !selectedTokenIdSet.has(tokenId))
        })),
        tokenLinks: verse.tokenLinks.filter((entry: TokenLink) => !selectedTokenIdSet.has(entry.sourceTokenId) && !selectedTokenIdSet.has(entry.targetTokenId)),
        editorLayout: {
          ...verse.editorLayout,
          annotationPlacements: Object.fromEntries(
            Object.entries(verse.editorLayout.annotationPlacements).filter(([key]) => !removedAnnotationIds.has(key))
          )
        }
      }));
      setSelection({ type: "verse" });
      setSelectedTokenIds([]);
      setMessage(selectedTokenIds.length === 1 ? "Token deleted." : `${selectedTokenIds.length} tokens deleted.`);
      return;
    }

    if (selection.type === "annotation") {
      const tokenAnnotation = verse.tokenAnnotations.find((entry: TokenAnnotation) => entry.id === selection.id);
      if (tokenAnnotation) {
        applyVerseUpdate({
          ...verse,
          tokenAnnotations: verse.tokenAnnotations.filter((entry: TokenAnnotation) => entry.id !== selection.id),
          editorLayout: {
            ...verse.editorLayout,
            annotationPlacements: Object.fromEntries(
              Object.entries(verse.editorLayout.annotationPlacements).filter(([key]) => key !== selection.id)
            )
          }
        });
        setSelection({ type: "token", id: tokenAnnotation.tokenId });
        setSelectedTokenIds([tokenAnnotation.tokenId]);
      } else {
        const targetGroup = verse.tokenGroups.find((entry: TokenGroup) => entry.annotations.some((annotation) => annotation.id === selection.id));
        applyVerseUpdate({
          ...verse,
          tokenGroups: verse.tokenGroups.map((entry: TokenGroup) => ({
            ...entry,
            annotations: entry.annotations.filter((annotation: GroupAnnotation) => annotation.id !== selection.id)
          }))
        });
        setSelection(targetGroup ? { type: "group", id: targetGroup.id } : { type: "verse" });
        setSelectedTokenIds([]);
      }
      setMessage("Annotation deleted.");
      return;
    }

    if (selection.type === "group") {
      handleUngroup();
      return;
    }

    if (selection.type === "link") {
      applyVerseUpdate({
        ...verse,
        tokenLinks: verse.tokenLinks.filter((entry: TokenLink) => entry.id !== selection.id)
      });
      setSelection({ type: "verse" });
      setSelectedTokenIds([]);
      setMessage("Link deleted.");
      return;
    }

    if (selection.type === "note") {
      applyVerseUpdate({
        ...verse,
        verseAnnotations: verse.verseAnnotations.filter((entry: VerseAnnotation) => entry.id !== selection.id)
      });
      setSelection({ type: "verse" });
      setSelectedTokenIds([]);
      setMessage("Note deleted.");
      return;
    }

    if (selection.type === "media") {
      applyVerseUpdate({
        ...verse,
        verseMedia: verse.verseMedia
          .filter((entry: VerseMedia) => entry.id !== selection.id)
          .map((entry: VerseMedia, index: number) => ({ ...entry, orderIndex: index })),
        editorLayout: {
          ...verse.editorLayout,
          mediaOrder: verse.editorLayout.mediaOrder.filter((mediaId) => mediaId !== selection.id)
        }
      });
      setSelection({ type: "verse" });
      setSelectedTokenIds([]);
      setMessage("Media deleted.");
    }
  }

  async function handleReuseAnnotations(sourceVerseId: string, token: Token) {
    if (!verse) return;
    const data = await getVerseContextData(sourceVerseId);
    const sourceToken = data.verse.tokens.find(
      (entry: Token) =>
        entry.normalizedText === token.normalizedText ||
        entry.surfaceText.toLowerCase() === token.surfaceText.toLowerCase()
    );

    if (!sourceToken) {
      setMessage("No matching token found in that nearby verse.");
      return;
    }

    const sourceAnnotations = data.verse.tokenAnnotations.filter((entry: TokenAnnotation) => entry.tokenId === sourceToken.id);
    if (sourceAnnotations.length === 0) {
      setMessage("That nearby token has no annotations to reuse.");
      return;
    }

    const existingSignature = new Set(
      verse.tokenAnnotations
        .filter((entry: TokenAnnotation) => entry.tokenId === token.id)
        .map((entry: TokenAnnotation) => `${entry.type}:${entry.value}:${entry.label ?? ""}`)
    );

    const additions = sourceAnnotations
      .filter((entry: TokenAnnotation) => !existingSignature.has(`${entry.type}:${entry.value}:${entry.label ?? ""}`))
      .map((entry: TokenAnnotation, index: number) => ({
        ...entry,
        id: createId("ann"),
        tokenId: token.id,
        orderIndex: verse.tokenAnnotations.filter((candidate: TokenAnnotation) => candidate.tokenId === token.id).length + index
      }));

    if (additions.length === 0) {
      setMessage("Matching annotations are already present on this token.");
      return;
    }

    let nextVerse = {
      ...verse,
      tokenAnnotations: [...verse.tokenAnnotations, ...additions]
    };

    additions.forEach((entry: TokenAnnotation, index: number) => {
      const sourceLayout = data.verse.editorLayout.annotationPlacements[sourceAnnotations[index]?.id ?? ""];
      if (sourceLayout) {
        nextVerse = updateAnnotationLayout(nextVerse, entry.id, sourceLayout);
      }
    });

    applyVerseUpdate(nextVerse);
    setMessage(`Reused ${additions.length} annotation${additions.length === 1 ? "" : "s"} from verse ${data.verse.reference.verse}.`);
  }

  function selectedToken() {
    return selection.type === "token" && selectedTokenIds.length === 1 ? verse?.tokens.find((token: Token) => token.id === selection.id) ?? null : null;
  }

  function selectedGroup() {
    if (!verse) {
      return null;
    }
    return selection.type === "group"
      ? verse.tokenGroups.find((group: TokenGroup) => group.id === selection.id) ?? null
      : null;
  }

  function selectedAnnotationSubgroup() {
    if (!verse || selection.type !== "annotation-subgroup") {
      return null;
    }
    for (const group of verse.tokenGroups) {
      const subgroup = group.annotationSubgroups.find((entry) => entry.id === selection.id);
      if (subgroup) {
        return { group, subgroup };
      }
    }
    return null;
  }

  function selectedAnnotationSlot() {
    return selection.type === "annotation-slot" ? selection : null;
  }

  function selectedAnnotation() {
    if (!verse || selection.type !== "annotation") {
      return null;
    }
    const tokenAnnotation = verse.tokenAnnotations.find((annotation: TokenAnnotation) => annotation.id === selection.id);
    if (tokenAnnotation) {
      return {
        annotation: tokenAnnotation,
        ownerType: "token" as const,
        ownerId: tokenAnnotation.tokenId
      };
    }
    for (const group of verse.tokenGroups) {
      const groupAnnotation = group.annotations.find((annotation: GroupAnnotation) => annotation.id === selection.id);
      if (groupAnnotation) {
        return {
          annotation: groupAnnotation,
          ownerType: groupAnnotation.subgroupId ? "subgroup" as const : "group" as const,
          ownerId: groupAnnotation.subgroupId ?? group.id
        };
      }
    }
    return null;
  }

  function getAnnotationSelectionContext(targetAnnotationId: string): { lane: number; ownerKey: string } | null {
    const tokenAnnotation = verse?.tokenAnnotations.find((entry: TokenAnnotation) => entry.id === targetAnnotationId);
    if (tokenAnnotation) {
      const parentGroup = tokenGroupForToken.get(tokenAnnotation.tokenId);
      return {
        lane: tokenAnnotation.orderIndex ?? 0,
        ownerKey: parentGroup ? `group:${parentGroup.id}` : `token:${tokenAnnotation.tokenId}`
      };
    }
    for (const groupEntry of verse?.tokenGroups ?? []) {
      const groupAnnotation = groupEntry.annotations.find((entry: GroupAnnotation) => entry.id === targetAnnotationId);
      if (!groupAnnotation) {
        continue;
      }
      if (groupAnnotation.subgroupId) {
        const subgroup = groupEntry.annotationSubgroups.find((entry) => entry.id === groupAnnotation.subgroupId);
        return subgroup ? { lane: subgroup.lane, ownerKey: `group:${groupEntry.id}` } : null;
      }
      if (isMarginNoteAnnotation(groupAnnotation)) {
        return { lane: -1, ownerKey: `margin:${groupEntry.id}` };
      }
      return { lane: 1, ownerKey: `group:${groupEntry.id}` };
    }
    return null;
  }

  function getAnnotationSlotSelectionContext(ownerType: "token" | "group" | "subgroup", ownerId: string, lane: number): { lane: number; ownerKey: string } | null {
    if (ownerType === "token") {
      const parentGroup = tokenGroupForToken.get(ownerId);
      return {
        lane,
        ownerKey: parentGroup ? `group:${parentGroup.id}` : `token:${ownerId}`
      };
    }
    if (ownerType === "subgroup") {
      for (const groupEntry of verse?.tokenGroups ?? []) {
        if (groupEntry.annotationSubgroups.some((entry) => entry.id === ownerId)) {
          return { lane, ownerKey: `group:${groupEntry.id}` };
        }
      }
      return { lane, ownerKey: `subgroup:${ownerId}` };
    }
    return { lane, ownerKey: `group:${ownerId}` };
  }

  function getDisplayLaneLabel(ownerType: "token" | "group" | "subgroup", lane: number) {
    return `lane ${lane + 1}`;
  }

  function selectedLink() {
    return selection.type === "link" ? verse?.tokenLinks.find((link: TokenLink) => link.id === selection.id) ?? null : null;
  }

  function selectedNote() {
    return selection.type === "note" ? verse?.verseAnnotations.find((note: VerseAnnotation) => note.id === selection.id) ?? null : null;
  }

  function selectedMedia() {
    return selection.type === "media" ? verse?.verseMedia.find((media: VerseMedia) => media.id === selection.id) ?? null : null;
  }

  function handleTokenChipClick(tokenId: string, _additive: boolean) {
    setSelectedAnnotationIds([]);
    setSelectedAnnotationSlotKeys([]);
    if (selection.type !== "token") {
      setSelection({ type: "token", id: tokenId });
      setSelectedTokenIds([tokenId]);
      return;
    }

    setSelectedTokenIds((current) => {
      const next = current.includes(tokenId)
        ? current.filter((entry) => entry !== tokenId)
        : [...current, tokenId];

      if (next.length === 0) {
        setSelection({ type: "verse" });
      } else {
        setSelection({ type: "token", id: tokenId });
      }

      return next;
    });
  }

  function handleAnnotationClick(annotationId: string) {
    setSelectedTokenIds([]);
    setSelectedAnnotationSlotKeys([]);
    const clickedContext = getAnnotationSelectionContext(annotationId);
    const currentAnnotationIds = selectedAnnotationIdsRef.current;
    const currentContexts = currentAnnotationIds
      .map((entry) => getAnnotationSelectionContext(entry))
      .filter((entry): entry is { lane: number; ownerKey: string } => Boolean(entry));
    const canExtendCurrentSelection = Boolean(
      clickedContext
      && currentAnnotationIds.length > 0
      && currentContexts.length === currentAnnotationIds.length
      && currentContexts.every((entry) => entry.lane === clickedContext.lane && entry.ownerKey === clickedContext.ownerKey)
    );
    const baseSelection = canExtendCurrentSelection ? currentAnnotationIds : [];
    const next = baseSelection.includes(annotationId)
      ? baseSelection.filter((entry) => entry !== annotationId)
      : [...baseSelection, annotationId];

    selectedAnnotationIdsRef.current = next;
    selectionRef.current = next.length === 0 ? { type: "verse" } : { type: "annotation", id: annotationId };
    setSelectedAnnotationIds(next);
    setSelection(selectionRef.current);
  }

  function selectAnnotationSlot(ownerType: "token" | "group" | "subgroup", ownerId: string, lane: number) {
    const key = annotationSlotKey(ownerType, ownerId, lane);
    setSelectedTokenIds([]);
    setSelectedAnnotationIds([]);
    const clickedContext = getAnnotationSlotSelectionContext(ownerType, ownerId, lane);
    const currentKeys = selectedAnnotationSlotKeysRef.current;
    const currentContexts = currentKeys
      .map((entry) => {
        const [entryOwnerType, entryOwnerId, entryLaneValue] = entry.split(":");
        if (entryOwnerType !== "token" && entryOwnerType !== "group" && entryOwnerType !== "subgroup") {
          return null;
        }
        return getAnnotationSlotSelectionContext(entryOwnerType, entryOwnerId, Number(entryLaneValue));
      })
      .filter((entry): entry is { lane: number; ownerKey: string } => Boolean(entry));
    const canExtendCurrentSelection = Boolean(
      clickedContext
      && currentKeys.length > 0
      && currentContexts.length === currentKeys.length
      && currentContexts.every((entry) => entry.lane === clickedContext.lane && entry.ownerKey === clickedContext.ownerKey)
    );
    const baseSelection = canExtendCurrentSelection ? currentKeys : [];
    const next = baseSelection.includes(key)
      ? baseSelection.filter((entry) => entry !== key)
      : [...baseSelection, key];

    selectedAnnotationSlotKeysRef.current = next;
    selectionRef.current = next.length === 0 ? { type: "verse" } : { type: "annotation-slot", ownerType, ownerId, lane };
    setSelectedAnnotationSlotKeys(next);
    setSelection(selectionRef.current);
  }

  function updateTokensById(tokenIds: string[], patch: Partial<Token>) {
    return {
      ...verse!,
      tokens: verse!.tokens.map((entry: Token) => (tokenIds.includes(entry.id) ? { ...entry, ...patch } : entry))
    };
  }

  function focusIssue(issue: ValidationIssue) {
    if (!verse) {
      return;
    }

    if (issue.path.startsWith("tokens.")) {
      const match = issue.path.match(/^tokens\.(\d+)/);
      const tokenIndex = match ? Number(match[1]) : -1;
      const targetToken = tokenIndex >= 0 ? currentVerse.tokens[tokenIndex] : null;
      if (targetToken) {
        setSelection({ type: "token", id: targetToken.id });
        setSelectedTokenIds([targetToken.id]);
        setMessage(`Focused ${targetToken.surfaceText} to inspect the validation issue.`);
        return;
      }
    }

    if (issue.path.startsWith("editorLayout.annotationPlacements.")) {
      const pathParts = issue.path.split(".");
      const annotationId = pathParts[pathParts.length - 1];
      const annotationTarget = annotationId ? currentVerse.tokenAnnotations.find((entry: TokenAnnotation) => entry.id === annotationId) : null;
      if (annotationTarget) {
        setSelection({ type: "annotation", id: annotationTarget.id });
        setSelectedTokenIds([]);
      } else {
        setSelection({ type: "verse" });
        setSelectedTokenIds([]);
      }
      setMessage("Focused the annotation-related validation issue.");
      return;
    }

    const duplicateTokenId = issue.path === "tokens" ? parseIssueId(issue.message, ["Duplicate token ID:"]) : null;
    if (duplicateTokenId) {
      setSelection({ type: "token", id: duplicateTokenId });
      setSelectedTokenIds([duplicateTokenId]);
      setMessage("Focused the token involved in the validation issue.");
      return;
    }

    const missingAnnotationTokenId = issue.path === "tokenAnnotations" ? parseIssueId(issue.message, ["references missing token"]) : null;
    const duplicateAnnotationId = issue.path === "tokenAnnotations" ? parseIssueId(issue.message, ["Duplicate annotation ID:"]) : null;
    const annotationId = duplicateAnnotationId ?? null;
    const annotation = annotationId ? currentVerse.tokenAnnotations.find((entry: TokenAnnotation) => entry.id === annotationId) : null;
    if (annotation) {
      setSelection({ type: "annotation", id: annotation.id });
      setSelectedTokenIds([]);
      setMessage("Focused the annotation involved in the validation issue.");
      return;
    }
    if (missingAnnotationTokenId) {
      const tokenTarget = currentVerse.tokens.find((entry: Token) => entry.id === missingAnnotationTokenId);
      if (tokenTarget) {
        setSelection({ type: "token", id: tokenTarget.id });
        setSelectedTokenIds([tokenTarget.id]);
        setMessage("Focused the token referenced by the validation issue.");
      } else {
        setSelection({ type: "verse" });
        setSelectedTokenIds([]);
      }
      return;
    }

    if (issue.path === "tokenGroups") {
      const groupId = parseIssueId(issue.message, ["Token group"]);
      if (groupId) {
        const targetGroup = currentVerse.tokenGroups.find((entry: TokenGroup) => entry.id === groupId);
        if (targetGroup) {
          setSelection({ type: "group", id: targetGroup.id });
          setSelectedTokenIds([]);
          setMessage("Focused the token group involved in the validation issue.");
          return;
        }
      }

      const tokenId = parseIssueId(issue.message, ["Token"]);
      if (tokenId) {
        const targetToken = currentVerse.tokens.find((entry: Token) => entry.id === tokenId);
        if (targetToken) {
          setSelection({ type: "token", id: targetToken.id });
          setSelectedTokenIds([targetToken.id]);
          setMessage("Focused the token involved in the group validation issue.");
          return;
        }
      }
    }

    const duplicateLinkId = issue.path === "tokenLinks" ? parseIssueId(issue.message, ["Duplicate link ID:"]) : null;
    const linkMessageId = issue.path === "tokenLinks" ? parseIssueId(issue.message, ["Link"]) : null;
    const linkTargetId = duplicateLinkId ?? linkMessageId;
    if (linkTargetId) {
      const targetLink = currentVerse.tokenLinks.find((entry: TokenLink) => entry.id === linkTargetId);
      if (targetLink) {
        setSelection({ type: "link", id: targetLink.id });
        setSelectedTokenIds([]);
        setMessage("Focused the link involved in the validation issue.");
        return;
      }
    }

    const duplicateMediaId = issue.path === "verseMedia" ? parseIssueId(issue.message, ["Duplicate media ID:"]) : null;
    const mediaMessageId = issue.path === "verseMedia" ? parseIssueId(issue.message, ["Media"]) : null;
    const mediaTargetId = duplicateMediaId ?? mediaMessageId;
    if (mediaTargetId) {
      const targetMedia = currentVerse.verseMedia.find((entry: VerseMedia) => entry.id === mediaTargetId);
      if (targetMedia) {
        setSelection({ type: "media", id: targetMedia.id });
        setSelectedTokenIds([]);
        setMessage("Focused the media item involved in the validation issue.");
        return;
      }
    }

    if (issue.path.startsWith("editorLayout.mediaOrder")) {
      const mediaId = parseIssueId(issue.message, ["duplicate media ID", "missing media"]);
      const targetMedia = mediaId ? currentVerse.verseMedia.find((entry: VerseMedia) => entry.id === mediaId) : null;
      if (targetMedia) {
        setSelection({ type: "media", id: targetMedia.id });
        setSelectedTokenIds([]);
      } else {
        setSelection({ type: "verse" });
        setSelectedTokenIds([]);
      }
      setMessage("Focused the media ordering issue.");
      return;
    }

    setSelection({ type: "verse" });
    setSelectedTokenIds([]);
    setMessage("This validation issue applies to the verse as a whole.");
  }

  function fixIssue(issue: ValidationIssue) {
    if (!verse) {
      return;
    }

    if (issue.path.startsWith("tokens.") && issue.message === "Token order should be sequential and zero-based.") {
      applyVerseUpdate({ ...currentVerse, tokens: normalizeTokenOrders(currentVerse.tokens) });
      setMessage("Normalized token order.");
      return;
    }

    if (issue.path.startsWith("editorLayout.annotationPlacements.") && issue.message.includes("Layout data exists for missing annotation")) {
      const pathParts = issue.path.split(".");
      const annotationId = pathParts[pathParts.length - 1];
      if (!annotationId) {
        return;
      }
      applyVerseUpdate({
        ...currentVerse,
        editorLayout: {
          ...currentVerse.editorLayout,
          annotationPlacements: Object.fromEntries(
            Object.entries(currentVerse.editorLayout.annotationPlacements).filter(([key]) => key !== annotationId)
          )
        }
      });
      setMessage("Removed stale annotation layout data.");
      return;
    }

    if (issue.path === "tokenAnnotations" && issue.message.includes("references missing token")) {
      const annotationId = parseIssueId(issue.message, ["Annotation"]);
      if (!annotationId) {
        return;
      }
      applyVerseUpdate({
        ...currentVerse,
        tokenAnnotations: currentVerse.tokenAnnotations.filter((entry: TokenAnnotation) => entry.id !== annotationId),
        editorLayout: {
          ...currentVerse.editorLayout,
          annotationPlacements: Object.fromEntries(
            Object.entries(currentVerse.editorLayout.annotationPlacements).filter(([key]) => key !== annotationId)
          )
        }
      });
      setSelection({ type: "verse" });
      setSelectedTokenIds([]);
      setMessage("Deleted the orphaned annotation.");
      return;
    }

    if (issue.path === "tokenLinks" && issue.message.includes("references a missing source or target token")) {
      const linkId = parseIssueId(issue.message, ["Link"]);
      if (!linkId) {
        return;
      }
      applyVerseUpdate({
        ...currentVerse,
        tokenLinks: currentVerse.tokenLinks.filter((entry: TokenLink) => entry.id !== linkId)
      });
      setSelection({ type: "verse" });
      setSelectedTokenIds([]);
      setMessage("Deleted the broken link.");
      return;
    }

    if (issue.path.startsWith("editorLayout.mediaOrder")) {
      applyVerseUpdate({
        ...currentVerse,
        editorLayout: {
          ...currentVerse.editorLayout,
          mediaOrder: currentVerse.editorLayout.mediaOrder.filter(
            (mediaId, index, entries) =>
              entries.indexOf(mediaId) === index && currentVerse.verseMedia.some((entry: VerseMedia) => entry.id === mediaId)
          )
        }
      });
      setMessage("Cleaned up media order metadata.");
      return;
    }
  }

  function fixAllIssues() {
    if (!verse) {
      return;
    }

    const validAnnotationIds = new Set([
      ...currentVerse.tokenAnnotations.map((entry: TokenAnnotation) => entry.id),
      ...currentVerse.tokenGroups.flatMap((entry: TokenGroup) => entry.annotations.map((annotation: GroupAnnotation) => annotation.id))
    ]);
    const validTokenIds = new Set(currentVerse.tokens.map((entry: Token) => entry.id));
    const validMediaIds = new Set(currentVerse.verseMedia.map((entry: VerseMedia) => entry.id));

    applyVerseUpdate(cleanupGroups({
      ...currentVerse,
      tokens: normalizeTokenOrders(currentVerse.tokens),
      tokenAnnotations: currentVerse.tokenAnnotations.filter((entry: TokenAnnotation) => validTokenIds.has(entry.tokenId)),
      tokenGroups: currentVerse.tokenGroups.map((entry: TokenGroup) => ({
        ...entry,
        tokenIds: entry.tokenIds.filter((tokenId) => validTokenIds.has(tokenId)),
        annotations: entry.annotations
      })),
      tokenLinks: currentVerse.tokenLinks.filter(
        (entry: TokenLink) => validTokenIds.has(entry.sourceTokenId) && validTokenIds.has(entry.targetTokenId)
      ),
      editorLayout: {
        ...currentVerse.editorLayout,
        annotationPlacements: Object.fromEntries(
          Object.entries(currentVerse.editorLayout.annotationPlacements).filter(([key]) => validAnnotationIds.has(key))
        ),
        mediaOrder: currentVerse.editorLayout.mediaOrder.filter(
          (mediaId, index, entries) => entries.indexOf(mediaId) === index && validMediaIds.has(mediaId)
        )
      }
    }));
    setSelection({ type: "verse" });
    setSelectedTokenIds([]);
    setMessage("Applied the safe automatic repairs for this verse.");
  }

  if (!verse) {
    return <div className="loading-shell">{message}</div>;
  }

  const currentVerse = verse;
  const tutorialHref = `${import.meta.env.BASE_URL}tutorial.html`;
  const tokenGroupForToken = new Map<string, TokenGroup>();
  currentVerse.tokenGroups.forEach((entry: TokenGroup) => {
    entry.tokenIds.forEach((tokenId) => tokenGroupForToken.set(tokenId, entry));
  });
  const selectedTokens = currentVerse.tokens.filter((entry: Token) => selectedTokenIds.includes(entry.id));
  const activeSelectedToken = selection.type === "token"
    ? currentVerse.tokens.find((entry: Token) => entry.id === selection.id) ?? selectedTokens[0] ?? null
    : null;
  const token = selectedToken();
  const group = selectedGroup();
  const annotationSubgroupSelection = selectedAnnotationSubgroup();
  const annotationSlot = selectedAnnotationSlot();
  const annotationRecord = selectedAnnotation();
  const annotation = annotationRecord?.annotation ?? null;
  const link = selectedLink();
  const note = selectedNote();
  const media = selectedMedia();
  const selectedTokenLaneSlots = selectedAnnotationSlotKeys
    .map((key) => {
      const [ownerType, ownerId, laneValue] = key.split(":");
      return ownerType === "token" ? { ownerType, ownerId, lane: Number(laneValue) } : null;
    })
    .filter((entry): entry is { ownerType: "token"; ownerId: string; lane: number } => Boolean(entry));
  const selectedGroupedLaneSelection = (() => {
    const tokenIds = new Set<string>();
    const lanes = new Set<number>();

    selectedAnnotationSlotKeys.forEach((key) => {
      const [ownerType, ownerId, laneValue] = key.split(":");
      const lane = Number(laneValue);
      if (ownerType === "token") {
        lanes.add(lane);
        tokenIds.add(ownerId);
      }
      if (ownerType === "subgroup") {
        lanes.add(lane);
        currentVerse.tokenGroups.forEach((groupEntry: TokenGroup) => {
          const subgroup = groupEntry.annotationSubgroups.find((entry) => entry.id === ownerId);
          subgroup?.tokenIds.forEach((tokenId) => tokenIds.add(tokenId));
        });
      }
    });

    selectedAnnotationIds.forEach((annotationId) => {
      const tokenAnnotation = currentVerse.tokenAnnotations.find((entry: TokenAnnotation) => entry.id === annotationId);
      if (tokenAnnotation) {
        lanes.add(tokenAnnotation.orderIndex ?? 0);
        tokenIds.add(tokenAnnotation.tokenId);
        return;
      }
      currentVerse.tokenGroups.forEach((groupEntry: TokenGroup) => {
        const subgroupAnnotation = groupEntry.annotations.find((entry: GroupAnnotation) => entry.id === annotationId && !!entry.subgroupId);
        if (subgroupAnnotation?.subgroupId) {
          const subgroup = groupEntry.annotationSubgroups.find((entry) => entry.id === subgroupAnnotation.subgroupId);
          if (subgroup) {
            lanes.add(subgroup.lane);
          }
          subgroup?.tokenIds.forEach((tokenId) => tokenIds.add(tokenId));
        }
      });
    });

    if (selection.type === "annotation-subgroup") {
      const subgroupSelection = selectedAnnotationSubgroup();
      if (subgroupSelection) {
        lanes.add(subgroupSelection.subgroup.lane);
      }
      subgroupSelection?.subgroup.tokenIds.forEach((tokenId) => tokenIds.add(tokenId));
    }

    if (lanes.size !== 1) {
      return null;
    }

    return {
      lane: [...lanes][0],
      tokenIds: [...tokenIds]
    };
  })();
  const hasGroupedSelection = selectedTokens.some((entry) => tokenGroupForToken.has(entry.id));
  const canCreateGroup = (() => {
    if (selectedGroupedLaneSelection && selectedGroupedLaneSelection.tokenIds.length > 1) {
      const selectedSlotTokens = currentVerse.tokens.filter((entry: Token) => selectedGroupedLaneSelection.tokenIds.includes(entry.id));
      const parentGroups = selectedSlotTokens
        .map((entry: Token) => tokenGroupForToken.get(entry.id) ?? null)
        .filter((entry): entry is TokenGroup => Boolean(entry));
      if (parentGroups.length !== selectedSlotTokens.length || !parentGroups.every((entry) => entry.id === parentGroups[0].id)) {
        return false;
      }
      const parentGroup = parentGroups[0];
      if (getGroupLaneMode(parentGroup, selectedGroupedLaneSelection.lane) !== "split") {
        return false;
      }
      const orderedIndexes = selectedSlotTokens.map((entry: Token) => currentVerse.tokens.findIndex((tokenItem: Token) => tokenItem.id === entry.id));
      const isContiguous = orderedIndexes.length > 1 && orderedIndexes.every((index: number, position: number) => position === 0 || index === orderedIndexes[position - 1] + 1);
      if (!isContiguous) {
        return false;
      }
      return true;
    }
    if (selectedTokenIds.length <= 1) {
      return false;
    }
    const orderedIndexes = selectedTokens.map((entry: Token) => currentVerse.tokens.findIndex((tokenItem: Token) => tokenItem.id === entry.id));
    const isContiguous = orderedIndexes.length > 1 && orderedIndexes.every((index: number, position: number) => position === 0 || index === orderedIndexes[position - 1] + 1);
    if (!isContiguous) {
      return false;
    }
    if (!hasGroupedSelection) {
      return true;
    }
    const parentGroups = selectedTokens
      .map((entry: Token) => tokenGroupForToken.get(entry.id) ?? null)
      .filter((entry): entry is TokenGroup => Boolean(entry));
    if (parentGroups.length !== selectedTokens.length || !parentGroups.every((entry) => entry.id === parentGroups[0].id)) {
      return false;
    }
    return false;
  })();
  const canUngroup = Boolean(group || annotationSubgroupSelection || annotationRecord?.ownerType === "subgroup" || (annotationSlot?.ownerType === "subgroup"));
  const canCreateMarginAnnotation = Boolean(group && !group.annotations.some((entry) => isMarginNoteAnnotation(entry)));
  const canSplitLane = Boolean(
    selection.type === "annotation-subgroup"
    || (selection.type === "annotation-slot" && selection.ownerType === "subgroup")
    || (annotationRecord && annotationRecord.ownerType === "subgroup")
    || 
    (annotationRecord && annotationRecord.ownerType === "group" && !isMarginNoteAnnotation(annotationRecord.annotation)
      && Boolean(currentVerse.tokenGroups.find((entry: TokenGroup) => entry.id === annotationRecord.ownerId)
        && getGroupLaneMode(currentVerse.tokenGroups.find((entry: TokenGroup) => entry.id === annotationRecord.ownerId)!, annotationRecord.annotation.orderIndex ?? 1) === "grouped"))
    || (selection.type === "annotation-slot" && selection.ownerType === "group"
      && Boolean(currentVerse.tokenGroups.find((entry: TokenGroup) => entry.id === selection.ownerId)
        && getGroupLaneMode(currentVerse.tokenGroups.find((entry: TokenGroup) => entry.id === selection.ownerId)!, selection.lane) === "grouped"))
  );
  const isSingleTokenContext = Boolean(token);
  const canAddAnnotation = Boolean(
    (annotationSlot?.ownerType === "group"
      && (() => {
        const targetGroup = currentVerse.tokenGroups.find((entry: TokenGroup) => entry.id === annotationSlot.ownerId);
        if (!targetGroup || getGroupLaneMode(targetGroup, annotationSlot.lane) !== "grouped") {
          return false;
        }
        return targetGroup.annotations.filter((entry) => !isMarginNoteAnnotation(entry) && !entry.subgroupId && (entry.orderIndex ?? 1) === annotationSlot.lane).length < 1;
      })())
    || (annotationSlot?.ownerType === "subgroup"
      && !currentVerse.tokenGroups.some((entry: TokenGroup) => entry.annotations.some((annotation: GroupAnnotation) => annotation.subgroupId === annotationSlot.ownerId)))
    || (annotationSlot?.ownerType === "token" && (() => {
      const parentGroup = tokenGroupForToken.get(annotationSlot.ownerId);
      if (!parentGroup) {
        return true;
      }
      const requestedLane = annotationSlot.lane;
      const tokenSubgroup = parentGroup.annotationSubgroups.find((entry) => entry.lane === requestedLane && entry.tokenIds.includes(annotationSlot.ownerId));
      if (tokenSubgroup) {
        return false;
      }
      const maxRows = [0, 1].filter((lane) => getGroupLaneMode(parentGroup, lane) === "split").length;
      const occupiedLanes = currentVerse.tokenAnnotations
        .filter((entry: TokenAnnotation) => entry.tokenId === annotationSlot.ownerId)
        .map((entry: TokenAnnotation) => entry.orderIndex ?? 0);
      return getGroupLaneMode(parentGroup, requestedLane) === "split" && occupiedLanes.length < maxRows && !occupiedLanes.includes(requestedLane);
    })())
    || (group && [0, 1].some((lane) => getGroupLaneMode(group, lane) === "grouped"
      && group.annotations.filter((entry) => !isMarginNoteAnnotation(entry) && !entry.subgroupId && (entry.orderIndex ?? 1) === lane).length < 1))
    || (token && (() => {
      const parentGroup = tokenGroupForToken.get(token.id);
      const maxRows = parentGroup ? [0, 1].filter((lane) => getGroupLaneMode(parentGroup, lane) === "split").length : 2;
      return currentVerse.tokenAnnotations.filter((entry: TokenAnnotation) => entry.tokenId === token.id).length < maxRows;
    })())
  );
  const canMoveAnnotationUp = Boolean(annotationRecord && annotationRecord.ownerType === "group" && !isMarginNoteAnnotation(annotationRecord.annotation));
  const canMoveAnnotationDown = Boolean(annotationRecord && annotationRecord.ownerType === "token" && tokenGroupForToken.has(annotationRecord.ownerId));
  const canMoveTokenLeft = Boolean(token && !tokenGroupForToken.has(token.id) && currentVerse.tokens.findIndex((entry: Token) => entry.id === token.id) > 0);
  const canMoveTokenRight = Boolean(token && !tokenGroupForToken.has(token.id) && currentVerse.tokens.findIndex((entry: Token) => entry.id === token.id) < currentVerse.tokens.length - 1);
  const isVerseContext = selection.type === "verse" && selectedTokenIds.length === 0;
  const hasConcreteSelection = !isVerseContext;
  const canAddLink = isVerseContext && verse.tokens.length >= 2;
  const linkSourceToken = link ? currentVerse.tokens.find((entry: Token) => entry.id === link.sourceTokenId) ?? null : null;
  const linkTargetToken = link ? currentVerse.tokens.find((entry: Token) => entry.id === link.targetTokenId) ?? null : null;
  const canPointLinkLeft = Boolean(link && linkSourceToken && linkTargetToken && linkSourceToken.order < linkTargetToken.order);
  const canPointLinkRight = Boolean(link && linkSourceToken && linkTargetToken && linkSourceToken.order > linkTargetToken.order);
  const canRunVerseAutomation = isVerseContext;
  const canManageExports = isVerseContext;
  const bulkPartOfSpeech = selectedTokens.length > 1 && selectedTokens.every((entry: Token) => entry.partOfSpeech === selectedTokens[0].partOfSpeech)
    ? selectedTokens[0].partOfSpeech
    : "__mixed__";
  const bulkWordColor = selectedTokens.length > 1 && selectedTokens.every((entry: Token) => entry.wordColorCategory === selectedTokens[0].wordColorCategory)
    ? selectedTokens[0].wordColorCategory
    : "__mixed__";
  const bulkProperNoun = selectedTokens.length > 1 && selectedTokens.every((entry: Token) => entry.isProperNoun === selectedTokens[0].isProperNoun)
    ? String(selectedTokens[0].isProperNoun)
    : "__mixed__";
  const bulkEditorial = selectedTokens.length > 1 && selectedTokens.every((entry: Token) => entry.isEditorial === selectedTokens[0].isEditorial)
    ? String(selectedTokens[0].isEditorial)
    : "__mixed__";
  const actionableIssues: ActionableIssue[] = issues.map((issue: ValidationIssue, index: number) => {
    let canFix = false;
    let focusLabel = "Go To";
    let fixLabel: string | undefined;

    if (issue.path.startsWith("tokens.") && issue.message === "Token order should be sequential and zero-based.") {
      canFix = true;
      focusLabel = "Review Tokens";
      fixLabel = "Normalize";
    } else if (issue.path.startsWith("editorLayout.annotationPlacements.") && issue.message.includes("Layout data exists for missing annotation")) {
      canFix = true;
      focusLabel = "View Verse";
      fixLabel = "Remove Layout";
    } else if (issue.path === "tokenAnnotations" && issue.message.includes("references missing token")) {
      canFix = true;
      focusLabel = "Review Annotation";
      fixLabel = "Delete Annotation";
    } else if (issue.path === "tokenLinks" && issue.message.includes("references a missing source or target token")) {
      canFix = true;
      focusLabel = "Review Link";
      fixLabel = "Delete Link";
    } else if (issue.path.startsWith("editorLayout.mediaOrder")) {
      canFix = true;
      focusLabel = "Review Media";
      fixLabel = "Clean Order";
    } else if (issue.path === "tokens") {
      focusLabel = "Review Token";
    } else if (issue.path === "tokenAnnotations") {
      focusLabel = "Review Annotation";
    } else if (issue.path === "tokenLinks") {
      focusLabel = "Review Link";
    } else if (issue.path === "tokenGroups") {
      focusLabel = "Review Group";
    } else if (issue.path === "verseMedia" || issue.path.startsWith("editorLayout.mediaOrder")) {
      focusLabel = "Review Media";
    }

    return {
      issue,
      key: `${issue.path}-${index}`,
      canFix,
      focusLabel,
      fixLabel
    };
  });
  const canFixAnyIssues = actionableIssues.some((entry) => entry.canFix);

  const tokenVisualItems: TokenVisualItem[] = [];
  const renderedGroupIds = new Set<string>();
  currentVerse.tokens.forEach((tokenItem: Token) => {
    const tokenGroup = tokenGroupForToken.get(tokenItem.id);
    if (!tokenGroup) {
      tokenVisualItems.push({ kind: "token", token: tokenItem });
      return;
    }
    if (renderedGroupIds.has(tokenGroup.id)) {
      return;
    }
    const groupedTokens = tokenGroup.tokenIds
      .map((tokenId) => currentVerse.tokens.find((entry: Token) => entry.id === tokenId))
      .filter((entry): entry is Token => Boolean(entry));
    tokenVisualItems.push({ kind: "group", group: tokenGroup, tokens: groupedTokens });
    renderedGroupIds.add(tokenGroup.id);
  });

  const measuredTokens = currentVerse.tokens
    .map((tokenItem: Token) => ({
      token: tokenItem,
      position: tokenPositions[tokenItem.id]
    }))
    .filter((entry): entry is { token: Token; position: TokenPosition } => Boolean(entry.position));
  const tokenContentBottom = measuredTokens.reduce((max, entry) => Math.max(max, entry.position.y + entry.position.height), 0);
  const positionedLinks = (() => {
    const occupiedLanes: Array<Array<{ left: number; right: number }>> = [];
    return currentVerse.tokenLinks
      .map((linkEntry: TokenLink) => {
        const source = tokenPositions[linkEntry.sourceTokenId];
        const target = tokenPositions[linkEntry.targetTokenId];
        const sourceToken = currentVerse.tokens.find((entry: Token) => entry.id === linkEntry.sourceTokenId);
        const targetToken = currentVerse.tokens.find((entry: Token) => entry.id === linkEntry.targetTokenId);
        if (!source || !target || !sourceToken || !targetToken) {
          return null;
        }

        const x1 = source.x + source.width / 2;
        const y1 = source.y + source.height - 8;
        const x2 = target.x + target.width / 2;
        const y2 = target.y + target.height - 8;
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const rowBottom = Math.max(y1, y2);
        const linkColorCategory = linkEntry.wordColorCategory ?? "";
        const strokeColor = linkColorCategory ? (WORD_COLOR_STYLES[linkColorCategory] ?? DEFAULT_LINK_COLOR) : DEFAULT_LINK_COLOR;

        let laneIndex = 0;
        while ((occupiedLanes[laneIndex] ?? []).some((interval) => !(right < interval.left || left > interval.right))) {
          laneIndex += 1;
        }
        occupiedLanes[laneIndex] = [...(occupiedLanes[laneIndex] ?? []), { left, right }];
        const laneY = rowBottom + 20 + laneIndex * 12;

        return {
          link: linkEntry,
          path: buildLinkPath(x1, y1, x2, y2, laneY),
          laneY,
          strokeColor
        };
      })
      .filter((entry): entry is { link: TokenLink; path: string; laneY: number; strokeColor: string } => Boolean(entry));
  })();
  const linkOverlayHeight = Math.max(50, positionedLinks.reduce((max, entry) => Math.max(max, entry.laneY), tokenContentBottom) - tokenContentBottom + 24);
  const draftLinkPath = (() => {
    if (!linkDrag) {
      return null;
    }
    const source = tokenPositions[linkDrag.sourceTokenId];
    if (!source) {
      return null;
    }
    const x1 = source.x + source.width / 2;
    const y1 = source.y + source.height - 8;
    const sourceToken = currentVerse.tokens.find((entry: Token) => entry.id === linkDrag.sourceTokenId);
    const sourceCategory = sourceToken?.wordColorCategory ?? "";
    const strokeColor = sourceCategory ? (WORD_COLOR_STYLES[sourceCategory] ?? DEFAULT_LINK_COLOR) : DEFAULT_LINK_COLOR;
    const laneY = y1 + 20;
    return {
      path: buildLinkPath(x1, y1, linkDrag.currentX, linkDrag.currentY, laneY),
      strokeColor
    };
  })();

function renderAnnotationContent(annotationEntry: TokenAnnotation | GroupAnnotation) {
    return getAnnotationContent(annotationEntry).map((segment: AnnotationContentSegment) => {
      if (segment.type === "image") {
        return (
          <img
            key={segment.id}
            className="annotation-image"
            src={segment.value}
            alt={annotationEntry.label ?? "annotation image"}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
          />
        );
      }
      return (
        <span key={segment.id} className={segment.type === "emoji" ? "annotation-segment emoji" : "annotation-segment"}>
          {segment.value}
        </span>
      );
    });
}

function getGroupAnnotationColor(annotation: GroupAnnotation, groupTokens: Token[]): string {
  const colorCategory = annotation.wordColorCategory || getDominantWordColor(groupTokens);
  return WORD_COLOR_STYLES[colorCategory] ?? WORD_COLOR_STYLES[""];
}

function renderTokenAnnotationTag(entry: TokenAnnotation | GroupAnnotation, ownerType: "token" | "group") {
  const content = getAnnotationContent(entry);
  const isImageOnly = getAnnotationContent(entry).every((segment) => segment.type === "image");
  const isSelected = selectedAnnotationIds.includes(entry.id) || (selection.type === "annotation" && selection.id === entry.id);
  const isEditing = selection.type === "annotation" && selection.id === entry.id;
  const isMarginNote = ownerType === "group" && isMarginNoteAnnotation(entry);
  const applyContentPatch = (nextPatch: Partial<TokenAnnotation> | Partial<GroupAnnotation>) => {
    if (ownerType === "token") {
      applyVerseUpdate(updateAnnotation(currentVerse, entry.id, nextPatch as Partial<TokenAnnotation>));
    } else {
      applyVerseUpdate(updateGroupAnnotation(currentVerse, entry.id, nextPatch as Partial<GroupAnnotation>));
    }
  };
  const finishEditing = () => {
    setSelectedAnnotationSegmentId(null);
    setSelectedAnnotationCaret(null);
    if (ownerType === "token" && "tokenId" in entry) {
      setSelection({ type: "token", id: entry.tokenId });
      setSelectedTokenIds([entry.tokenId]);
      return;
    }
    if ("subgroupId" in entry && entry.subgroupId) {
      setSelection({ type: "annotation-subgroup", id: entry.subgroupId });
      setSelectedTokenIds([]);
      return;
    }
    if ("groupId" in entry) {
      setSelection({ type: "group", id: entry.groupId });
      setSelectedTokenIds([]);
    }
  };
  const handleDroppedImageValue = (imageValue: string, segmentId: string | null, caretOffset: number | null) => {
    const { patch, insertedSegmentId } = insertImageIntoAnnotationContent(entry, imageValue, segmentId, caretOffset);
    applyContentPatch(patch);
    requestAnnotationFocus(insertedSegmentId, null);
  };
  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finishEditing();
      return;
    }
    if (!selectedAnnotationSegmentId) {
      return;
    }
    const selectedSegment = content.find((segment) => segment.id === selectedAnnotationSegmentId);
    if (!selectedSegment || selectedSegment.type !== "image") {
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      const { patch, focusSegmentId, focusOffset } = removeAnnotationSegmentWithFocus(entry, selectedAnnotationSegmentId);
      applyContentPatch(patch);
      requestAnnotationFocus(focusSegmentId, focusOffset);
      return;
    }
  };
  return (
      <span
        key={entry.id}
        className={[
          "annotation-tag",
          ownerType === "group" ? "group-annotation-tag" : "",
          isMarginNote ? "margin-note-tag" : "",
          isImageOnly ? "image-annotation-tag" : "",
          isSelected ? "selected" : ""
        ].filter(Boolean).join(" ")}
        onClick={(event) => {
          event.stopPropagation();
          handleAnnotationClick(entry.id);
        }}
        data-owner-type={ownerType}
      >
        {isEditing ? (
          <span
            className="annotation-inline-editor"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={handleEditorKeyDown}
            onKeyUp={(event) => event.stopPropagation()}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(ANNOTATION_IMAGE_DRAG_MIME)) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              const imageValue = event.dataTransfer.getData(ANNOTATION_IMAGE_DRAG_MIME);
              if (!imageValue) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              handleDroppedImageValue(imageValue, selectedAnnotationSegmentId, selectedAnnotationCaret?.segmentId === selectedAnnotationSegmentId ? selectedAnnotationCaret.offset : null);
            }}
          >
            {content.map((segment, index) => {
              if (segment.type === "image") {
                const segmentSelected = selectedAnnotationSegmentId === segment.id;
                return (
                  <span
                    key={segment.id}
                    className={["annotation-segment-shell", "image", segmentSelected ? "selected" : ""].join(" ")}
                  >
                    <button
                      ref={(node) => {
                        annotationSegmentRefs.current[segment.id] = node;
                      }}
                      className="annotation-segment-image-button"
                      draggable
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedAnnotationSegmentId(segment.id);
                        setSelectedAnnotationCaret(null);
                      }}
                      onDragStart={(event) => {
                        event.stopPropagation();
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData(ANNOTATION_IMAGE_DRAG_MIME, segment.value);
                        setSelectedAnnotationSegmentId(segment.id);
                        setSelectedAnnotationCaret(null);
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedAnnotationSegmentId(segment.id);
                          setSelectedAnnotationCaret(null);
                          return;
                        }
                        if (event.key === "Backspace" || event.key === "Delete") {
                          event.preventDefault();
                          const { patch, focusSegmentId, focusOffset } = removeAnnotationSegmentWithFocus(entry, segment.id);
                          applyContentPatch(patch);
                          requestAnnotationFocus(focusSegmentId, focusOffset);
                          return;
                        }
                      }}
                      title="Select image segment"
                    >
                      <img
                        className="annotation-image"
                        src={segment.value}
                        alt={entry.label ?? "annotation image"}
                        draggable={false}
                        onDragStart={(event) => event.preventDefault()}
                      />
                    </button>
                  </span>
                );
              }

              return (
                <input
                  key={segment.id}
                  ref={(node) => {
                    annotationTextInputRefs.current[segment.id] = node;
                  }}
                  className="annotation-inline-input"
                  value={segment.value}
                  size={Math.max(segment.value.length, 1)}
                  placeholder={index === 0 ? "Type or paste image" : ""}
                  onChange={(event) => {
                    applyContentPatch(updateAnnotationSegmentValue(entry, segment.id, event.target.value));
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedAnnotationSegmentId(segment.id);
                    setSelectedAnnotationCaret({ segmentId: segment.id, offset: event.currentTarget.selectionStart ?? event.currentTarget.value.length });
                  }}
                  onFocus={(event) => {
                    setSelectedAnnotationSegmentId(segment.id);
                    setSelectedAnnotationCaret({ segmentId: segment.id, offset: event.currentTarget.selectionStart ?? event.currentTarget.value.length });
                  }}
                  onSelect={(event) => {
                    setSelectedAnnotationSegmentId(segment.id);
                    setSelectedAnnotationCaret({ segmentId: segment.id, offset: event.currentTarget.selectionStart ?? event.currentTarget.value.length });
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    const caret = event.currentTarget.selectionStart ?? 0;
                    const selectionEnd = event.currentTarget.selectionEnd ?? caret;
                    if (event.key === "Enter") {
                      event.preventDefault();
                      finishEditing();
                      return;
                    }
                    if (event.key === "Backspace" && caret === selectionEnd && caret === event.currentTarget.value.length && event.currentTarget.value.length === 1) {
                      event.preventDefault();
                      const { patch, focusSegmentId, focusOffset } = deleteLastCharacterFromTextSegment(entry, segment.id);
                      applyContentPatch(patch);
                      requestAnnotationFocus(focusSegmentId, focusOffset);
                      return;
                    }
                    if (event.key === "Backspace" && caret === 0) {
                      event.preventDefault();
                      const { patch, focusSegmentId, focusOffset } = mergeTextBoundaryBeforeSegment(entry, segment.id);
                      applyContentPatch(patch);
                      requestAnnotationFocus(focusSegmentId, focusOffset);
                      return;
                    }
                    if (event.key === "ArrowLeft" && caret === 0) {
                      const previousSegment = content[index - 1];
                      if (previousSegment?.type === "image") {
                        event.preventDefault();
                        requestAnnotationFocus(previousSegment.id, null);
                        return;
                      }
                    }
                    if (event.key === "ArrowRight" && caret === event.currentTarget.value.length) {
                      const nextSegment = content[index + 1];
                      if (nextSegment?.type === "image") {
                        event.preventDefault();
                        requestAnnotationFocus(nextSegment.id, null);
                        return;
                      }
                    }
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Backspace" || event.key === "Delete") {
                      setSelectedAnnotationSegmentId(null);
                    }
                  }}
                  onKeyUp={(event) => {
                    event.stopPropagation();
                    setSelectedAnnotationCaret({ segmentId: segment.id, offset: event.currentTarget.selectionStart ?? event.currentTarget.value.length });
                  }}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes(ANNOTATION_IMAGE_DRAG_MIME)) {
                      event.preventDefault();
                    }
                  }}
                  onDrop={(event) => {
                    const imageValue = event.dataTransfer.getData(ANNOTATION_IMAGE_DRAG_MIME);
                    if (!imageValue) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    handleDroppedImageValue(segment.value ? imageValue : imageValue, segment.id, event.currentTarget.selectionStart ?? event.currentTarget.value.length);
                  }}
                />
              );
            })}
            <input
              className="annotation-inline-input annotation-inline-tail-input"
              value=""
              size={1}
              placeholder={content.length === 0 ? "Type or paste image" : ""}
              onChange={(event) => {
                if (!event.target.value) {
                  return;
                }
                const newSegmentId = createId("seg");
                applyContentPatch(setAnnotationContent(entry, [
                  ...content,
                  { id: newSegmentId, type: "text", value: event.target.value }
                ]));
                requestAnnotationFocus(newSegmentId, event.target.value.length);
              }}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedAnnotationSegmentId(null);
                setSelectedAnnotationCaret(null);
              }}
              onFocus={() => {
                setSelectedAnnotationSegmentId(null);
                setSelectedAnnotationCaret(null);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  finishEditing();
                  return;
                }
                if (event.key === "Backspace" && content.length > 0) {
                  event.preventDefault();
                  const { patch, focusSegmentId, focusOffset } = deleteBackwardFromAnnotationEnd(entry);
                  applyContentPatch(patch);
                  requestAnnotationFocus(focusSegmentId, focusOffset);
                  return;
                }
                if (event.key === "ArrowLeft" && content.length > 0) {
                  const previousSegment = content[content.length - 1];
                  if (previousSegment.type === "image") {
                    event.preventDefault();
                    requestAnnotationFocus(previousSegment.id, null);
                    return;
                  }
                }
              }}
              onKeyUp={(event) => event.stopPropagation()}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(ANNOTATION_IMAGE_DRAG_MIME)) {
                  event.preventDefault();
                }
              }}
              onDrop={(event) => {
                const imageValue = event.dataTransfer.getData(ANNOTATION_IMAGE_DRAG_MIME);
                if (!imageValue) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                handleDroppedImageValue(imageValue, null, null);
              }}
            />
          </span>
        ) : (
          <span className="annotation-inline-content">
            {renderAnnotationContent(entry)}
          </span>
        )}
      </span>
    );
  }

  function getTokenAnnotations(item: Token) {
    return currentVerse.tokenAnnotations
      .filter((entry: TokenAnnotation) => entry.tokenId === item.id)
      .sort((a: TokenAnnotation, b: TokenAnnotation) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  }

  function renderTokenButton(item: Token) {
    return (
      <button
        key={item.id}
        ref={(element) => {
          tokenRefs.current[item.id] = element;
        }}
        data-token-id={item.id}
        className={[
          "token-chip",
          selectedTokenIds.includes(item.id) ? "selected" : ""
        ].filter(Boolean).join(" ")}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (event.button !== 0) {
            return;
          }
          const canvas = tokenCanvasRef.current;
          if (!canvas) {
            return;
          }
          const rect = canvas.getBoundingClientRect();
          setLinkDrag({
            sourceTokenId: item.id,
            startX: event.clientX - rect.left,
            startY: event.clientY - rect.top,
            currentX: event.clientX - rect.left,
            currentY: event.clientY - rect.top,
            isDragging: false
          });
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (suppressTokenClick.current) {
            suppressTokenClick.current = false;
            return;
          }
          handleTokenChipClick(item.id, event.shiftKey);
        }}
      >
        <span className="token-text token-color-preview" style={{ color: WORD_COLOR_STYLES[item.wordColorCategory ?? ""] }}>
          {item.surfaceText}
        </span>
      </button>
    );
  }

  function renderTokenChip(item: Token) {
    const tokenAnnotations = getTokenAnnotations(item);
    const upperAnnotation = tokenAnnotations.find((entry: TokenAnnotation) => (entry.orderIndex ?? 0) === 0) ?? null;
    const lowerAnnotation = tokenAnnotations.find((entry: TokenAnnotation) => (entry.orderIndex ?? 0) === 1) ?? null;
    const upperSlotKey = annotationSlotKey("token", item.id, 0);
    const lowerSlotKey = annotationSlotKey("token", item.id, 1);
    const upperSlotSelected = (selection.type === "annotation-slot"
      && selection.ownerType === "token"
      && selection.ownerId === item.id
      && selection.lane === 0) || selectedAnnotationSlotKeys.includes(upperSlotKey);
    const lowerSlotSelected = (selection.type === "annotation-slot"
      && selection.ownerType === "token"
      && selection.ownerId === item.id
      && selection.lane === 1) || selectedAnnotationSlotKeys.includes(lowerSlotKey);

    return (
      <div className="token-visual token-visual-single" key={item.id}>
        <div
          className={["annotation-lane", "annotation-lane-upper", upperAnnotation ? "filled" : "empty", upperSlotSelected ? "selected" : ""].join(" ")}
          onClick={(event) => {
            event.stopPropagation();
            if (upperAnnotation) {
              handleAnnotationClick(upperAnnotation.id);
            } else {
              selectAnnotationSlot("token", item.id, 0);
            }
          }}
        >
          {upperAnnotation ? (
            <span className="annotation-layer">
              {renderTokenAnnotationTag(upperAnnotation, "token")}
            </span>
          ) : null}
        </div>
        <div
          className={["annotation-lane", "annotation-lane-lower", lowerAnnotation ? "filled" : "empty", lowerSlotSelected ? "selected" : ""].join(" ")}
          onClick={(event) => {
            event.stopPropagation();
            if (lowerAnnotation) {
              handleAnnotationClick(lowerAnnotation.id);
            } else {
              selectAnnotationSlot("token", item.id, 1);
            }
          }}
        >
          {lowerAnnotation ? (
            <span className="annotation-layer">
              {renderTokenAnnotationTag(lowerAnnotation, "token")}
            </span>
          ) : null}
        </div>
        {renderTokenButton(item)}
      </div>
    );
  }

  function renderGroupedTokenChip(groupEntry: TokenGroup, groupTokens: Token[]) {
    const selected = selection.type === "group" && selection.id === groupEntry.id;
    const inlineGroupAnnotations = groupEntry.annotations.filter((entry: GroupAnnotation) => entry.styleKey !== "margin-note" && !entry.subgroupId);
    const marginAnnotation = groupEntry.annotations.find((entry: GroupAnnotation) => entry.styleKey === "margin-note") ?? null;
    const marginAccentColor = marginAnnotation
      ? getGroupAnnotationColor(marginAnnotation, groupTokens)
      : "#b08c2b";
    const tokenAnnotationRows = [0, 1];
    const sharedGridColumns = `repeat(${Math.max(groupTokens.length, 1)}, minmax(90px, max-content))`;
    const subgroupByTokenLaneKey = new Map<string, { id: string; lane: number; tokenIds: string[] }>();
    groupEntry.annotationSubgroups.forEach((entry) => entry.tokenIds.forEach((tokenId) => subgroupByTokenLaneKey.set(`${entry.lane}:${tokenId}`, entry)));
    return (
      <div
        key={groupEntry.id}
        className={["token-visual", "token-visual-group", selected ? "selected" : ""].filter(Boolean).join(" ")}
        onClick={() => {
          setSelection({ type: "group", id: groupEntry.id });
          setSelectedTokenIds([]);
        }}
      >
        <div
          className={[
            "annotation-lane",
            "annotation-lane-margin",
            marginAnnotation ? "filled" : "empty",
            (selected && !marginAnnotation) ? "selected" : ""
          ].join(" ")}
          style={{
            ["--margin-lane-accent" as "--margin-lane-accent"]: marginAccentColor,
            ["--margin-lane-tint" as "--margin-lane-tint"]: hexToRgba(marginAccentColor, marginAnnotation ? 0.18 : 0.1)
          } as CSSProperties}
          onClick={(event) => {
            event.stopPropagation();
            if (marginAnnotation) {
              handleAnnotationClick(marginAnnotation.id);
            } else {
              setSelection({ type: "group", id: groupEntry.id });
              setSelectedTokenIds([]);
            }
          }}
          title={marginAnnotation ? "Select the group's margin note" : "Select this group and use Margin to add a margin note"}
        >
          {marginAnnotation ? (
            <span className="annotation-layer group-annotation-layer">
              {renderTokenAnnotationTag(marginAnnotation, "group")}
            </span>
          ) : (
            <span className="annotation-lane-placeholder">Margin note</span>
          )}
        </div>
        <div
          className="group-column-grid"
          style={{ gridTemplateColumns: sharedGridColumns }}
        >
          {tokenAnnotationRows.map((rowIndex) => (
            <Fragment key={`${groupEntry.id}-upper-row-${rowIndex}`}>
              {getGroupLaneMode(groupEntry, rowIndex) === "grouped"
                ? (
                  (() => {
                    const sharedAnnotationsForRow = inlineGroupAnnotations.filter((entry) => (entry.orderIndex ?? 1) === rowIndex);
                    const sharedAnnotationSelected = sharedAnnotationsForRow.some((entry) => selectedAnnotationIds.includes(entry.id) || (selection.type === "annotation" && selection.id === entry.id));
                    return (
                  <div
                    className={[
                      "annotation-lane",
                      rowIndex === 0 ? "annotation-lane-upper" : "annotation-lane-lower",
                      sharedAnnotationsForRow.length > 0 ? "filled" : "empty",
                      "group-lane-button",
                      ((selection.type === "annotation-slot" && selection.ownerType === "group" && selection.ownerId === groupEntry.id && selection.lane === rowIndex)
                        || selectedAnnotationSlotKeys.includes(annotationSlotKey("group", groupEntry.id, rowIndex))
                        || sharedAnnotationSelected) ? "selected" : "",
                      selected ? "selected" : ""
                    ].filter(Boolean).join(" ")}
                    style={{ gridColumn: `1 / span ${Math.max(groupTokens.length, 1)}`, gridRow: rowIndex + 1 }}
                    onClick={(event) => {
                      event.stopPropagation();
                      const sharedAnnotation = sharedAnnotationsForRow[0];
                      if (sharedAnnotation) {
                        handleAnnotationClick(sharedAnnotation.id);
                      } else {
                        selectAnnotationSlot("group", groupEntry.id, rowIndex);
                      }
                    }}
                  >
                    {sharedAnnotationsForRow.length > 0 ? (
                      <span className="annotation-layer group-annotation-layer">
                        {sharedAnnotationsForRow.map((entry: GroupAnnotation) => renderTokenAnnotationTag(entry, "group"))}
                      </span>
                    ) : null}
                  </div>
                    );
                  })()
                )
                : groupTokens.map((tokenItem, tokenIndex) => {
                const subgroup = subgroupByTokenLaneKey.get(`${rowIndex}:${tokenItem.id}`) ?? null;
                if (subgroup && subgroup.tokenIds[0] !== tokenItem.id) {
                  return null;
                }
                if (subgroup) {
                  const subgroupAnnotation = groupEntry.annotations.find((entry: GroupAnnotation) => entry.subgroupId === subgroup.id) ?? null;
                  const subgroupSelected = selection.type === "annotation-subgroup" && selection.id === subgroup.id;
                  const subgroupAnnotationSelected = subgroupAnnotation
                    ? selectedAnnotationIds.includes(subgroupAnnotation.id)
                      || (selection.type === "annotation" && selection.id === subgroupAnnotation.id)
                    : false;
                  const subgroupSlotSelected = (selection.type === "annotation-slot" && selection.ownerType === "subgroup" && selection.ownerId === subgroup.id)
                    || selectedAnnotationSlotKeys.includes(annotationSlotKey("subgroup", subgroup.id, rowIndex));
                  return (
                    <div
                    key={`${groupEntry.id}-${subgroup.id}-lane-${rowIndex}`}
                    className={[
                      "annotation-lane",
                      rowIndex === 0 ? "annotation-lane-upper" : "annotation-lane-lower",
                      "group-lane-button",
                      subgroupAnnotation ? "filled" : "empty",
                      (subgroupSelected || subgroupSlotSelected || subgroupAnnotationSelected) ? "selected" : ""
                    ].join(" ")}
                      style={{ gridColumn: `${tokenIndex + 1} / span ${subgroup.tokenIds.length}`, gridRow: rowIndex + 1 }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (subgroupAnnotation) {
                          handleAnnotationClick(subgroupAnnotation.id);
                        } else {
                          selectAnnotationSlot("subgroup", subgroup.id, rowIndex);
                        }
                      }}
                    >
                      {subgroupAnnotation ? (
                        <span className="annotation-layer group-annotation-layer">
                          {renderTokenAnnotationTag(subgroupAnnotation, "group")}
                        </span>
                      ) : null}
                    </div>
                  );
                }
                const tokenAnnotations = getTokenAnnotations(tokenItem);
                const rowAnnotation = tokenAnnotations.find((entry: TokenAnnotation) => (entry.orderIndex ?? 0) === rowIndex) ?? null;
                const slotKey = annotationSlotKey("token", tokenItem.id, rowIndex);
                const upperSlotSelected = (selection.type === "annotation-slot"
                  && selection.ownerType === "token"
                  && selection.ownerId === tokenItem.id
                  && selection.lane === rowIndex) || selectedAnnotationSlotKeys.includes(slotKey);
                return (
                  <div
                    key={`${groupEntry.id}-${tokenItem.id}-lane-${rowIndex}`}
                    className={[
                      "annotation-lane",
                      rowIndex === 0 ? "annotation-lane-upper" : "annotation-lane-lower",
                      rowAnnotation ? "filled" : "empty",
                      upperSlotSelected ? "selected" : ""
                    ].join(" ")}
                    style={{ gridColumn: tokenIndex + 1, gridRow: rowIndex + 1 }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (rowAnnotation) {
                        handleAnnotationClick(rowAnnotation.id);
                      } else {
                        selectAnnotationSlot("token", tokenItem.id, rowIndex);
                      }
                    }}
                  >
                    {rowAnnotation ? (
                      <span className="annotation-layer">
                        {renderTokenAnnotationTag(rowAnnotation, "token")}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </Fragment>
          ))}
          {groupTokens.map((tokenItem, tokenIndex) => (
            <div
              key={`${groupEntry.id}-${tokenItem.id}-token`}
              className="group-token-cell"
              style={{ gridColumn: tokenIndex + 1, gridRow: 3 }}
            >
              {renderTokenButton(tokenItem)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function applySelectedAnnotationPatch(patch: Partial<TokenAnnotation> | Partial<GroupAnnotation>) {
    if (!annotationRecord) {
      return;
    }
    if (annotationRecord.ownerType === "token") {
      applyVerseUpdate(updateAnnotation(currentVerse, annotationRecord.annotation.id, patch as Partial<TokenAnnotation>));
      return;
    }
    applyVerseUpdate(updateGroupAnnotation(currentVerse, annotationRecord.annotation.id, patch as Partial<GroupAnnotation>));
  }

  function updateSelectedAnnotationContent(nextContent: AnnotationContentSegment[]) {
    if (!annotationRecord) {
      return;
    }
    applySelectedAnnotationPatch(setAnnotationContent(annotationRecord.annotation, nextContent));
  }

  return (
    <div className="app-shell phase-two">
      <header className="topbar">
        <div>
          <h1>KJVeasy-ISL Editor</h1>
          <p>{message}</p>
        </div>
        <div className="topbar-actions">
          <a className="topbar-link secondary" href={tutorialHref} target="_blank" rel="noreferrer">
            Tutorial
          </a>
          <label className="file-button">
            Import JSON
            <input type="file" accept="application/json" onChange={handleImport} />
          </label>
          <Button className="secondary" onClick={handleExport}>Export JSON</Button>
          <Button onClick={() => void handleSave()} disabled={isSaving}>{isSaving ? "Saving..." : "Save Verse"}</Button>
        </div>
      </header>

      <main className="three-pane phase-two-grid">
        <aside className="pane nav-pane">
          <SectionTitle>Bible Browser</SectionTitle>
          <Panel className="dashboard-card">
            <div className="nav-picker-grid">
              <Field className="compact-field">
                <span>Book</span>
                <select
                  value={selectedBook}
                  onChange={(event) => {
                    const nextBook = navigation.books.find((entry) => entry.book === event.target.value);
                    const firstChapter = nextBook?.chapters[0];
                    setSelectedBook(event.target.value);
                    setSelectedChapter(firstChapter?.chapter ?? 0);
                    if (firstChapter?.verses[0]) {
                      void loadVerse(firstChapter.verses[0].verseId);
                    }
                  }}
                >
                  {navigation.books.map((book) => (
                    <option key={book.book} value={book.book}>
                      {book.book}
                    </option>
                  ))}
                </select>
              </Field>
              <Field className="compact-field">
                <span>Chapter</span>
                <select
                  value={selectedChapter || ""}
                  onChange={(event) => {
                    const nextChapter = Number(event.target.value);
                    const chapterEntry = selectedBookEntry?.chapters.find((entry) => entry.chapter === nextChapter);
                    setSelectedChapter(nextChapter);
                    if (chapterEntry?.verses[0]) {
                      void loadVerse(chapterEntry.verses[0].verseId);
                    }
                  }}
                >
                  {(selectedBookEntry?.chapters ?? []).map((chapter) => (
                    <option key={chapter.chapter} value={chapter.chapter}>
                      Chapter {chapter.chapter}
                    </option>
                  ))}
                </select>
              </Field>
              <Field className="compact-field">
                <span>Verse</span>
                <select
                  value={verse?.verseId ?? ""}
                  onChange={(event) => void loadVerse(event.target.value)}
                >
                  {(selectedChapterEntry?.verses ?? []).map((entry) => (
                    <option key={entry.verseId} value={entry.verseId}>
                      Verse {entry.verse}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Panel>
        </aside>

        <div className="center-column">
        <section className="pane preview-pane">
          <SectionTitle>Verse Editor</SectionTitle>
          <div className="canvas-toolbar">
            <div className="toolbar-section">
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleUndo}
                title="Undo"
                disabled={historyPast.length === 0}
              >
                <span className="toolbar-icon">{TOOLBAR_ICONS.undo}</span>
                <span className="toolbar-label">Undo</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleRedo}
                title="Redo"
                disabled={historyFuture.length === 0}
              >
                <span className="toolbar-icon">{TOOLBAR_ICONS.redo}</span>
                <span className="toolbar-label">Redo</span>
              </Button>
            </div>
            <div className="toolbar-section">
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleAddVerseNote}
                title={isVerseContext ? "Add verse note" : "Select the verse to add a verse note"}
                disabled={!isVerseContext}
              >
                <span className="toolbar-icon">N</span>
                <span className="toolbar-label">Add Note</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleAddToken}
                title={isVerseContext ? "Add token" : "Select the verse to add a token"}
                disabled={!isVerseContext}
              >
                <span className="toolbar-icon">T</span>
                <span className="toolbar-label">Add Token</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleAddLink}
                title={canAddLink ? "Add link" : "Select the verse and make sure it has at least two tokens"}
                disabled={!canAddLink}
              >
                <span className="toolbar-icon">↗</span>
                <span className="toolbar-label">Add Link</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={() => handleSetLinkDirection("left")}
                title={link ? "Make the selected link point left" : "Select a link to change its direction"}
                disabled={!canPointLinkLeft}
              >
                <span className="toolbar-icon">{TOOLBAR_ICONS.linkLeft}</span>
                <span className="toolbar-label">Link Left</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={() => handleSetLinkDirection("right")}
                title={link ? "Make the selected link point right" : "Select a link to change its direction"}
                disabled={!canPointLinkRight}
              >
                <span className="toolbar-icon">{TOOLBAR_ICONS.linkRight}</span>
                <span className="toolbar-label">Link Right</span>
              </Button>
            </div>
            <div className="toolbar-section">
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleAddTokenAnnotation}
                title={canAddAnnotation ? (group ? "Add shared annotation to selected group" : "Add annotation to selected token") : "Select one token or group to add an annotation"}
                disabled={!canAddAnnotation}
              >
                <span className="toolbar-icon">A</span>
                <span className="toolbar-label">Add Ann</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={() => handleMoveAnnotationLane("up")}
                title={canMoveAnnotationUp ? "Move selected annotation to the upper token lane" : "Select a group-owned annotation to move it up"}
                disabled={!canMoveAnnotationUp}
              >
                <span className="toolbar-icon">{TOOLBAR_ICONS.annotationUp}</span>
                <span className="toolbar-label">Ann Up</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={() => handleMoveAnnotationLane("down")}
                title={canMoveAnnotationDown ? "Move selected annotation to the lower group lane" : "Select a token annotation inside a group to move it down"}
                disabled={!canMoveAnnotationDown}
              >
                <span className="toolbar-icon">{TOOLBAR_ICONS.annotationDown}</span>
                <span className="toolbar-label">Ann Down</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleMoveTokenLeft}
                title={canMoveTokenLeft ? "Move selected token left" : "Select one token that can move left"}
                disabled={!canMoveTokenLeft}
              >
                <span className="toolbar-icon">←</span>
                <span className="toolbar-label">Left</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleMoveTokenRight}
                title={canMoveTokenRight ? "Move selected token right" : "Select one token that can move right"}
                disabled={!canMoveTokenRight}
              >
                <span className="toolbar-icon">→</span>
                <span className="toolbar-label">Right</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleSplitLane}
                title={
                  ((annotationRecord?.ownerType === "group" && !isMarginNoteAnnotation(annotationRecord.annotation))
                    || (selection.type === "annotation-slot" && selection.ownerType === "group")
                    || selection.type === "group")
                    ? "Split the shared group annotation lane into per-token lower lanes"
                    : "Select a grouped annotation lane to split"
                }
                disabled={!canSplitLane}
              >
                <span className="toolbar-icon">{TOOLBAR_ICONS.split}</span>
                <span className="toolbar-label">Split Lane</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleCreateGroup}
                title={canCreateGroup ? "Group the selected tokens" : "Shift-click contiguous ungrouped tokens to create a group"}
                disabled={!canCreateGroup}
              >
                <span className="toolbar-icon">{TOOLBAR_ICONS.group}</span>
                <span className="toolbar-label">Group</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleUngroup}
                title={canUngroup ? "Ungroup the selected group" : "Select a group to ungroup it"}
                disabled={!canUngroup}
              >
                <span className="toolbar-icon">{TOOLBAR_ICONS.ungroup}</span>
                <span className="toolbar-label">Ungroup</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleCreateMarginAnnotation}
                title={canCreateMarginAnnotation ? "Create a margin note for the selected group" : "Select a group without a margin note to add one"}
                disabled={!canCreateMarginAnnotation}
              >
                <span className="toolbar-icon">{TOOLBAR_ICONS.margin}</span>
                <span className="toolbar-label">Margin</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleAutoPosTag}
                title={canRunVerseAutomation ? "Auto tag parts of speech" : "Select the verse to auto-tag the whole verse"}
                disabled={!canRunVerseAutomation}
              >
                <span className="toolbar-icon">{TOOLBAR_ICONS.pos}</span>
                <span className="toolbar-label">POS</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleAutoWordColorTag}
                title={canRunVerseAutomation ? "Auto detect word colors" : "Select the verse to auto-color the whole verse"}
                disabled={!canRunVerseAutomation}
              >
                <span className="toolbar-icon">{TOOLBAR_ICONS.color}</span>
                <span className="toolbar-label">Colors</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleRetokenize}
                title={canRunVerseAutomation ? "Retokenize verse" : "Select the verse to retokenize it"}
                disabled={!canRunVerseAutomation}
              >
                <span className="toolbar-icon">{TOOLBAR_ICONS.retokenize}</span>
                <span className="toolbar-label">Retokenize</span>
              </Button>
            </div>
            <div className="toolbar-section toolbar-section-emphasis">
              <Button
                className="toolbar-icon-button secondary"
                onClick={() => void handleCreateExportJob("export", "chapter")}
                title={canManageExports ? "Export chapter" : "Select the verse to export its chapter"}
                disabled={!canManageExports}
              >
                <span className="toolbar-icon">EC</span>
                <span className="toolbar-label">Export Ch</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={() => void handleCreateExportJob("export", "book")}
                title={canManageExports ? "Export book" : "Select the verse to export its book"}
                disabled={!canManageExports}
              >
                <span className="toolbar-icon">EB</span>
                <span className="toolbar-label">Export Book</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={() => void handleCreateExportJob("publish", "chapter")}
                title={canManageExports ? "Publish chapter" : "Select the verse to publish its chapter"}
                disabled={!canManageExports}
              >
                <span className="toolbar-icon">PC</span>
                <span className="toolbar-label">Publish Ch</span>
              </Button>
              <Button
                className="toolbar-icon-button secondary"
                onClick={() => void handleCreateExportJob("publish", "book")}
                title={canManageExports ? "Publish book" : "Select the verse to publish its book"}
                disabled={!canManageExports}
              >
                <span className="toolbar-icon">PB</span>
                <span className="toolbar-label">Publish Book</span>
              </Button>
            </div>
            <div className="toolbar-section">
              <Button
                className="toolbar-icon-button secondary"
                onClick={handleDeleteSelection}
                title={hasConcreteSelection ? (selection.type === "group" ? "Ungroup the selected tokens" : `Delete selected ${selection.type}`) : "Select tokens, a span, or another item to delete"}
                disabled={!hasConcreteSelection}
              >
                <span className="toolbar-icon">{TOOLBAR_ICONS.delete}</span>
                <span className="toolbar-label">Delete</span>
              </Button>
            </div>
          </div>
          <div className="chapter-toolbar">
            <div className="reference-heading">
              {verse.reference.book} {verse.reference.chapter}:{verse.reference.verse}
            </div>
          </div>

          <textarea
            className="source-text"
            value={verse.sourceText}
            onChange={(event) => applyVerseUpdate({ ...verse, sourceText: event.target.value })}
          />

          <Panel className="token-preview">
            <div className="token-preview-layout">
              <div
                ref={tokenCanvasRef}
                className="token-canvas"
                style={{ paddingBottom: `${linkOverlayHeight}px` }}
              >
                <svg className="link-overlay" aria-hidden="true">
                  <defs>
                    {positionedLinks.map(({ link: linkEntry, strokeColor }) => (
                      <marker
                        key={`marker-${linkEntry.id}`}
                        id={`token-link-arrow-${linkEntry.id}`}
                        markerWidth="6"
                        markerHeight="6"
                        refX="4.5"
                        refY="3"
                        orient="auto"
                        markerUnits="strokeWidth"
                      >
                        <path d="M 0 0 L 6 3 L 0 6 z" fill={strokeColor} stroke={strokeColor} />
                      </marker>
                    ))}
                    {draftLinkPath ? (
                      <marker
                        id="token-link-arrow-draft"
                        markerWidth="6"
                        markerHeight="6"
                        refX="4.5"
                        refY="3"
                        orient="auto"
                        markerUnits="strokeWidth"
                      >
                        <path d="M 0 0 L 6 3 L 0 6 z" fill={draftLinkPath.strokeColor} stroke={draftLinkPath.strokeColor} />
                      </marker>
                    ) : null}
                  </defs>
                  {positionedLinks.map(({ link: linkEntry, path, strokeColor }) => (
                    <path
                      key={linkEntry.id}
                      className={selection.type === "link" && selection.id === linkEntry.id ? "token-link-path selected" : "token-link-path"}
                      d={path}
                      style={{ color: strokeColor }}
                      markerEnd={`url(#token-link-arrow-${linkEntry.id})`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelection({ type: "link", id: linkEntry.id });
                        setSelectedTokenIds([]);
                      }}
                    />
                  ))}
                  {draftLinkPath ? (
                    <path
                      className="token-link-path draft"
                      d={draftLinkPath.path}
                      style={{ color: draftLinkPath.strokeColor }}
                      markerEnd="url(#token-link-arrow-draft)"
                    />
                  ) : null}
                </svg>
              <div className="token-flow">
                  {tokenVisualItems.map((item) => item.kind === "token"
                    ? renderTokenChip(item.token)
                    : renderGroupedTokenChip(item.group, item.tokens))}
                </div>
              </div>
            </div>
          </Panel>

          <div className="phase-two-columns">
            <Panel className="link-preview">
              <h4>Links</h4>
              {verse.tokenLinks.length === 0 ? <p>No links yet.</p> : null}
              {verse.tokenLinks.map((entry: TokenLink) => {
                const source = verse.tokens.find((tokenItem: Token) => tokenItem.id === entry.sourceTokenId)?.surfaceText ?? entry.sourceTokenId;
                const target = verse.tokens.find((tokenItem: Token) => tokenItem.id === entry.targetTokenId)?.surfaceText ?? entry.targetTokenId;
                return (
                  <button
                    key={entry.id}
                    className={selection.type === "link" && selection.id === entry.id ? "link-row selected" : "link-row"}
                    onClick={() => {
                      setSelection({ type: "link", id: entry.id });
                      setSelectedTokenIds([]);
                    }}
                  >
                    {source} {"->"} {target} ({entry.type})
                  </button>
                );
              })}
            </Panel>

            <Panel className="note-preview">
              <h4>Verse Notes</h4>
              {verse.verseAnnotations.map((entry: VerseAnnotation) => (
                <button
                  key={entry.id}
                  className={selection.type === "note" && selection.id === entry.id ? "note-card selected" : "note-card"}
                  onClick={() => {
                    setSelection({ type: "note", id: entry.id });
                    setSelectedTokenIds([]);
                  }}
                >
                  <strong>{entry.category}</strong>
                  <span>{entry.body}</span>
                </button>
              ))}
            </Panel>
          </div>

          <Panel className="media-preview">
            <div className="panel-header-row">
              <h4>Verse Media</h4>
              <span>{verse.verseMedia.length} attached</span>
            </div>
            <div className="media-grid">
              {verse.verseMedia.map((entry: VerseMedia) => (
                <button
                  key={entry.id}
                  className={selection.type === "media" && selection.id === entry.id ? "media-card selected" : "media-card"}
                  onClick={() => {
                    setSelection({ type: "media", id: entry.id });
                    setSelectedTokenIds([]);
                  }}
                >
                  <img src={entry.assetRef} alt={entry.altText || entry.caption} />
                  <span>{entry.caption || "Untitled image"}</span>
                </button>
              ))}
            </div>
          </Panel>

        </section>

        <section className="pane validation-pane">
          <div className="panel-header-row">
            <SectionTitle>Diagnostics</SectionTitle>
            {canFixAnyIssues ? (
              <Button className="secondary" onClick={fixAllIssues}>
                Repair Verse
              </Button>
            ) : null}
          </div>
          <div className="validation-summary">
            {actionableIssues.length === 0 ? <div className="ok-badge">No validation issues</div> : null}
            {actionableIssues.map(({ issue, key, canFix, focusLabel, fixLabel }) => (
              <div key={key} className={`issue-row ${issue.severity}`}>
                <div className="issue-severity">{issue.severity === "error" ? "Error" : "Warning"}</div>
                <div className="issue-path">{issue.path || "verse"}</div>
                <div className="issue-message">{issue.message}</div>
                <div className="issue-actions">
                  <Button className="secondary issue-action-button" onClick={() => focusIssue(issue)}>
                    Highlight
                  </Button>
                  {canFix && fixLabel ? (
                    <Button className="secondary issue-action-button" onClick={() => fixIssue(issue)}>
                      {fixLabel}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
        </div>

        <aside className="pane inspector-pane">
          <SectionTitle>Inspector</SectionTitle>

          <Panel className="workflow-card">
            <div className="panel-header-row">
              <strong>Media Library</strong>
              <span>{mediaLibrary.length} assets</span>
            </div>
            <div className="mini-list">
              {mediaLibrary.map((asset: MediaLibraryAsset) => (
                <button
                  key={asset.id}
                  className="mini-card left-aligned"
                  onClick={() => {
                    const newMedia: VerseMedia = {
                      id: createId("media"),
                      verseId: verse.verseId,
                      mediaType: asset.mediaType,
                      assetRef: asset.assetRef,
                      caption: asset.caption,
                      altText: asset.altText,
                      orderIndex: verse.verseMedia.length
                    };
                    applyVerseUpdate({ ...verse, verseMedia: [...verse.verseMedia, newMedia] });
                    setSelection({ type: "media", id: newMedia.id });
                    setSelectedTokenIds([]);
                  }}
                >
                  <strong>{asset.caption}</strong>
                  <span>{asset.tags.join(", ")}</span>
                </button>
              ))}
            </div>
          </Panel>

          {selectedTokens.length > 1 ? (
            <div>
              <Panel className="workflow-card">
                <div className="panel-header-row">
                  <strong>Selected Tokens</strong>
                  <span>{selectedTokens.length} selected</span>
                </div>
                <p className="helper-copy">Bulk edits apply to all selected tokens. Shift-click token chips to add or remove tokens from the selection.</p>
                <Field>
                  <span>Part Of Speech</span>
                  <select
                    value={bulkPartOfSpeech}
                    onChange={(event) => {
                      if (event.target.value === "__mixed__") return;
                      applyVerseUpdate(updateTokensById(selectedTokenIds, { partOfSpeech: event.target.value }));
                    }}
                  >
                    <option value="__mixed__">mixed</option>
                    {PARTS_OF_SPEECH.map((partOfSpeech) => (
                      <option key={partOfSpeech || "blank"} value={partOfSpeech}>
                        {partOfSpeech || "unassigned"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <span>Word Color</span>
                  <select
                    value={bulkWordColor}
                    onChange={(event) => {
                      if (event.target.value === "__mixed__") return;
                      applyVerseUpdate(updateTokensById(selectedTokenIds, { wordColorCategory: event.target.value as Token["wordColorCategory"] }));
                    }}
                  >
                    <option value="__mixed__">mixed</option>
                    {WORD_COLOR_CATEGORIES.map((category) => (
                      <option key={category || "blank"} value={category}>
                        {WORD_COLOR_LABELS[category]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <span>Proper Noun</span>
                  <select
                    value={bulkProperNoun}
                    onChange={(event) => {
                      if (event.target.value === "__mixed__") return;
                      applyVerseUpdate(updateTokensById(selectedTokenIds, { isProperNoun: event.target.value === "true" }));
                    }}
                  >
                    <option value="__mixed__">mixed</option>
                    <option value="true">yes</option>
                    <option value="false">no</option>
                  </select>
                </Field>
                <Field>
                  <span>Editorial</span>
                  <select
                    value={bulkEditorial}
                    onChange={(event) => {
                      if (event.target.value === "__mixed__") return;
                      applyVerseUpdate(updateTokensById(selectedTokenIds, { isEditorial: event.target.value === "true" }));
                    }}
                  >
                    <option value="__mixed__">mixed</option>
                    <option value="true">yes</option>
                    <option value="false">no</option>
                  </select>
                </Field>
                <Button
                  className="secondary"
                  onClick={() => {
                    if (activeSelectedToken) {
                      setSelectedTokenIds([activeSelectedToken.id]);
                      setSelection({ type: "token", id: activeSelectedToken.id });
                    }
                  }}
                >
                  Reduce To Active Token
                </Button>
              </Panel>
            </div>
          ) : group ? (
            <Panel className="workflow-card">
              <div className="panel-header-row">
                <strong>Grouped Tokens</strong>
                <span>{group.tokenIds.length} tokens</span>
              </div>
              <p className="helper-copy">{group.tokenIds.map((tokenId) => currentVerse.tokens.find((entry: Token) => entry.id === tokenId)?.surfaceText ?? tokenId).join(" ")}</p>
              <div className="mini-list">
                {group.annotations.filter((entry) => !isMarginNoteAnnotation(entry) && !entry.subgroupId).length === 0 ? <div className="helper-copy">No shared group-lane annotation yet.</div> : null}
                {group.annotations.map((entry: GroupAnnotation) => (
                  <button
                    key={entry.id}
                    className={(selectedAnnotationIds.includes(entry.id) || (selection.type === "annotation" && selection.id === entry.id)) ? "mini-card left-aligned selected" : "mini-card left-aligned"}
                    onClick={() => {
                      handleAnnotationClick(entry.id);
                    }}
                  >
                    <strong>{isMarginNoteAnnotation(entry) ? "margin note" : ANNOTATION_TYPE_LABELS[entry.type]}</strong>
                    <span>{entry.value}</span>
                  </button>
                ))}
              </div>
            </Panel>
          ) : token ? (
            <div>
              <Field>
                <span>Surface Text</span>
                <input
                  value={token.surfaceText}
                  onChange={(event) => applyVerseUpdate(updateToken(verse, token.id, {
                    surfaceText: event.target.value,
                    normalizedText: event.target.value.toLowerCase()
                  }))}
                />
              </Field>
              <Field>
                <span>Part Of Speech</span>
                <select value={token.partOfSpeech} onChange={(event) => applyVerseUpdate(updateToken(verse, token.id, { partOfSpeech: event.target.value }))}>
                  {PARTS_OF_SPEECH.map((partOfSpeech) => (
                    <option key={partOfSpeech || "blank"} value={partOfSpeech}>
                      {partOfSpeech || "unassigned"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field>
                <span>Word Color</span>
                <select
                  value={token.wordColorCategory}
                  onChange={(event) => applyVerseUpdate(updateToken(verse, token.id, { wordColorCategory: event.target.value as Token["wordColorCategory"] }))}
                >
                  {WORD_COLOR_CATEGORIES.map((category) => (
                    <option key={category || "blank"} value={category}>
                      {WORD_COLOR_LABELS[category]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}

          {annotationSlot ? (
            <Panel className="workflow-card">
              <div className="panel-header-row">
                <strong>Annotation Slot</strong>
                <span>{getDisplayLaneLabel(annotationSlot.ownerType, annotationSlot.lane)}</span>
              </div>
              <p className="helper-copy">
                {annotationSlot.ownerType === "group"
                  ? "This is the shared group annotation lane. Use Add Annotation to place a shared annotation here."
                  : "This is an empty token annotation spot. Use Add Annotation to place a new annotation in this row."}
              </p>
            </Panel>
          ) : null}

          {annotation ? (
            <div>
              <p className="helper-copy">
                {annotationRecord?.ownerType === "group" && isMarginNoteAnnotation(annotation)
                  ? "Edit this margin note in the dedicated top group lane. Emoji can be typed in the text box, and pasted images will be appended to the same annotation."
                  : "Edit this annotation directly in the canvas bubble. Emoji can be typed in the text box, and pasted images will be appended to the same annotation."}
              </p>
              <div className="panel-header-row">
                <Button
                  className="secondary"
                  onClick={() => updateSelectedAnnotationContent([...getAnnotationContent(annotation), { id: createId("seg"), type: "text", value: "new text" }])}
                >
                  Add Text
                </Button>
                <Button
                  className="secondary"
                  onClick={() => updateSelectedAnnotationContent([...getAnnotationContent(annotation), { id: createId("seg"), type: "emoji", value: "🙂" }])}
                >
                  Add Emoji
                </Button>
              </div>
              <Field>
                <span>Summary</span>
                <input value={annotation.value} readOnly />
              </Field>
              {annotationRecord?.ownerType === "group" && isMarginNoteAnnotation(annotation) ? (
                <Field>
                  <span>Word Color</span>
                  <select
                    value={annotationRecord.annotation.wordColorCategory ?? ""}
                    onChange={(event) => applySelectedAnnotationPatch({ wordColorCategory: event.target.value as Token["wordColorCategory"] })}
                  >
                    {WORD_COLOR_CATEGORIES.map((category) => (
                      <option key={category || "blank"} value={category}>
                        {WORD_COLOR_LABELS[category]}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
            </div>
          ) : null}

          {link ? (
            <div>
              <Field>
                <span>Type</span>
                <select value={link.type} onChange={(event) => applyVerseUpdate(updateLink(verse, link.id, { type: event.target.value as TokenLink["type"] }))}>
                  {LINK_TYPES.map((type: typeof LINK_TYPES[number]) => <option key={type} value={type}>{type}</option>)}
                </select>
              </Field>
              <Field>
                <span>Arrow Color</span>
                <select
                  value={link.wordColorCategory ?? ""}
                  onChange={(event) =>
                    applyVerseUpdate(
                      updateLink(verse, link.id, { wordColorCategory: event.target.value as Token["wordColorCategory"] })
                    )
                  }
                >
                  {WORD_COLOR_CATEGORIES.map((category: typeof WORD_COLOR_CATEGORIES[number]) => (
                    <option key={category || "unassigned"} value={category}>
                      {WORD_COLOR_LABELS[category]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field>
                <span>Label</span>
                <input value={link.label ?? ""} onChange={(event) => applyVerseUpdate(updateLink(verse, link.id, { label: event.target.value }))} />
              </Field>
              <Button className="danger" onClick={() => {
                applyVerseUpdate({ ...verse, tokenLinks: verse.tokenLinks.filter((entry: TokenLink) => entry.id !== link.id) });
                setSelection({ type: "verse" });
                setSelectedTokenIds([]);
              }}>Remove Link</Button>
            </div>
          ) : null}

          {note ? (
            <div>
              <Field>
                <span>Category</span>
                <select value={note.category} onChange={(event) => applyVerseUpdate(updateNote(verse, note.id, { category: event.target.value as VerseAnnotation["category"] }))}>
                  {NOTE_CATEGORIES.map((category: typeof NOTE_CATEGORIES[number]) => <option key={category} value={category}>{category}</option>)}
                </select>
              </Field>
              <Field>
                <span>Body</span>
                <textarea value={note.body} onChange={(event) => applyVerseUpdate(updateNote(verse, note.id, { body: event.target.value }))} />
              </Field>
            </div>
          ) : null}

          {media ? (
            <div>
              <Field>
                <span>Image URL</span>
                <input value={media.assetRef} onChange={(event) => applyVerseUpdate(updateMedia(verse, media.id, { assetRef: event.target.value }))} />
              </Field>
              <Field>
                <span>Caption</span>
                <input value={media.caption} onChange={(event) => applyVerseUpdate(updateMedia(verse, media.id, { caption: event.target.value }))} />
              </Field>
              <Field>
                <span>Alt Text</span>
                <input value={media.altText} onChange={(event) => applyVerseUpdate(updateMedia(verse, media.id, { altText: event.target.value }))} />
              </Field>
            </div>
          ) : null}
        </aside>
      </main>
    </div>
  );
}

export default App;
