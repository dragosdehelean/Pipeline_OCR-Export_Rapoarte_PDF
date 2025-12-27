# AGENTS.md — Doc Ingestion & Export (Docling-only)

Acest repo implementează un pipeline **local-first** pentru ingestie documente (PDF/DOCX) și export în **Markdown + JSON**, ca pas înainte de RAG. Constrângerile și pragurile sunt intenționat **config-driven** (fără hardcodări în cod sau în acest fișier).

## Obiectiv verificabil (Definition of Done)
Pe `localhost`, pot:
- încărca un PDF/DOCX,
- vedea **SUCCESS** cu `output.md` + `output.json` + `meta.json`,
- sau **FAILED** cu motive (quality gates) + `meta.json` util pentru debug.

## Principii care previn blocaje la scalare
- **O singură sursă de adevăr pentru praguri/limite:** `config/quality-gates.json`. Nu duplica gate-uri / praguri în cod, în env sau în doc.
- **Dovadă obiectivă înainte de final:** rulează testele relevante și repară până sunt verzi.

## Arhitectură (overview)
- **Next.js (App Router)**: UI + Route Handlers (orchestrare, upload, spawn worker, serve artifacts).
- **Python worker (Docling)**: conversie, metrici, evaluare gates, scriere artefacte.

Boundary-ul este intenționat clar: **Node orchestration** → **Python processing**.

## Artefacte pe document
Pentru fiecare document cu `id` (folder `data/exports/<id>/` sau echivalentul din `DATA_DIR`):
- La **SUCCESS**: `output.md`, `output.json`, `meta.json`
- La **FAILED**: doar `meta.json` (iar `outputs.*Path = null`)

`meta.json` se scrie **întotdeauna** și este sursa pentru UI (status, metrici, motive, logs tail).

## Quality gates
- Citește și aplică gates **exclusiv** din `config/quality-gates.json`.
- Nu hardcoda praguri/limite în:
  - worker,
  - route handlers,
  - UI.

UI trebuie să afișeze **ce a spus config-ul** (cod + mesaj + actual vs expected) pe baza `meta.json`.

## Setup local (minim)
1) Creează `.env.local` din `.env.local.example` (în root).
2) Setează cel puțin:
   - `DATA_DIR`
   - `GATES_CONFIG_PATH` (către `config/quality-gates.json`)
   - `PYTHON_BIN`
   - `DOCLING_WORKER` (entrypoint către worker)

`GET /api/health` trebuie să expună rapid dacă setup-ul e incomplet, iar UI să blocheze upload până la `ok=true`.

## Comenzi (folosește scripturile repo-ului)
Node:
- Dev: `npm run dev`
- Lint: `npm run lint`
- Teste: `npm run test`
- E2E: `npm run test:e2e` (dacă există)

Python (worker):
- Instalează deps: vezi `services/docling_worker/requirements.txt`
- Teste: `python -m pytest -q`

Dacă un script lipsește, **adaugă-l** (nu inventa comenzi alternative fără să le pui în `package.json`).

## Testare: când și ce scrii
- **Unit**: funcții pure, validări, mapări, helpers.
- **Integration**: API + filesystem + spawn orchestration (fără browser).
- **E2E**: user journeys critice (upload → status → detalii/preview; plus un “critical negative path” determinist).

Fixtures pentru teste:
- Folosește documente **valide și deterministe** (inclusiv “valid dar respins de gates”). Evită fișiere corupte ca negative-path principal.

## Reguli anti-halucinație (pentru modificări)
- Nu introduce API-uri/opțiuni neconfirmate: verifică în docs oficiale înainte să le pui în cod.
- Dacă schimbi contracte (`meta.json`, API responses), actualizează testele de contract și UI în același PR.

## Obligatoriu la finalul oricărui task care modifică cod
Rulează TOATE suitele relevante (unit + integration + e2e + pytest pentru worker). Dacă ceva eșuează, repară până sunt verzi.