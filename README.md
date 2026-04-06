# KJVeasy-ISL Editor

Browser-based Phase 4 implementation for single-user authoring and packaging of verse JSON for the KJVeasy-ISL Bible workflow.

## What is implemented

- Three-pane desktop editor
- Chapter-aware book/chapter/verse workflow
- Chapter dashboard indicators for completeness and validation
- Verse editing for one verse at a time inside a chapter flow
- Token editing with insert, delete, reorder, split, and merge
- Token annotations with visual preview
- Antecedent-style token links
- Verse notes and verse image attachments
- Media library reuse
- Autosave and explicit saves
- Editor notes anchored to verse elements
- Single-user internal workflow
- Undo and redo
- Keyboard shortcuts for save, undo, and redo
- Reuse annotations from nearby verses in the same chapter
- Bounded annotation placement refinement with x/y offsets
- Collision and readability warnings for crowded annotation layouts
- Bulk export and publish jobs by chapter or book
- Deterministic manifest generation and app-ready package output
- Media reference packaging inside export artifacts
- Validation-gated publishing
- Schema migration script for existing verse files
- JSON import and export
- Shared schema validation
- Local file-backed API persistence
- Sample data, docs, and tests

## Repo structure

- `apps/editor-web`: React frontend
- `apps/api`: Express backend
- `packages/schema`: shared domain schema and validation
- `packages/ui`: shared UI primitives
- `sample-data`: seed verse files
- `docs`: architecture, schema, and workflow notes

## Local setup

## Runtime requirement

This repo is pinned to Node `24.14.1` LTS via [`.nvmrc`](/Users/jdelano/Developer/ESLBibleEditor/.nvmrc) and [`.node-version`](/Users/jdelano/Developer/ESLBibleEditor/.node-version).

If you use `nvm`:

```bash
nvm install
nvm use
```

This project also expects a modern npm version. With Node `24.14.1`, npm 11 is the expected baseline.

1. Install dependencies:

```bash
npm install
npm --prefix apps/api install
npm --prefix apps/editor-web install
```

2. Seed local data:

```bash
node scripts/seed-data.js
```

3. Run both apps:

```bash
npm run dev
```

4. Open `http://localhost:5173`

The API runs at `http://localhost:4000`.

## Commands

```bash
npm run dev
npm run build
npm run test
node scripts/migrate-schema.js
```

## Notes

- This repository now covers the revised major Phase 2 requirements, a non-conflicting subset of Phase 3, and a simplified Phase 4 packaging flow.
- Publishing is interpreted here as validation-gated package generation for a single-user tool. It does not depend on an approval workflow.
- Phase 3 items that remain partial or planned include drag-assisted placement, richer multi-select behavior, and diffing.
