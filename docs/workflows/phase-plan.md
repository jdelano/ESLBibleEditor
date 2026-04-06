# Phased Implementation Plan

## Phase 1

- Single-verse editor
- Three-pane authoring UI
- Token, annotation, note, link, and media editing
- JSON import/export
- Shared validation
- Local save/load

## Phase 2

- Chapter dashboard and per-verse status
- Single-user editing workflow
- Autosave
- Media library

Status in this repo: implemented with a simplified single-user file-backed internal workflow.

## Phase 3

- Undo/redo
- Keyboard shortcuts
- Annotation reuse from nearby verses
- Bounded placement refinement with x/y offsets
- Collision warnings

Status in this repo: partially implemented without reintroducing multi-user or approval workflow features.

## Phase 4

- Bulk export and publishing jobs
- Deterministic artifact manifests
- Migration tooling
- Validation-gated publishing

Status in this repo: implemented in a simplified single-user form without approval workflow requirements.
