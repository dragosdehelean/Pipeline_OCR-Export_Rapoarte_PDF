"""Tests for docling worker conversion helpers."""
import sys
import types
from pathlib import Path

import pytest

from services.docling_worker import convert
from services.docling_worker.convert import compute_metrics, export_doc_to_dict


class DummyText:
    def __init__(self, text):
        self.text = text


class DummyDoc:
    def __init__(self):
        self.num_pages = 2
        self.texts = [DummyText("abc"), DummyText("defg")]
        self.tables = [object()]


class DummyDump:
    def model_dump(self):
        return {"ok": True}


def test_compute_metrics():
    doc = DummyDoc()
    metrics = compute_metrics(doc, "markdown")
    assert metrics["pages"] == 2
    assert metrics["textChars"] == 7
    assert metrics["mdChars"] == 8
    assert metrics["textItems"] == 2
    assert metrics["tables"] == 1
    assert metrics["textCharsPerPageAvg"] == 3.5


def test_export_doc_to_dict_fallback():
    doc = DummyDump()
    data = export_doc_to_dict(doc)
    assert data == {"ok": True}


class DummyDictDoc:
    def dict(self):
        return {"fallback": True}


def test_export_doc_to_dict_dict_fallback():
    assert export_doc_to_dict(DummyDictDoc()) == {"fallback": True}


class DummyCallableDoc:
    def num_pages(self):
        return 3

    def texts(self):
        return [DummyText("hello"), DummyText("world")]

    def tables(self):
        return []


def test_compute_metrics_supports_callable_fields():
    doc = DummyCallableDoc()
    metrics = compute_metrics(doc, "markdown")
    assert metrics["pages"] == 3
    assert metrics["textChars"] == 10
    assert metrics["textItems"] == 2


def test_export_doc_to_dict_missing_hooks_raises():
    class NoExport:
        pass

    with pytest.raises(RuntimeError):
        export_doc_to_dict(NoExport())


def test_build_pymupdf_meta_sets_mime_type(tmp_path: Path):
    file_path = tmp_path / "input.pdf"
    file_path.write_text("%PDF-1.4", encoding="utf-8")
    config = {"limits": {"processTimeoutSec": 1}, "version": 1, "strict": True}
    engine_meta = {"requested": {"name": "pymupdf4llm"}, "effective": {"name": "pymupdf4llm"}}
    meta = convert.build_pymupdf_meta("doc-1", str(file_path), config, 0, engine_meta)
    assert meta["source"]["mimeType"] == "application/pdf"


def test_compute_metrics_uses_pages_attribute():
    class PagesDoc:
        def __init__(self):
            self.pages = [object(), object(), object()]
            self.texts = []
            self.tables = []

    metrics = compute_metrics(PagesDoc(), "")
    assert metrics["pages"] == 3


def test_resolve_table_structure_mode_defaults():
    assert convert.resolve_table_structure_mode("fast") == "fast"
    assert convert.resolve_table_structure_mode("accurate") == "accurate"
    assert convert.resolve_table_structure_mode("unknown") == "fast"


def test_resolve_requested_device_override():
    config = {"docling": {"accelerator": {"defaultDevice": "auto"}}}
    assert convert.resolve_requested_device(config, device_override="cpu") == "cpu"


def test_select_accelerator_auto_cuda(monkeypatch: pytest.MonkeyPatch):
    class DummyCuda:
        @staticmethod
        def is_available():
            return True

    dummy_torch = types.SimpleNamespace(cuda=DummyCuda(), version=types.SimpleNamespace(cuda="12.8"))
    monkeypatch.setitem(sys.modules, "torch", dummy_torch)
    selection = convert.select_accelerator("auto")
    assert selection.effective_device == "cuda"
    assert selection.cuda_available is True


def test_select_accelerator_cuda_fallback(monkeypatch: pytest.MonkeyPatch):
    class DummyCuda:
        @staticmethod
        def is_available():
            return False

    dummy_torch = types.SimpleNamespace(cuda=DummyCuda(), version=types.SimpleNamespace(cuda="12.8"))
    monkeypatch.setitem(sys.modules, "torch", dummy_torch)
    selection = convert.select_accelerator("cuda")
    assert selection.effective_device == "cpu"
    assert selection.reason == "CUDA_NOT_AVAILABLE"


def test_resolve_docling_settings_from_config():
    config = {
        "defaultProfile": "digital-balanced",
        "profiles": {
            "digital-balanced": {
                "pdfBackend": "dlparse_v2",
                "doOcr": False,
                "doTableStructure": True,
                "tableStructureMode": "fast",
                "documentTimeoutSec": 123,
            }
        },
        "docling": {"accelerator": {"defaultDevice": "cpu"}},
    }
    settings = convert.resolve_docling_settings(config)
    assert settings.profile == "digital-balanced"
    assert settings.pdf_backend == "dlparse_v2"
    assert settings.do_ocr is False
    assert settings.do_table_structure is True
    assert settings.table_structure_mode == "fast"
    assert settings.document_timeout_sec == 123
    assert settings.accelerator.requested_device == "cpu"
    assert settings.do_cell_matching is None


def test_resolve_docling_settings_cell_matching_override():
    config = {
        "defaultProfile": "digital-accurate-nocellmatch",
        "profiles": {
            "digital-accurate-nocellmatch": {
                "pdfBackend": "dlparse_v4",
                "doOcr": False,
                "doTableStructure": True,
                "doCellMatching": False,
                "tableStructureMode": "accurate",
                "documentTimeoutSec": 120,
            }
        },
        "docling": {"accelerator": {"defaultDevice": "cpu"}},
    }
    settings = convert.resolve_docling_settings(config)
    assert settings.profile == "digital-accurate-nocellmatch"
    assert settings.do_cell_matching is False


def test_build_converter_cache_key_uses_effective_device():
    settings_cpu = convert.DoclingSettings(
        profile="digital-fast",
        pdf_backend="dlparse_v2",
        do_ocr=False,
        do_table_structure=False,
        table_structure_mode="fast",
        document_timeout_sec=0,
        accelerator=convert.AcceleratorSelection(
            requested_device="auto",
            effective_device="cpu",
            cuda_available=False,
        ),
    )
    settings_cuda = convert.DoclingSettings(
        profile="digital-fast",
        pdf_backend="dlparse_v2",
        do_ocr=False,
        do_table_structure=False,
        table_structure_mode="fast",
        document_timeout_sec=0,
        accelerator=convert.AcceleratorSelection(
            requested_device="auto",
            effective_device="cuda",
            cuda_available=True,
        ),
    )
    assert convert.build_converter_cache_key(settings_cpu) != convert.build_converter_cache_key(
        settings_cuda
    )


def test_load_docling_config_uses_legacy_keys(tmp_path: Path):
    legacy_config = {
        "docling": {
            "profile": "legacy-profile",
            "pdfBackend": "dlparse_v2",
            "doOcr": False,
            "doTableStructure": False,
            "tableStructureMode": "fast",
            "documentTimeoutSec": 12,
            "accelerator": "cpu",
        },
        "preflight": {"pdfText": {"enabled": True, "samplePages": 1}},
    }
    missing_path = tmp_path / "missing.json"
    loaded = convert.load_docling_config(str(missing_path), legacy_config)
    assert loaded["defaultProfile"] == "legacy-profile"
    assert loaded["profiles"]["legacy-profile"]["documentTimeoutSec"] == 12


def test_resolve_profile_config_raises_on_missing_profile():
    with pytest.raises(ValueError):
        convert.resolve_profile_config({"defaultProfile": "missing", "profiles": {}})


def test_resolve_pdf_backend_class_unknown():
    with pytest.raises(ValueError):
        convert.resolve_pdf_backend_class("unknown")


def test_resolve_pdf_backend_class_and_converter(monkeypatch: pytest.MonkeyPatch):
    docling_mod = types.ModuleType("docling")
    backend_pkg = types.ModuleType("docling.backend")
    datamodel_pkg = types.ModuleType("docling.datamodel")

    class DummyBackend:
        pass

    backend_mod = types.ModuleType("docling.backend.docling_parse_v2_backend")
    backend_mod.DoclingParseV2DocumentBackend = DummyBackend

    accel_mod = types.ModuleType("docling.datamodel.accelerator_options")

    class AcceleratorOptions:
        def __init__(self, device):
            self.device = device

    accel_mod.AcceleratorOptions = AcceleratorOptions

    base_models_mod = types.ModuleType("docling.datamodel.base_models")

    class InputFormat:
        PDF = "pdf"

    base_models_mod.InputFormat = InputFormat

    pipeline_mod = types.ModuleType("docling.datamodel.pipeline_options")

    class TableFormerMode:
        FAST = "fast"
        ACCURATE = "accurate"

    class TableStructureOptions:
        def __init__(self, mode):
            self.mode = mode

    class PdfPipelineOptions:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    pipeline_mod.TableFormerMode = TableFormerMode
    pipeline_mod.TableStructureOptions = TableStructureOptions
    pipeline_mod.PdfPipelineOptions = PdfPipelineOptions

    converter_mod = types.ModuleType("docling.document_converter")

    class PdfFormatOption:
        def __init__(self, pipeline_options, backend):
            self.pipeline_options = pipeline_options
            self.backend = backend

    class DocumentConverter:
        def __init__(self, format_options):
            self.format_options = format_options

    converter_mod.PdfFormatOption = PdfFormatOption
    converter_mod.DocumentConverter = DocumentConverter

    monkeypatch.setitem(sys.modules, "docling", docling_mod)
    monkeypatch.setitem(sys.modules, "docling.backend", backend_pkg)
    monkeypatch.setitem(sys.modules, "docling.backend.docling_parse_v2_backend", backend_mod)
    monkeypatch.setitem(sys.modules, "docling.datamodel", datamodel_pkg)
    monkeypatch.setitem(sys.modules, "docling.datamodel.accelerator_options", accel_mod)
    monkeypatch.setitem(sys.modules, "docling.datamodel.base_models", base_models_mod)
    monkeypatch.setitem(sys.modules, "docling.datamodel.pipeline_options", pipeline_mod)
    monkeypatch.setitem(sys.modules, "docling.document_converter", converter_mod)

    backend = convert.resolve_pdf_backend_class("dlparse_v2")
    assert backend is DummyBackend

    settings = convert.DoclingSettings(
        profile="digital-fast",
        pdf_backend="dlparse_v2",
        do_ocr=False,
        do_table_structure=False,
        table_structure_mode="fast",
        document_timeout_sec=0,
        accelerator=convert.AcceleratorSelection(
            requested_device="cpu",
            effective_device="cpu",
            cuda_available=False,
        ),
    )
    converter = convert.get_docling_converter(settings)
    assert isinstance(converter, DocumentConverter)
    assert InputFormat.PDF in converter.format_options
    assert converter.format_options[InputFormat.PDF].backend is DummyBackend


def test_normalize_engine_defaults():
    assert convert.normalize_engine(None) == "docling"
    assert convert.normalize_engine("pymupdf4llm") == "pymupdf4llm"
    assert convert.normalize_engine("unknown") == "docling"


def test_get_pymupdf_version_parses_doc(monkeypatch: pytest.MonkeyPatch):
    dummy = types.SimpleNamespace(__doc__="PyMuPDF 2.0.1: test")
    monkeypatch.setitem(sys.modules, "pymupdf", dummy)
    assert convert.get_pymupdf_version() == "2.0.1"


def test_normalize_pymupdf4llm_result_tuple():
    markdown, chunks = convert.normalize_pymupdf4llm_result(("md", {"ok": True}))
    assert markdown == "md"
    assert chunks == {"ok": True}


def test_get_pymupdf4llm_version(monkeypatch: pytest.MonkeyPatch):
    dummy = types.SimpleNamespace(version="0.1.0")
    monkeypatch.setitem(sys.modules, "pymupdf4llm", dummy)
    assert convert.get_pymupdf4llm_version() == "0.1.0"


def test_get_pymupdf_version_falls_back_to_dunder(monkeypatch: pytest.MonkeyPatch):
    dummy = types.SimpleNamespace(__doc__="no match", __version__="3.1.4")
    monkeypatch.setitem(sys.modules, "pymupdf", dummy)
    assert convert.get_pymupdf_version() == "3.1.4"


def test_check_module_available_missing():
    ok, reason = convert.check_module_available("missing_module_for_test")
    assert ok is False
    assert reason == "IMPORT_MISSING_MODULE_FOR_TEST_FAILED"


def test_get_pymupdf_capabilities_shapes():
    caps = convert.get_pymupdf_capabilities()
    assert "pymupdf4llm" in caps


def test_normalize_pymupdf4llm_result_dict():
    markdown, chunks = convert.normalize_pymupdf4llm_result(
        {"markdown": "md", "page_chunks": {"page": 1}}
    )
    assert markdown == "md"
    assert chunks == {"page": 1}
