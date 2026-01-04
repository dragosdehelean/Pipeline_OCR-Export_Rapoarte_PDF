# Engine Comparison: PyMuPDF4LLM vs Docling

## Test Document: `long_report.pdf` (19 pages)

### Results Summary

| Metric | PyMuPDF4LLM (lines_strict) | Docling (dlparse_v2) | Docling (pypdfium) |
|--------|---------------------------|---------------------|-------------------|
| **Status** | SUCCESS (2 pages failed) | SUCCESS | SUCCESS |
| **Pages** | 19 | 19 | 19 |
| **Text Chars** | 31,056 | 35,160 | ~35,000 |
| **MD Chars** | 31,304 | 80,831 | ~80,000 |
| **Tables Detected** | N/A | 16 | 16 |
| **Processing Time** | ~15s | ~45s | ~45s |

### Critical Issue: Character Spacing in Docling

**Problem**: Docling (both backends) inserts **spaces between every character** in table cells.

#### Example from Page 2 Table

**❌ Docling Output (INCORRECT)**:
```
C I F R A  D E  A F A C E R I  N E T  Ă  1  58  .  0  6  5  .  85  6
I n d i  c  a  t  ori  3  0/0  9  /2025
```

**✅ PyMuPDF4LLM Output (CORRECT)**:
```
CIFRA DE AFACERI NETĂ 158.065.856
Indicatori 30/09/2025
```

### Root Cause Analysis

The PDF uses **character-level positioning** (kerning/tracking applied per character).

- **PyMuPDF4LLM**: Correctly reconstructs words by analyzing character proximity
- **Docling**: Treats each positioned character as separate, inserting spaces

This is a **known issue** with Docling when processing PDFs that use:
- Individual character positioning
- Custom kerning/tracking
- Justified text with character-level spacing

### Docling Backend Comparison

Tested backends for character spacing issue:
1. **dlparse_v2**: Character spacing problem present ❌
2. **pypdfium**: Character spacing problem present ❌
3. **dlparse_v4**: Not tested (known memory issues)

**Conclusion**: The issue is **NOT backend-specific** - it's how Docling's text extraction pipeline handles character-positioned PDFs.

### PyMuPDF4LLM Limitations

While PyMuPDF4LLM handles character spacing correctly, it has:

1. **Bug on complex pages**: Pages 11 & 16 fail with `min() iterable argument is empty`
   - **Workaround**: Per-page error handling implemented

2. **Limited table detection**: Only 2 strategies work for gridded tables:
   - `lines_strict`: Best for tables with clear gridlines
   - `lines`: More inclusive, captures background elements

3. **Gridless table issues**: `text` strategy fragments tables incorrectly

### Recommendations

#### For Documents with Individual Character Positioning
✅ **Use PyMuPDF4LLM** with `table_strategy: "lines_strict"` or `"lines"`

**Pros**:
- Correct character spacing in all text
- Faster processing (~3x faster than Docling)
- Lower memory usage

**Cons**:
- May fail on certain complex pages (needs error handling)
- Fewer tables detected (only gridded tables)

#### For Documents with Standard PDF Text Rendering
✅ **Use Docling** with `pdfBackend: "dlparse_v2"`

**Pros**:
- Superior table detection (16 tables vs unknown in PyMuPDF4LLM)
- AI-based structure recognition
- Handles complex layouts better

**Cons**:
- Character spacing issues on kerned PDFs
- Slower processing
- Higher memory usage

### Test Results Details

#### PyMuPDF4LLM (Strategy: lines_strict)
```
Status: SUCCESS
Pages: 19
Failed pages: 11, 16 (gracefully handled)
Text chars: 31,056
MD chars: 31,304
Sample table output:
  |Indicatori|30/09/2025|30/09/2024|∆%|
  |CIFRA DE AFACERI NETĂ|158.065.856<br>RON|126.792.531<br>RON|24,66%|
```

#### Docling (Backend: dlparse_v2)
```
Status: SUCCESS
Pages: 19
Text chars: 35,160
MD chars: 80,831
Tables: 16
Sample table output:
  | I n d i  c  a  t  ori | 3  0/0  9  /2025 | 3  0/0  9  /2024 | ∆% |
  | C I F R A  D E  A F A C E R I  N E T  Ă | 1  58  .  0  6  5  .  85  6 | ... |
```

### Final Recommendation

**For `long_report.pdf` and similar documents**:

Use **PyMuPDF4LLM** as the default engine because:
1. Text readability is **critical** - character spacing makes Docling output unusable
2. The document appears to have gridded tables that PyMuPDF4LLM handles well
3. Processing speed is significantly better
4. Error handling for problematic pages is implemented

**Consider Docling only if**:
- The PDF uses standard text rendering (no individual character positioning)
- You need advanced table structure detection
- You're willing to post-process output to remove extra spaces

### References

- [Docling Table Cell Parsing Issue](https://github.com/docling-project/docling-parse/issues/167)
- [Docling Parse v4 Memory Issues](https://github.com/docling-project/docling/issues/2077)
- [LaTeX Formula Spacing Bug](https://github.com/docling-project/docling/issues/2374)
- [PyMuPDF Table Strategies](https://github.com/pymupdf/PyMuPDF/blob/main/src/table.py)

## Next Steps

1. ✅ Implement per-page error handling for PyMuPDF4LLM
2. ✅ Add comparison tests for both engines
3. ⏳ Report character spacing issue to Docling project
4. ⏳ Investigate post-processing to remove extra spaces from Docling output
