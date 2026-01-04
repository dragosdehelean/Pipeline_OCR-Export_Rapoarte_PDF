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
        "page_chunks": False,  # Changed to False - single pass for all pages
        "extract_words": True,
        "force_text": True,
        "show_progress": False,
        "margins": 0,
        "table_strategy": "",
        "graphics_limit": 0,
        "ignore_code": False,
    }

    # SINGLE PASS for all pages (matching convert.py implementation)
    print(f"Processing all {total_pages} pages in single pass...", flush=True)
    md_result = pymupdf4llm.to_markdown(doc, **to_markdown_config)
    markdown, chunks = normalize_pymupdf4llm_result(md_result)

    print(f"  Result type: {type(md_result)}", flush=True)
    print(f"  Markdown length: {len(markdown)}", flush=True)

    # When page_chunks=False, pymupdf4llm can return EITHER:
    # - A list of strings (one per page) - THIS IS WHAT WE'RE GETTING!
    # - A single string with page separators
    if isinstance(md_result, list):
        # It's a list! Check what's in it
        print(f"  List length: {len(md_result)}", flush=True)
        if md_result:
            print(f"  First element type: {type(md_result[0])}", flush=True)
            if isinstance(md_result[0], dict):
                print(f"  First element keys: {md_result[0].keys()}", flush=True)

        if md_result and isinstance(md_result[0], str):
            # List of strings - one per page!
            markdown_pages = md_result
            print(f"  List contains {len(md_result)} strings (pages)", flush=True)
        elif md_result and isinstance(md_result[0], dict):
            # List of dicts - extract text from each page
            # Note: page_chunks=False uses 'text' key, page_chunks=True uses 'markdown' key
            print(f"  List contains dicts - extracting text from each page", flush=True)
            markdown_pages = []
            for idx, page_dict in enumerate(md_result):
                page_text = page_dict.get("text") or page_dict.get("markdown") or ""
                markdown_pages.append(page_text)
                if idx < 3:  # Show first 3 pages
                    print(f"    Page {idx + 1}: {len(page_text)} chars", flush=True)
        else:
            # Fallback
            print(f"  Unexpected list content!", flush=True)
            markdown_pages = [markdown]
        pages_text = markdown_pages
    elif isinstance(md_result, str):
        # Single string - try to split by page separator
        separators = ["\n-----\n", "\n---\n", "\n\n-----\n\n", "-----"]
        found_separator = None
        for sep in separators:
            if sep in markdown:
                found_separator = sep
                print(f"  Found separator: {repr(sep)}", flush=True)
                break

        if found_separator:
            markdown_pages = markdown.split(found_separator)
        else:
            print(f"  No separator found - treating as single page", flush=True)
            markdown_pages = [markdown]
        pages_text = markdown_pages
    else:
        markdown_pages = [markdown]
        pages_text = [markdown]

    print(f"  Extracted {len(markdown_pages)} pages", flush=True)

    # PREVIOUS IMPLEMENTATION (per-page loop - commented out):
    # markdown_pages = []
    # pages_text = []
    # page_chunks = []
    # for index in range(total_pages):
    #     print(f"Processing page {index + 1}/{total_pages}...", flush=True)
    #     md_result = pymupdf4llm.to_markdown(doc, pages=[index], **to_markdown_config)
    #     markdown, chunks = normalize_pymupdf4llm_result(md_result)
    #     markdown_pages.append(markdown)
    #     pages_text.append(markdown)
    #     if chunks is not None:
    #         page_chunks.append(chunks)
    #     print(f"  OK Page {index + 1}: {len(markdown)} chars", flush=True)

    # Verify all pages processed
    assert len(markdown_pages) == 19, f"Expected 19 pages, got {len(markdown_pages)}"

    # Verify substantial content extracted
    full_markdown = "\n\n".join(markdown_pages)
    total_chars = len(full_markdown)

    print(f"\n=== Results ===", flush=True)
    print(f"Total pages: {len(markdown_pages)}", flush=True)
    print(f"Total chars: {total_chars}", flush=True)

    # Assertions
    min_expected_chars = total_pages * 600
    assert total_chars > min_expected_chars, (
        f"Expected >{min_expected_chars} chars, got {total_chars}"
    )
    # Note: page_chunks is now False, so we don't have chunk metadata anymore

    # Verify pages 11 and 16 specifically (previously problematic)
    page_11_chars = len(markdown_pages[10])
    page_16_chars = len(markdown_pages[15])

    print(f"Page 11 chars: {page_11_chars}", flush=True)
    print(f"Page 16 chars: {page_16_chars}", flush=True)

    assert page_11_chars > 100, f"Page 11 too short: {page_11_chars} chars"
    assert page_16_chars > 100, f"Page 16 too short: {page_16_chars} chars"

    # Verify tables detected when table extraction is enabled (markdown tables use |)
    if to_markdown_config["table_strategy"]:
        table_pipes = full_markdown.count("|")
        print(f"Table pipe chars: {table_pipes}", flush=True)
        assert table_pipes > 100, f"Expected >100 table pipes, got {table_pipes}"

    print("\n=== All assertions passed! ===", flush=True)


if __name__ == "__main__":
    test_long_report_pymupdf4llm_no_fallback()
