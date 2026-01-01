<!-- @fileoverview Repository instructions for the Doc Ingestion & Export project. -->
# Doc Ingestion & Export

## 0) Project overview

A **local-first** ingestion pipeline for **PDF/DOCX** documents and exports **Markdown + JSON** artifacts as a prerequisite step for downstream RAG (no embeddings/vector store/chunking here yet).  

- **Next.js (App Router)** provides the UI and API Route Handlers (upload, orchestration, serving artifacts).
- A **Python worker** runs **Docling** or **PyMuPDF** engines to convert documents, compute metrics, evaluate quality gates, and write artifacts.

## 1) Core commands (copy/paste)
> Use the repo scripts. If a script is missing, **add it** to `package.json` (don’t invent ad-hoc commands).

Node / Next.js:
- Install deps: `npm install`
- Dev: `npm run dev`
- Lint: `npm run lint`
- Tests: `npm run test`
- E2E: `npm run test:e2e`

Python worker:
  - Install deps: `cd services/docling_worker` then `uv sync --locked --group test`
  - Note: `--locked` keeps the venv aligned with `uv.lock` and prevents dependency drift.
  - If `uv` is not recognized, use `python -m uv sync --locked --group test` and `python -m uv run pytest -q`.
  - Tests: `cd services/docling_worker` then `uv run pytest -q`

## 2) Repo map (where things go)
- Next.js app + route handlers: `app/` (and/or `src/` if present)
- Python worker: `services/docling_worker/`
- Config (single source of truth for gates/limits): `config/quality-gates.json`
- Uploaded files: `data/uploads/` (or under `DATA_DIR`)
- Exported artifacts: `data/exports/<id>/` (or under `DATA_DIR`)

## 3) Tech Stack

> Keep this section accurate. Prefer **pinning versions** in the repo (e.g., `.nvmrc`, `package.json#engines`, `.python-version`, `uv.lock`) and update this list when they change.

### Application
- **Frontend/UI:** Next.js (App Router) + React + TypeScript
- **Server/API:** Next.js Route Handlers (Node runtime)
- **Doc processing worker:** Python CLI worker using **Docling** + **PyMuPDF** engines
- **Storage:** Local filesystem under `DATA_DIR` (`data/uploads/`, `data/exports/<id>/`)

### Config & contracts
- **Quality gates & limits:** `config/quality-gates.json` (single source of truth)
- **Per-document contract:** `meta.json` (always written; UI reads status/metrics/gate results from it)

### Tooling (recommended baseline)
- **Runtime targets to pin:** Node.js 20 LTS, Python 3.12
- **Node testing:** Vitest (unit/integration)
- **E2E:** Playwright
- **Python testing:** Pytest
- **Lint/format:** ESLint (Next.js), plus a formatter (Prettier or equivalent)  
- **Python lint/format (optional but recommended):** ruff + black

## 4) Strict boundaries (must follow)

### ✅ Always
- Keep diffs small and scoped to the task.
- Update/extend tests when behavior changes.
- Run the relevant test suites before calling work “done”.

### ⚠️ Ask first
- Add/remove dependencies or change lockfiles due to new deps.
- Large refactors across modules.
- CI/CD changes.

### 🚫 Never
- Commit secrets/tokens/credentials.
- Hardcode gate thresholds/limits in code or docs.
- Delete tests just to make CI green.
- Push directly on `main`

## 5) Quality gates (single source of truth)
- `config/quality-gates.json` is the **only** source of truth for:
  - accepted types (`accept.*`)
  - resource limits (`limits.*`)
  - computed metrics (`quality.*` and any additional metric definitions)
  - evaluation rules (`gates[]`)
- Do **not** duplicate thresholds/limits in:
  - the Python worker,
  - Next.js route handlers,
  - the UI,
  - environment variables,
  - this document.

### meta.json is the contract
- `meta.json` is written **always** (SUCCESS or FAILED).
- The UI must render status, metrics, and gate results **from meta.json**.

### Engines
- Docling (default)
- PyMuPDF4LLM (layout/standard)
- PyMuPDF text flags
- `pymupdf4llm.show_progress` (console tqdm) stays disabled to keep worker stdout JSONL-only.
- UI progress still updates because the worker emits per-page `emit_progress(...)` events.
- Do not enable any library progress output to stdout; it can break JSON parsing.

## 6) Per-document artifacts
For each ingested document `id`:
- **SUCCESS** → `output.md`, `output.json`, `meta.json`
- **FAILED** → only `meta.json` and `outputs.*Path = null`

## 7) Local setup (minimum)
1) Create `.env.local` from `.env.local.example` in the repo root.
2) Set at least:
   - `DATA_DIR`
   - `GATES_CONFIG_PATH` (path to `config/quality-gates.json`)
   - `PYTHON_BIN`
   - `DOCLING_WORKER` (Python worker entrypoint)
3) `GET /api/health` must quickly report whether setup is complete.  
   The UI must block upload until `ok=true`.

## 8) Testing rules (keep tests high-signal)

### What to test
- **Unit**: pure functions/helpers/validators.
- **Integration**: API + filesystem + spawn/orchestration (no browser).
- **E2E**: all **critical user journeys**

### Test quality requirements
- Deterministic tests (no random, no time-dependent flakiness).
- Fixtures must be **valid and deterministic** (including “valid but rejected by gates”).  
- Avoid corrupt PDFs as the primary negative-path case.

## 9) README maintenance (required)
Update `README.md` when changes affect:
- setup / env vars
- available commands
- project structure
- new important dependencies

## 10) If you’re stuck
1) Ask a clarifying question.
2) Propose a short plan.
3) Don’t make large speculative changes without approval.

## 11) Supplementary agent docs

Read these **before** working in the relevant area:
- `agent_docs/COMMENTS_POLICY.md` — code comments, docstrings, inline docs

> If a supplementary doc conflicts with this file, **this AGENTS.md takes precedence**.

---

## Final rule (mandatory)
At the end of any task that changes code, run all relevant suites (Node tests, E2E if present, and Python worker tests).  
If something fails, fix until everything is green.
