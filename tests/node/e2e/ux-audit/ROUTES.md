# UX Audit Routes

This audit focuses on the core, unauthenticated flow for local document ingestion and export.

## /
- Primary user goal: upload a document and confirm it was processed.
- Key interactions: pick file, drag/drop, submit upload, see success or error state, search/filter recent docs, open a document detail.

## /docs/[id] (success)
- Primary user goal: review export quality and download outputs.
- Key interactions: view metrics and gates summary, preview Markdown/JSON, download exports, return to list.

## /docs/[id] (failed)
- Primary user goal: diagnose why processing failed.
- Key interactions: review failed gates/warnings, inspect logs, return to list.

## Cross-state checks
- Upload error state: submit without a file, invalid type, or too large.
- Upload progress state: observe the in-progress UI after clicking Upload.
