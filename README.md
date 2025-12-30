# Doc Ingestion & Export (Docling-only)

Local-first Next.js app for PDF/DOCX upload, Docling conversion, strict quality gates, and Markdown/JSON exports.

## Prerequisites
- Node.js 20.9+
- Python 3.10+

## Setup (Windows-first)
1) Install Node dependencies:
```
npm install
```
2) Create Python venv and install worker deps:
```
python -m venv .venv
.\.venv\Scripts\pip install -r services\docling_worker\requirements.txt
```
3) Configure env:
```
Copy-Item .env.local.example .env.local
```
Edit `.env.local` and ensure `PYTHON_BIN` points to your venv python.
On macOS/Linux:
```
cp .env.local.example .env.local
```
Also set `DOCLING_WORKER` to `services/docling_worker/convert.py`.

4) Run the app:
```
npm run dev
```

## Scripts
- `npm run dev`: start Next.js dev server.
- `npm run build`: build production bundle.
- `npm run start`: run production server.
- `npm run lint`: run ESLint.
- `npm run test`: run Vitest unit tests with coverage.
- `npm run test:integration`: run Vitest integration tests with coverage.
- `npm run test:e2e`: run Playwright E2E suite (excluding UX audit).
- `npm run test:ux`: run the optional UX audit Playwright spec.
- `npm run ux:diff`: diff UX audit screenshots (before/after -> diff).

## Tests
Node unit tests:
```
npm run test
```
Integration tests:
```
npm run test:integration
```
E2E tests (install browsers once):
```
npx playwright install
npm run test:e2e
```
Optional UX audit (run on demand):
```
UX_AUDIT_PHASE=before npm run test:ux
UX_AUDIT_PHASE=after npm run test:ux
npm run ux:diff
```
Python tests:
```
python -m pytest -q --cov=services/docling_worker
```

## Project structure (current)
```
app/                      Next.js app router (UI + route handlers)
  _components/            UI components
  _lib/                   Shared logic (storage, config, schema, etc.)
services/docling_worker/  Python Docling worker
config/                   Quality gates config (single source of truth)
tests/
  node/
    unit/
    integration/
    e2e/
      ux-audit/            UX audit config/specs/output + ux diff script
      test-results/        Playwright output (gitignored)
  python/
  fixtures/
    docs/                 PDF fixtures + generators (e.g. generate_big_pdf.py)
data/                     Runtime uploads/exports (gitignored)
tests/node/e2e/data-test/  E2E data dir (gitignored)
```

## Notes
- `config/quality-gates.json` is the single source of truth for thresholds and limits.
- All artifacts are stored under `data/` (gitignored).
- `.env.local` stays local and is gitignored.
- Client server-state is managed with TanStack Query.
- Tests live under `tests/` (`tests/node`, `tests/python`, `tests/fixtures`).
- UX audit outputs live under `tests/node/e2e/ux-audit`.
- Python coverage data is stored at `tests/python/.coverage` (gitignored) and configured via `tests/python/.coveragerc`.
- Vitest coverage reports are stored at `tests/node/coverage` (gitignored).
