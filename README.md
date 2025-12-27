# Doc Ingestion & Export (Docling-only)

Local-first Next.js app for PDF/DOCX upload, Docling conversion, strict quality gates, and Markdown/JSON exports.

## Prerequisites
- Node.js 18+
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
Python tests:
```
python -m pytest -q --cov=services/docling_worker
```

## Notes
- `config/quality-gates.json` is the single source of truth for thresholds and limits.
- All artifacts are stored under `data/` (gitignored).
- `.env.local` stays local and is gitignored.
