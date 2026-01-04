"""Tests for PyMuPDF4LLM normalization helpers."""
import pytest

from services.docling_worker.convert import (
    ConfigValidationError,
    normalize_pymupdf4llm_result,
    validate_pymupdf4llm_markdown_config,
)


def test_normalize_pymupdf4llm_result_string():
    markdown, chunks = normalize_pymupdf4llm_result("hello")
    assert markdown == "hello"
    assert chunks is None


def test_normalize_pymupdf4llm_result_tuple():
    markdown, chunks = normalize_pymupdf4llm_result(("md", {"page": 1}))
    assert markdown == "md"
    assert chunks == {"page": 1}


def test_normalize_pymupdf4llm_result_list_of_dicts():
    result = [{"text": "alpha"}, {"markdown": "beta"}]
    markdown, chunks = normalize_pymupdf4llm_result(result)
    assert markdown == "alpha\n\nbeta"
    assert chunks == result


def test_normalize_pymupdf4llm_result_dict():
    result = {"md": "gamma", "page_chunks": [{"page": 2}]}
    markdown, chunks = normalize_pymupdf4llm_result(result)
    assert markdown == "gamma"
    assert chunks == [{"page": 2}]


def test_validate_pymupdf4llm_markdown_config_none():
    assert validate_pymupdf4llm_markdown_config(None) == {}


def test_validate_pymupdf4llm_markdown_config_invalid_type():
    with pytest.raises(ConfigValidationError):
        validate_pymupdf4llm_markdown_config(["not", "a", "dict"])


def test_validate_pymupdf4llm_markdown_config_unknown_keys():
    with pytest.raises(ConfigValidationError):
        validate_pymupdf4llm_markdown_config({"unknown_key": True})
