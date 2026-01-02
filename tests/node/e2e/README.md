# E2E Test Strategy

Testele E2E sunt organizate pe **3 niveluri de viteză și acoperire** cu nume consistente:

## 🚀 Smoke Tests (~1-2 minute)

Verificări rapide de bază pentru debugging și iterare rapidă.

- `smoke.spec.ts` - Toate smoke tests consolidate:
  - Upload flow de bază nu crashuiește
  - PyMuPDF4LLM upload simplu
  - PyMuPDF4LLM disabled când lipsesc dependențe

**Când să rulezi**: După fiecare modificare de cod, înainte de commit.

```bash
npx playwright test smoke.spec.ts
```

---

## ✅ Standard Tests (~3-4 minute)

Teste balansate pentru CI - acoperire bună fără să fie prea lente.

- `standard.spec.ts` - Toate testele standard consolidate:
  - Upload good/bad PDF → SUCCESS/FAILED
  - Verificare exports (markdown, JSON)
  - Delete document
  - PyMuPDF4LLM one_page_report
  - PyMuPDF4LLM long_report (19 pages)

**Când să rulezi**: În CI pentru fiecare PR, înainte de merge.

```bash
npx playwright test standard.spec.ts
```

---

## 🔬 Comprehensive Tests (~5-10 minute)

Validare completă și detaliată pentru release.

- `comprehensive.spec.ts` - Toate testele comprehensive consolidate:
  - Toate profilurile Docling (default, fast, advanced, legacy)
  - Validare completă UI (clipboard copy, styling, exports)
  - Full upload flow cu toate verificările

**Când să rulezi**: Nightly builds, înainte de release, după bug-uri critice.

```bash
npx playwright test comprehensive.spec.ts
```

---

## 🐍 Python Unit Tests (~30 secunde)

Pentru debugging ultra-rapid fără overhead UI.

- `tests/python/test_pymupdf4llm_long_report.py` - Procesare directă a long_report.pdf fără fallback

---

## Strategie de Rulare

### Local Development
```bash
# Quick feedback loop
npx playwright test smoke.spec.ts

# Before commit
npx playwright test standard.spec.ts
```

### CI Pipeline
```bash
# PR validation (fast)
npx playwright test smoke.spec.ts standard.spec.ts

# Nightly / Release (all tests)
npx playwright test
```

### Debugging
```bash
# Ultra-fast Python test
services/docling_worker/.venv/Scripts/python.exe tests/python/test_pymupdf4llm_long_report.py

# E2E with UI
npx playwright test smoke.spec.ts --headed
```

---

## Performance Metrics

| Test Suite | Duration | Tests | Coverage |
|------------|----------|-------|----------|
| **Smoke** | ~1-2 min | 3 tests | Basic flows (upload, pymupdf4llm) |
| **Standard** | ~3-4 min | 5 tests | Core features (upload, delete, exports, pymupdf4llm) |
| **Comprehensive** | ~5-10 min | 2 tests | Full validation (UI, all profiles) |
| **Python Unit** | ~30 sec | 1 test | PyMuPDF4LLM logic only |

### File Organization

```
tests/node/e2e/
├── smoke.spec.ts           # 🚀 Toate smoke tests (1-2 min)
├── standard.spec.ts        # ✅ Toate standard tests (3-4 min)
├── comprehensive.spec.ts   # 🔬 Toate comprehensive tests (5-10 min)
└── README.md              # 📖 Această documentație
```

**Naming Convention**: Simplu și uniform - câte un fișier per nivel de testare (smoke / standard / comprehensive)

---

## Tips

1. **Paralelizare**: Testele pot rula în paralel cu `--workers=2`
2. **Debugging**: Folosește Python tests pentru iterare rapidă pe logica de procesare
3. **CI**: Rulează doar smoke + standard în PR, comprehensive în nightly
4. **UI**: Folosește `--headed` doar pentru debugging vizual
5. **Simplitate**: 3 fișiere simple - smoke, standard, comprehensive - fără pattern matching necesar
