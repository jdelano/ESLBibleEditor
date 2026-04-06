# Canonical Verse Schema Notes

The canonical verse model is defined in `packages/schema/src/index.ts`.

## Included entities

- Verse
- Token
- TokenAnnotation
- TokenLink
- VerseAnnotation
- VerseMedia
- EditorLayout
- Metadata

## Validation responsibilities

- Required field enforcement
- Duplicate ID detection
- Broken token, annotation, link, and media references
- Annotation type enforcement
- Coherent token ordering warnings

## Portability stance

The exported JSON is frontend-independent and intentionally suitable for later Android, iOS, web, and publishing pipelines.
