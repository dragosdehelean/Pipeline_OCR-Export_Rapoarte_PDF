<!-- @fileoverview Project setup, scripts, and structure for the ingestion pipeline. -->
# Doc Ingestion & Export

Local-first Next.js app for PDF/DOCX upload, configurable extraction engines, strict quality gates, and Markdown/JSON exports.

## Prerequisites
- Node.js 20.9+
- Python 3.10+
- Optional GPU acceleration: NVIDIA CUDA drivers + CUDA-enabled PyTorch in the worker venv.

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
Edit `.env.local` and ensure `PYTHON_BIN` points to your worker venv python
(for uv: `services/docling_worker/.venv/Scripts/python` on Windows).
On macOS/Linux:
```
cp .env.local.example .env.local
```
Also set `DOCLING_WORKER` to `services/docling_worker/convert.py`.
Optionally set `PYMUPDF_CONFIG_PATH` to `config/pymupdf.json`.

4) Run the app:
```
npm run dev
```

## Python worker (uv)
Install uv (once):
```
python -m pip install --user uv
```
Windows tip: if `uv` is not recognized, you can run commands via Python.
Equivalent examples:
- Preferred: `uv sync --locked --group test`
- Fallback: `python -m uv sync --locked --group test`
Create a worker venv and sync deps:
If `uv` is not recognized, use `python -m uv` for each command below.
```
cd services/docling_worker
uv venv
uv sync --locked --group test
```
Always use `--locked` to keep the worker venv aligned with `uv.lock` and prevent dependency drift.
Run worker tests:
If `uv` is not recognized, use `python -m uv` for the command below.
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
If `uv` is not recognized, use `python -m uv` for the command below.
```
cd services/docling_worker
uv run pytest -q
```

## Engines and profiles
- Default engine is Docling.
- PyMuPDF4LLM supports layout/standard modes (layout requires `pymupdf-layout`).
- PyMuPDF text extraction uses configurable TEXT_* flags from `config/pymupdf.json`.
- `pymupdf4llm.show_progress` (console tqdm) stays disabled to keep worker stdout JSONL-only.
- The UI progress bar still updates because the worker emits per-page `emit_progress(...)` events.
- Do not enable any library progress output to stdout; it can break JSON parsing.

### Docling profiles
- The default profile is `digital-balanced`: OCR is disabled by design, table structure runs in FAST mode, and the PDF backend is set to `dlparse_v2` in `config/docling.json`.
- `digital-fast` is available as a profile with table structure disabled.
- `digital-accurate` uses `dlparse_v4` with TableFormer ACCURATE.
- `digital-accurate-nocellmatch` uses `dlparse_v4` with TableFormer ACCURATE and `do_cell_matching=false`.
- To change profiles manually, edit `config/docling.json`.
- Scan-like PDFs are rejected in a fast preflight step (no OCR fallback); tune thresholds under `preflight.pdfText` in `config/docling.json`.
- Docling internal `document_timeout` is configured per profile under `documentTimeoutSec`.
- Accelerator defaults live in `config/docling.json` under `docling.accelerator.defaultDevice` and can be overridden per upload in the UI Advanced panel.

## Project structure (current)
```
app/                      Next.js app router (UI + route handlers)
  _components/            UI components
  _lib/                   Shared logic (storage, config, schema, etc.)
services/docling_worker/  Python Docling worker
config/                   Quality gates config + Docling/PyMuPDF configs
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
- `config/docling.json` defines the Docling profiles + preflight settings.
- `config/pymupdf.json` defines PyMuPDF engine defaults and flags.
- All artifacts are stored under `data/` (gitignored).
- `.env.local` stays local and is gitignored.
- Client server-state is managed with TanStack Query.
- The Python worker prewarms at server startup via Next.js instrumentation and shuts down with the server.
- Tests live under `tests/` (`tests/node`, `tests/python`, `tests/fixtures`).
- UX audit outputs live under `tests/node/e2e/ux-audit`.
- Python coverage data is stored at `tests/python/.coverage` (gitignored) and configured via `tests/python/.coveragerc`.
- Vitest coverage reports are stored at `tests/node/coverage` (gitignored).
- Use `scripts/bench_convert.py --input <path>` to benchmark a single conversion locally.
- Use `scripts/bench_worker_reuse.py --input <path>` to compare first vs. hot reuse spawn timings.
