<!-- @fileoverview UX audit findings and fixes for the ingestion UI. -->
# UX Audit Report

Methodology reference: Jakob Nielsen / NN/g "10 Usability Heuristics for User Interface Design"
https://www.nngroup.com/articles/ten-usability-heuristics/

This report uses screenshots captured by `tests/node/e2e/specs/ux-audit/ux-heuristics-audit.spec.ts`.

## 1) Visibility of System Status

### A) What to look for
- Can users tell when an upload is in progress or completed?
- Is the latest action confirmed with a clear, visible status?
- Are status indicators visible without requiring extra navigation?

### B) Findings
- H1-1: Upload completion is not explicitly confirmed.
  - Screenshots (BEFORE): `tests/node/e2e/ux-audit/before/home__desktop__success.png`, `tests/node/e2e/ux-audit/before/home__mobile__success.png`
  - Screenshots (AFTER): `tests/node/e2e/ux-audit/after/home__desktop__success.png`, `tests/node/e2e/ux-audit/after/home__mobile__success.png`
  - Diffs: `tests/node/e2e/ux-audit/diff/home__desktop__success__diff.png`, `tests/node/e2e/ux-audit/diff/home__mobile__success__diff.png`
  - Where: `/` - upload area and recent list
  - Experience: after upload, the user only sees the list update and can easily miss that the new item is ready.
  - Why it violates the heuristic: feedback is subtle and not tied to the user's last action.
  - Fix: add a post-upload banner with status and a "View details" action.
  - Priority: P1
  - Status: Fixed

### C) Fix plan
- Implemented: add an inline status banner after a successful upload with status + link to the new doc.

## 2) Match Between the System and the Real World

### A) What to look for
- Are labels and metrics phrased in plain language?
- Are abbreviations avoided unless well known?

### B) Findings
- H2-1: "MD chars" label is terse and unclear.
  - Screenshots (BEFORE): `tests/node/e2e/ux-audit/before/home__desktop__success.png`, `tests/node/e2e/ux-audit/before/doc-success__desktop__default.png`
  - Screenshots (AFTER): `tests/node/e2e/ux-audit/after/home__desktop__success.png`, `tests/node/e2e/ux-audit/after/doc-success__desktop__default.png`
  - Diffs: `tests/node/e2e/ux-audit/diff/home__desktop__success__diff.png`, `tests/node/e2e/ux-audit/diff/doc-success__desktop__default__diff.png`
  - Where: `/` list and `/docs/[id]` metrics
  - Experience: users must infer that "MD" means Markdown.
  - Why it violates the heuristic: it uses jargon instead of user-facing language.
  - Fix: rename to "Markdown chars".
  - Priority: P2
  - Status: Fixed

### C) Fix plan
- Implemented: update list and detail labels from "MD chars" to "Markdown chars".

## 3) User Control and Freedom

### A) What to look for
- Can users easily back out of a path?
- Are there obvious ways to undo or change a recent selection?

### B) Findings
- No issues observed in this audit.

### C) Fix plan
- N/A

## 4) Consistency and Standards

### A) What to look for
- Do buttons, labels, and actions behave consistently?
- Are similar states presented in similar ways?

### B) Findings
- No issues observed in this audit.

### C) Fix plan
- N/A

## 5) Error Prevention

### A) What to look for
- Does the UI prevent invalid uploads before submission?
- Are constraints visible and enforced at selection time?

### B) Findings
- H5-1: Unsupported file types are not blocked at selection time.
  - Screenshots (BEFORE): `tests/node/e2e/ux-audit/before/home-empty__desktop__default.png`, `tests/node/e2e/ux-audit/before/home-empty__mobile__default.png`
  - Screenshots (AFTER): `tests/node/e2e/ux-audit/after/home-empty__desktop__default.png`, `tests/node/e2e/ux-audit/after/home-empty__mobile__default.png`
  - Diffs: `tests/node/e2e/ux-audit/diff/home-empty__desktop__default__diff.png`, `tests/node/e2e/ux-audit/diff/home-empty__mobile__default__diff.png`
  - Where: `/` - upload form
  - Experience: users can pick a non-PDF/DOCX file and only learn after submit.
  - Why it violates the heuristic: the UI allows invalid actions instead of preventing them.
  - Fix: validate selected file against config-driven extensions/mime types and disable upload with a clear error.
  - Priority: P1
  - Status: Fixed

### C) Fix plan
- Implemented: add client-side checks for extensions + mime types using `/api/health` config and surface an inline error.

## 6) Recognition Rather than Recall

### A) What to look for
- Are next steps and recent results visible without remembering IDs?
- Are important actions discoverable where the user is?

### B) Findings
- H6-1: The latest processed document has no immediate action.
  - Screenshots (BEFORE): `tests/node/e2e/ux-audit/before/home__desktop__success.png`, `tests/node/e2e/ux-audit/before/home__mobile__success.png`
  - Screenshots (AFTER): `tests/node/e2e/ux-audit/after/home__desktop__success.png`, `tests/node/e2e/ux-audit/after/home__mobile__success.png`
  - Diffs: `tests/node/e2e/ux-audit/diff/home__desktop__success__diff.png`, `tests/node/e2e/ux-audit/diff/home__mobile__success__diff.png`
  - Where: `/` - upload area
  - Experience: the user must scan the list to find the new item and click it.
  - Why it violates the heuristic: it relies on memory and scanning instead of surfacing the next action.
  - Fix: include a "View details" link in the post-upload status banner.
  - Priority: P2
  - Status: Fixed

### C) Fix plan
- Implemented: reuse the upload status banner to surface a direct link to the new doc.

## 7) Flexibility and Efficiency of Use

### A) What to look for
- Are shortcuts available for power users?
- Can frequent actions be done quickly?

### B) Findings
- No issues observed in this audit.

### C) Fix plan
- N/A

## 8) Aesthetic and Minimalist Design

### A) What to look for
- Is the information dense but scannable?
- Are labels concise and not repetitive?

### B) Findings
- No issues observed in this audit.

### C) Fix plan
- N/A

## 9) Help Users Recognize, Diagnose, and Recover from Errors

### A) What to look for
- Do error messages explain what to do next?
- Are recovery steps clear and nearby?

### B) Findings
- H9-1: The "Select a file first" error lacks guidance on allowed formats.
  - Screenshots (BEFORE): `tests/node/e2e/ux-audit/before/home__desktop__error-no-file.png`, `tests/node/e2e/ux-audit/before/home__mobile__error-no-file.png`
  - Screenshots (AFTER): `tests/node/e2e/ux-audit/after/home__desktop__error-no-file.png`, `tests/node/e2e/ux-audit/after/home__mobile__error-no-file.png`
  - Diffs: `tests/node/e2e/ux-audit/diff/home__desktop__error-no-file__diff.png`, `tests/node/e2e/ux-audit/diff/home__mobile__error-no-file__diff.png`
  - Where: `/` - upload form error state
  - Experience: the user is told to select a file but not which types are valid.
  - Why it violates the heuristic: it does not guide the user to a valid recovery action.
  - Fix: include allowed types in the error and keep the guidance near the file picker.
  - Priority: P2
  - Status: Fixed

### C) Fix plan
- Implemented: expand the error message to mention allowed file types and size limits.

## 10) Help and Documentation

### A) What to look for
- Are there lightweight tips for first-time users?
- Is documentation discoverable from the UI?

### B) Findings
- No issues observed in this audit.

### C) Fix plan
- N/A

## Summary of improvements
- Added a post-upload status banner with success feedback and a direct "View details" action.
- Clarified metrics by replacing "MD chars" with "Markdown chars" in lists and detail pages.
- Prevented invalid uploads with client-side checks for extensions and mime types.
- Expanded error guidance to include allowed file types and size limits.
- Generated before/after visual diffs for the audited routes.

## Remaining risks
- The failed document details view still presents dense logs that may overwhelm non-technical users. `tests/node/e2e/ux-audit/after/doc-failed__desktop__default.png`
