# Doc Ingestion & Export (Docling-only + Quality Gates)

## 0) Scop (scope) și rezultat final verificabil

Construiește o aplicație locală **Next.js (App Router)** care permite:

1) **Upload** de fișiere **PDF** și **DOCX**  
2) **Conversie “Docling-only”** (layout + OCR + tabele) în:
   - **Markdown** (pentru citire/preview)
   - **JSON “lossless”** (pentru verificare tehnică și viitoare indexare)
3) **Quality gates stricte**: respinge documente “proaste” și afișează clar **motivele** respingerii
4) **UI**: listează documentele încărcate, status (SUCCESS/FAILED), metrici, și preview pentru exporturi
5) **Testare maximă**: unit + integration + E2E (Playwright), cu praguri de coverage

**Criteriu de “DONE” (acceptance):**  
Pe `localhost`, după `npm run dev`, pot încărca un PDF/DOCX și văd:
- fie **exporturile** (Markdown + JSON) și metricile,
- fie **FAILED** + motivele exacte (gates) + log util.

---

## 1) Tehnologii

### Runtime & Web
- **Next.js App Router + Route Handlers** 
- **Node.js runtime pentru route segments (`export const runtime = 'nodejs'`)** 
- **Upload în Route Handler cu `await req.formData()`** (maintainer Vercel)  
- **Node `child_process.spawn()`** pentru execuție Python  

### Doc processing
- **Docling (Python)**: `DocumentConverter().convert()` + `export_to_markdown()` 
- **DoclingDocument**: `export_to_dict()`, `export_to_markdown()`, `num_pages`, `tables/texts/pages`
- **Docling suportă PDF + DOCX (și multe altele)** 

### Testare
- **Vitest guide pentru Next.js** 
- **Playwright (Node) install + run**  
- **pytest-cov** (coverage pentru Python)  

---

## 2) Non-scope (ce NU faci acum)

- Nu construiești încă vector store / embeddings / chunking / RAG runtime.
- Nu implementezi integrare cloud sau deployment (design-ul e local-first, cu filesystem local).
- Nu optimizezi performanțe GPU/VLM; folosești pipeline-ul standard Docling.

---

## 3) Arhitectură (local-first, robust, ieftin)

### 3.1 Componente
- **Next.js UI** (upload + listă documente + preview)
- **Next.js API (Route Handlers)**:
  - `POST /api/docs` — upload + start conversie
  - `GET /api/docs` — listă docs
  - `GET /api/docs/:id` — metadata + status + metrici + motive eșec
  - `GET /api/docs/:id/md` — returnează Markdown
  - `GET /api/docs/:id/json` — returnează JSON
- **Worker local (Python script)**:
  - rulează Docling, calculează metrici, aplică gates, scrie exporturile pe disk

### 3.2 De ce “Python script invocat din Next.js”
- Evită să “reinventezi” un server Python separat.
- Păstrează conversia într-un boundary clar: “Next.js orchestration” + “Docling processing”.
- Poți omorî procesul la timeout din Node (robust).

---

## 4) Structură repo (propusă)

```
/
  app/
    page.tsx                   # upload + listă
    docs/[id]/page.tsx         # preview + metrici + erori
  app/api/docs/route.ts        # POST (upload) + GET (list)
  app/api/docs/[id]/route.ts   # GET (details)
  app/api/docs/[id]/md/route.ts
  app/api/docs/[id]/json/route.ts

  services/docling_worker/
    convert.py                 # scriptul “single entrypoint”
    gates.py                   # logic gates + metrici
    requirements.txt
    tests/                     # pytest

  lib/
    storage.ts                 # fs helpers (save file, paths)
    processRunner.ts           # spawn python + timeout + capture logs
    schema.ts                  # zod (API responses)

  data/
    uploads/                   # fișiere originale
    exports/<id>/
      output.md
      output.json
      meta.json                # status, metrici, logs, gates
    index.json                 # listă documente (local DB simplu)

  tests/
    unit/                      # vitest unit
    integration/               # vitest integration (API)
  e2e/                         # playwright

  fixtures/
    meta/
      meta.success.json        # exemplu output meta.json (SUCCESS)
      meta.failed.json         # exemplu output meta.json (FAILED)


  config/
    quality-gates.json         # praguri + setări

  .env.local.example
```

---

## 5) Quality Gates (STRICT)

**Sursa unică de adevăr:** `config/quality-gates.json`. Codul NU hardcodează praguri/limite în altă parte.

### 5.1 Tipuri acceptate
Conform `accept`:
- `accept.mimeTypes`: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `accept.extensions`: `.pdf`, `.docx`

Respinge tot restul cu motiv explicit (gate FAIL).

### 5.2 Limite de resurse
Conform `limits`:
- `limits.maxFileSizeMb` (implicit 40)
- `limits.maxPages` (implicit 300)
- `limits.processTimeoutSec` (implicit 180)
- `limits.stdoutTailKb` (implicit 64)
- `limits.stderrTailKb` (implicit 64)

### 5.3 Metrici calculate (numele sunt stabile)
Worker-ul calculează exact aceste metrici (folosite de gates + UI):
- `pages`
- `textChars`
- `mdChars`
- `textItems`
- `tables`
- `textCharsPerPageAvg`

### 5.4 Gate-uri de calitate
Conform `quality` + `gates`:

- `DOC_PAGES_GT_0`: `pages > 0`
- `TEXT_CHARS_MIN`: `textChars >= quality.minTextChars` (implicit 15000)
- `TEXT_CHARS_PER_PAGE_AVG_MIN`: `textCharsPerPageAvg >= quality.minTextCharsPerPageAvg` (implicit 500)
- `TEXT_ITEMS_MIN`: `textItems >= quality.minTextItems` (implicit 200)
- `MARKDOWN_CHARS_MIN`: `mdChars >= quality.minMarkdownChars` (implicit 10000)
- `TABLES_MIN`: `tables >= quality.minTables` (implicit 0)

**Ieșire gates / comportament:**
- Dacă toate gates cu `severity=FAIL` trec: `processing.status=SUCCESS`, scrie `output.md`, `output.json`, `meta.json`.
- Dacă orice gate FAIL pică: `processing.status=FAILED`, NU scrie `output.md/json` (și în `meta.json` setează `outputs.*Path = null`), dar scrie întotdeauna `meta.json` cu:
  - `metrics`
  - `qualityGates.passed=false` + `qualityGates.failedGates[]` + `qualityGates.evaluated[]`
  - `logs.stdoutTail` / `logs.stderrTail` (limitări conform `limits.*TailKb`)

---

## 6) Contracte de date (API responses)

### 6.1 `DocMeta` (model unic pentru UI)
Acesta este modelul returnat de API către UI (derivat din `data/exports/<id>/meta.json`):

- `id: string`
- `originalFileName: string`
- `mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'`
- `createdAt: string (ISO)`
- `status: 'PENDING' | 'SUCCESS' | 'FAILED'`
- `metrics: { pages, textChars, mdChars, textItems, tables, textCharsPerPageAvg }`
- `failedGates: Array<{ code: string, message: string, actual: number, expectedOp: string, expected: number }>`
- `logs: { stdoutTail: string, stderrTail: string }`

Validează cu **zod** în backend și în frontend (same schema).

### 6.2 `meta.json` (artefact per document; schema stabilă)
Worker-ul scrie întotdeauna `data/exports/<id>/meta.json` cu următoarele “top-level” chei (schemaVersion=1):

- `schemaVersion`, `id`, `createdAt`
- `source` (nume fișier, mimeType, sizeBytes, sha256, storedPath)
- `processing` (status, startedAt, finishedAt, durationMs, timeoutSec, exitCode, worker info)
- `outputs` (paths către `output.md` / `output.json` sau `null` la FAILED)
- `metrics` (exact ca în 5.3)
- `qualityGates`:
  - `configVersion`, `strict`, `passed`
  - `failedGates[]` (cu `code`, `message`, `actual`, `expectedOp`, `expected`)
  - `evaluated[]` (listă completă a evaluărilor)
- `logs` (`stdoutTail`, `stderrTail`)

În repo există și exemple “golden files” pentru testare/contract/UI:
- `fixtures/meta/meta.success.json`
- `fixtures/meta/meta.failed.json`

---

## 7) Implementare: cerințe exacte (fără improvizații)

### 7.1 Route Handler pentru upload
- Rulează în **Node.js runtime**, nu edge.
- Citește fișierul cu `await req.formData()`
- Validează MIME + extensie folosind `config/quality-gates.json` (`accept.*`).
- Scrie fișierul pe disk în `data/uploads/<id>.<ext>`
- Invocă Python worker cu `child_process.spawn()` și:
  - timeout hard = `limits.processTimeoutSec` (din `config/quality-gates.json`)
  - capturare stdout/stderr (tail limitat conform `limits.*TailKb`)
- După terminarea worker-ului:
  - citește `data/exports/<id>/meta.json`
  - returnează `DocMeta` (SUCCESS/FAILED) pe baza `processing.status` + `qualityGates.failedGates`
- Dacă worker-ul se termină cu exitCode != 0 (crash/exception), tratează ca eroare de procesare și expune în UI `logs.stderrTail` + un mesaj explicit.

### 7.2 Worker Python (Docling)
- Interfață CLI obligatorie (argumente):
  - `--input <path către fișierul upload-at>`
  - `--doc-id <id>`
  - `--data-dir <cale către data/>`
  - `--gates <cale către config/quality-gates.json>`
- Folosește Docling:
  - `DocumentConverter().convert(path)`
  - `result.document.export_to_markdown()`
  - `result.document.export_to_dict()`
- Calculează metricile (vezi 5.3) și evaluează gates din fișierul dat prin `--gates`.
- Scrie întotdeauna `data/exports/<id>/meta.json` (schema din 6.2).
- La SUCCESS: scrie `output.md` + `output.json` + `meta.json`.
- La FAILED (gates): NU scrie `output.md/json` și setează în `meta.json` `outputs.*Path = null`, dar păstrează `meta.json` cu `failedGates[]`.

---

## 8) UX minim (dar complet)

### Pagina `/`
- Zonă de upload (drag&drop + file picker)
- Listă documente (ultimele 50):
  - nume, data, status, pages, textChars, mdChars
  - link către `/docs/[id]`

### Pagina `/docs/[id]`
- Panou status + metrici + gates (dacă failed)
- Tab “Markdown” (render simplu: `<pre>` sau viewer minimal)
- Tab “JSON” (render simplu: `<pre>`)

---

## 9) Setup local (developer experience)

### 9.1 Environment
- `.env.local`:
  - `DATA_DIR=./data`
  - `GATES_CONFIG_PATH=./config/quality-gates.json`
  - `PYTHON_BIN=./.venv/Scripts/python` (Windows) / `./.venv/bin/python` (mac/linux)
  - `DOCLING_WORKER=services/docling_worker/convert.py`

Notă: timeout-urile și pragurile de calitate se citesc din `config/quality-gates.json` (nu se dublează în env).


### 9.2 Comenzi (npm)
- `npm run dev`
- `npm run test` (vitest)
- `npm run test:integration`
- `npm run test:e2e` (playwright)
- `npm run lint`

### 9.3 Comenzi (python)
- `python -m venv .venv`
- `pip install -r services/docling_worker/requirements.txt`
- `python -m pytest -q --cov=services/docling_worker`

---

## 10) Strategia de testare (maximă)

### 10.1 Unit tests (Vitest)
- Validează:
  - schema Zod pentru responses
  - storage helpers (paths, sanitize)
  - process runner (mock spawn)
  - UI components (render status, failed gates)

Urmează ghidul Next.js pentru Vitest.

### 10.2 Integration tests (Vitest)
- Pornește Next.js route handlers în test mode (sau testează handlers ca funcții)
- Rulează upload cu fixture mic și verifică:
  - scriere în `data/uploads`
  - `meta.json` creat
  - status corect (SUCCESS/FAILED)

### 10.3 E2E (Playwright)
- Rulează app local și testează end-to-end:
  1) Upload PDF “good” → vezi SUCCESS, tabs, preview
  2) Upload PDF “bad” → vezi FAILED + motive
  3) Navigare listă → detalii doc

Setup Playwright conform docs.

### 10.4 Fixtures
- Include în repo `fixtures/good.pdf` și `fixtures/bad.pdf` (foarte mici) **sau** generează-le determinist în teste (fără dependențe runtime în producție).
- Include și fixtures/meta/*.json ca golden files pentru UI/contract tests (SUCCESS vs FAILED).

---

## 11) Observabilitate & debugging (obligatoriu)

- Loghează per document:
  - durata conversiei
  - exit code python
  - stdout/stderr tail (max N KB)
  - metrici + gates
- Expune în UI aceste informații (mai ales pentru FAILED).

---

## 12) Reguli anti-halucinație pentru Agent (obligatoriu)

1) Consultă docs oficiale înainte să introduci un API nou.  
2) Verifică că pachetul există și API-ul e real pentru versiunea folosită.  
3) Marchează explicit în PR/commit message:
   - **✓verificat** (cu link către docs) sau
   - **⚠️neverificat** (și atunci nu îl folosi în cod de producție)
4) Preferă “nu știu / trebuie verificat” în loc de cod inventat.
5) Pentru Docling:
   - Nu folosi opțiuni CLI/Python neconfirmate în docs.
   - Bazează-te pe API-urile verificate: `DocumentConverter`, `export_to_markdown`, `export_to_dict`, `num_pages`, `tables`, `texts`. 

---
6) După orice task care modifică codul, rulează TOATE suitele de teste (unit, integration, e2e + pytest pentru worker). Dacă există orice eșec, revino asupra modificărilor până când toate testele trec cu succes.

## 13) Checklist final (Definition of Done)

- [ ] Upload PDF/DOCX funcționează local
- [ ] Export Markdown + JSON funcționează (SUCCESS)
- [ ] Gates stricte resping (FAILED) și motivele sunt vizibile în UI
- [ ] Timeout kill pentru worker (nu blochează serverul)
- [ ] Unit + integration + e2e rulează “green”
- [ ] Coverage praguri setate și respectate (Node + Python)
- [ ] README scurt cu pașii de instalare (Windows-first)
