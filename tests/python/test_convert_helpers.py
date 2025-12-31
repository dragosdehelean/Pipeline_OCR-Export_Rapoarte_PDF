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


def test_resolve_accelerator_device_passthrough():
    assert convert.resolve_accelerator_device("cpu") == "cpu"


def test_resolve_requested_accelerator_env_override(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DOCLING_DEVICE", "cuda")
    config = {"docling": {"accelerator": "auto"}}
    assert convert.resolve_requested_accelerator(config) == "cuda"


def test_resolve_accelerator_device_auto_cuda(monkeypatch: pytest.MonkeyPatch):
    class DummyCuda:
        @staticmethod
        def is_available():
            return True

    class DummyBackends:
        pass

    dummy_torch = types.SimpleNamespace(cuda=DummyCuda(), backends=DummyBackends())
    monkeypatch.setitem(sys.modules, "torch", dummy_torch)
    assert convert.resolve_accelerator_device("auto") == "cuda"


def test_resolve_accelerator_device_auto_mps(monkeypatch: pytest.MonkeyPatch):
    class DummyCuda:
        @staticmethod
        def is_available():
            return False

    class DummyMps:
        @staticmethod
        def is_available():
            return True

    class DummyBackends:
        mps = DummyMps()

    dummy_torch = types.SimpleNamespace(cuda=DummyCuda(), backends=DummyBackends())
    monkeypatch.setitem(sys.modules, "torch", dummy_torch)
    assert convert.resolve_accelerator_device("auto") == "mps"


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
        "docling": {"accelerator": "cpu"},
    }
    settings = convert.resolve_docling_settings(config)
    assert settings.profile == "digital-balanced"
    assert settings.pdf_backend == "dlparse_v2"
    assert settings.do_ocr is False
    assert settings.do_table_structure is True
    assert settings.table_structure_mode == "fast"
    assert settings.document_timeout_sec == 123
    assert settings.accelerator == "cpu"


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
        accelerator="cpu",
    )
    converter = convert.get_docling_converter(settings)
    assert isinstance(converter, DocumentConverter)
    assert InputFormat.PDF in converter.format_options
    assert converter.format_options[InputFormat.PDF].backend is DummyBackend
