# PyMuPDF4LLM Table Strategy Analysis

## Overview

PyMuPDF4LLM oferă 4 strategii pentru detecția tabelelor în PDF-uri:
- `lines_strict` (default)
- `lines`
- `text`
- `explicit`

## Test Results - long_report.pdf (19 pages)

### Strategy: `lines_strict`
- **Status**: SUCCESS (cu warnings pentru pagini 11, 16)
- **Text chars**: 31,056
- **MD chars**: 31,304
- **Behavior**: Ignoră rectangle-uri fără border (exclude background colors)
- **Best for**: PDF-uri cu tabele clare, cu gridlines vizibile

### Strategy: `lines`
- **Status**: SUCCESS (cu warnings pentru pagini 11, 16)
- **Text chars**: 31,203
- **MD chars**: 31,451
- **Behavior**: Folosește toate graficele vectoriale pentru detecție
- **Best for**: PDF-uri cu tabele având background colors

### Strategy: `text`
- **Not tested on full document** (cauza fragmentare excesivă pe one_page_report.pdf)
- **Behavior**: Folosește poziționarea textului pentru a crea limite virtuale
- **Best for**: PDF-uri fără gridlines (OCR-ed documents)

## Recommendations

### For Documents with Grid Tables
✅ **Recommended**: `lines` sau `lines_strict`

Ambele strategii oferă rezultate similare (~31k chars), cu diferențe minime:
- `lines`: +147 chars (+0.5%) - mai incluziv, captează mai multe elemente grafice
- `lines_strict`: Mai precis, evită false positives din background colors

### For Gridless Tables
✅ **Recommended**: `text`

Pentru documente OCR sau fără linii de separare vizibile între celule.

### For Mixed Documents
✅ **Recommended**: `lines` (cel mai versatil)

Oferă balanță bună între acuratețe și acoperire.

## Known Issues

### PyMuPDF4LLM Bug on Complex Pages
Anumite pagini complexe (ex: page 11, 16 din long_report.pdf) cauzează excepția:
```
min() iterable argument is empty
```

**Workaround implemented**: Per-page try-catch cu skip pentru paginile problematice.

## Configuration

**Fixed config** ([config/pymupdf.json](../config/pymupdf.json)):
```json
{
  "table_strategy": "lines_strict",
  "force_text": true,
  "page_chunks": false,
  "extract_words": false,
  "graphics_limit": null
}
```

### Why `extract_words: false`?

Setting `extract_words: true` + `graphics_limit: 0` causes PyMuPDF4LLM to:
1. Skip pages with many vector graphics (charts, diagrams)
2. Return only 1 character for pages with 193+ graphics paths
3. Fail on pages 11, 16 of long_report.pdf (which have charts)

**Solution**: Use `extract_words: false` and `graphics_limit: null` to process all pages including those with graphics.

## E2E Test Coverage

✅ `tests/node/e2e/pymupdf4llm.spec.ts`:
- Test: "upload pdf with pymupdf4llm succeeds" (one_page_report.pdf)
- Test: "upload long_report with pymupdf4llm extracts tables" (long_report.pdf)
- Test: "table strategy comparison on long_report" (compară toate strategiile)
