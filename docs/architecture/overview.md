# Architecture Overview

This repository implements a simplified Phase 3-ready version of the KJVeasy-ISL authoring system as a browser-based editor with a local file-backed API.

## Repository shape

- `apps/editor-web`: React browser editor using a three-pane authoring layout.
- `apps/api`: Express API with validation, import/export, and file persistence.
- `packages/schema`: shared domain types, schema validation, and utility helpers.
- `packages/ui`: small shared UI primitives for consistency across apps.
- `sample-data`: representative verse JSON files used for seeding and acceptance demos.

## Phase coverage

- Implemented now: Phase 1, the simplified single-user Phase 2 flow, and selected non-conflicting Phase 3 editing improvements.
- Planned by structure: richer Phase 3 layout interactions and the Phase 4 publishing pipeline.

## Key decisions

1. JSON remains canonical and round-trippable.
2. Layout is constrained to semantic placement hints and bounded offsets.
3. API persistence is file-based for quick internal setup, with shared support for verse saves, editor notes, and media library reuse.
4. Shared schema validation lives in one place to keep import, save, export, editing tools, and UI preview aligned.
