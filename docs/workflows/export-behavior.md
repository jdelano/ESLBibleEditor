# Export And Publish Behavior

## Scope

The Phase 4 packaging flow in this repository supports:

- chapter export jobs
- book export jobs
- publish jobs using the same package structure

## Validation gate

Because this repository no longer uses an approval workflow, publishing is gated by validation only.

- If any selected verse has blocking validation errors, the job fails.
- Warning-level issues are allowed but recorded on the job.

## Artifact structure

Each job writes to `apps/api/data/artifacts/<job-id>/`.

The directory contains:

- `manifest.json`
- `verses/*.json`
- a chapter or book aggregate JSON file
- `app-ready.json`

## Media packaging

Media is currently packaged as stable references in the manifest and app-ready JSON output. This keeps the output portable without assuming remote asset mirroring.
