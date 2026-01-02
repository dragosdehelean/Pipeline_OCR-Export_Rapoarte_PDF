"""Quick test for PyMuPDF4LLM processing of long_report.pdf without fallback."""

import json
import sys
from pathlib import Path

import pymupdf
import pymupdf4llm

# Add services to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "services" / "docling_worker"))

from convert import normalize_pymupdf4llm_result


def test_long_report_pymupdf4llm_no_fallback():
    """Test that long_report.pdf processes all 19 pages without fallback."""
    pdf_path = Path(__file__).parent.parent / "fixtures" / "docs" / "long_report.pdf"
    assert pdf_path.exists(), f"PDF not found: {pdf_path}"

    # Open document
    doc = pymupdf.open(str(pdf_path))
    total_pages = doc.page_count
    assert total_pages == 19, f"Expected 19 pages, got {total_pages}"

    # Configuration matching config/pymupdf.json
    to_markdown_config = {
        "write_images": False,
        "embed_images": False,
        "dpi": 150,
        "page_chunks": True,
        "extract_words": True,
        "force_text": True,
        "show_progress": False,
        "margins": 0,
        "table_strategy": "lines_strict",
        "graphics_limit": 0,
        "ignore_code": False,
    }

    markdown_pages = []
    pages_text = []
    page_chunks = []

    # Process each page - NO FALLBACK, should not raise any exceptions
    for index in range(total_pages):
        print(f"Processing page {index + 1}/{total_pages}...", flush=True)

        # This should NOT raise any exception with correct config
        md_result = pymupdf4llm.to_markdown(doc, pages=[index], **to_markdown_config)
        markdown, chunks = normalize_pymupdf4llm_result(md_result)

        markdown_pages.append(markdown)
        pages_text.append(markdown)

        if chunks is not None:
            page_chunks.append(chunks)

        print(f"  OK Page {index + 1}: {len(markdown)} chars", flush=True)

    # Verify all pages processed
    assert len(markdown_pages) == 19, f"Expected 19 pages, got {len(markdown_pages)}"

    # Verify substantial content extracted
    full_markdown = "\n\n".join(markdown_pages)
    total_chars = len(full_markdown)

    print(f"\n=== Results ===", flush=True)
    print(f"Total pages: {len(markdown_pages)}", flush=True)
    print(f"Total chars: {total_chars}", flush=True)
    print(f"Page chunks: {len(page_chunks)}", flush=True)

    # Assertions
    assert total_chars > 35000, f"Expected >35k chars, got {total_chars}"
    assert len(page_chunks) == 19, f"Expected 19 page chunks, got {len(page_chunks)}"

    # Verify pages 11 and 16 specifically (previously problematic)
    page_11_chars = len(markdown_pages[10])
    page_16_chars = len(markdown_pages[15])

    print(f"Page 11 chars: {page_11_chars}", flush=True)
    print(f"Page 16 chars: {page_16_chars}", flush=True)

    assert page_11_chars > 100, f"Page 11 too short: {page_11_chars} chars"
    assert page_16_chars > 100, f"Page 16 too short: {page_16_chars} chars"

    # Verify tables detected (markdown tables use |)
    table_pipes = full_markdown.count("|")
    print(f"Table pipe chars: {table_pipes}", flush=True)
    assert table_pipes > 100, f"Expected >100 table pipes, got {table_pipes}"

    print("\n=== All assertions passed! ===", flush=True)


if __name__ == "__main__":
    test_long_report_pymupdf4llm_no_fallback()
