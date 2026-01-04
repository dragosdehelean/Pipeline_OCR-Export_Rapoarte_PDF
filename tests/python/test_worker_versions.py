"""Tests for version helpers."""
import builtins
import types

from services.docling_worker import convert


def test_get_docling_version_handles_import_error(monkeypatch):
    original_import = builtins.__import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "docling":
            raise ImportError("docling missing")
        return original_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert convert.get_docling_version() == "UNKNOWN"


def test_get_pymupdf_version_uses_docstring(monkeypatch):
    dummy = types.SimpleNamespace(__doc__="PyMuPDF 2.0.1")
    monkeypatch.setitem(convert.sys.modules, "pymupdf", dummy)
    assert convert.get_pymupdf_version() == "2.0.1"


def test_get_pymupdf4llm_version_prefers_version(monkeypatch):
    dummy = types.SimpleNamespace(version="1.2.3", __version__="9.9.9")
    monkeypatch.setitem(convert.sys.modules, "pymupdf4llm", dummy)
    assert convert.get_pymupdf4llm_version() == "1.2.3"
