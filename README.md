<!-- @fileoverview Project setup, scripts, and structure for the Docling ingestion pipeline. -->
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
2) Set up the Python worker (uv):
See the "Python worker (uv)" section below.
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

## Python worker (uv)
Install uv (once):
```
python -m pip install --user uv
```
Create a worker venv and sync deps:
```
cd services/docling_worker
uv venv
uv sync --group test
```
Run worker tests:
```
uv run pytest -q
```

## Scripts
- `npm run dev`: start Next.js dev server.
- `npm run build`: build production bundle.
- `npm run start`: run production server.
- `npm run lint`: run ESLint.
- `npm run typecheck`: run TypeScript type checks.
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
Custom E2E port (keep dev server running on another port):
```
$env:E2E_PORT=3002; npm run test:e2e
```
Custom E2E Next.js dist dir (avoid dev lock collisions):
```
$env:E2E_DIST_DIR=".next-e2e"; npm run test:e2e
```
Use an existing dev server (avoids Next.js dev lock issues):
```
$env:E2E_BASE_URL="http://127.0.0.1:3000"; npm run test:e2e
```
Optional UX audit (run on demand):
```
UX_AUDIT_PHASE=before npm run test:ux
UX_AUDIT_PHASE=after npm run test:ux
npm run ux:diff
```
Custom UX audit port:
```
$env:UX_AUDIT_PORT=3003; npm run test:ux
```
Custom UX audit dist dir:
```
$env:UX_AUDIT_DIST_DIR=".next-ux-audit"; npm run test:ux
```
Use an existing dev server for UX audit:
```
$env:UX_AUDIT_BASE_URL="http://127.0.0.1:3000"; npm run test:ux
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
