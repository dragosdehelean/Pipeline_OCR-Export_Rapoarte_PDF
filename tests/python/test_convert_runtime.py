"""Runtime tests for docling conversion helpers and CLI flow."""
import json
import sys
import types
from pathlib import Path

import pytest

from services.docling_worker import convert

ROOT_DIR = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT_DIR / "config" / "quality-gates.json"
DOCLING_CONFIG_PATH = ROOT_DIR / "config" / "docling.json"


def load_repo_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_docling_config() -> dict:
    with DOCLING_CONFIG_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _derive_bounds(config: dict) -> dict:
    bounds: dict[str, dict[str, object]] = {}
    for gate in config.get("gates", []):
        if not gate.get("enabled") or gate.get("severity") != "FAIL":
            continue
        metric = gate["metric"]
        op = gate["op"]
        threshold = float(gate["threshold"])
        entry = bounds.setdefault(
            metric,
            {"min": float("-inf"), "max": float("inf"), "not": set()},
        )
        if op == ">":
            entry["min"] = max(entry["min"], threshold + 1)
        elif op == ">=":
            entry["min"] = max(entry["min"], threshold)
        elif op == "<":
            entry["max"] = min(entry["max"], threshold - 1)
        elif op == "<=":
            entry["max"] = min(entry["max"], threshold)
        elif op == "==":
            entry["min"] = max(entry["min"], threshold)
            entry["max"] = min(entry["max"], threshold)
        elif op == "!=":
            entry["not"].add(threshold)
        else:
            raise ValueError(f"Unsupported op: {op}")
    return bounds


def _choose_value(entry: dict) -> float:
    min_val = entry["min"]
    max_val = entry["max"]
    forbidden = entry["not"]
    value = 0 if min_val == float("-inf") else min_val
    if value > max_val:
        raise ValueError("Invalid gate bounds for metric")
    if value in forbidden:
        if value + 1 <= max_val:
            value += 1
        elif value - 1 >= min_val:
            value -= 1
        else:
            raise ValueError("Unable to satisfy gate bounds")
    return value


def required_metrics(config: dict) -> dict:
    bounds = _derive_bounds(config)
    return {metric: _choose_value(entry) for metric, entry in bounds.items()}


def build_text(min_chars: int, min_words: int) -> str:
    words = max(min_words, 1)
    text = " ".join(["word"] * words)
    if len(text) < min_chars:
        text += "x" * (min_chars - len(text))
    return text


def build_markdown(min_chars: int) -> str:
    if min_chars <= 0:
        return "# ok"
    return "M" * min_chars


def test_now_iso_format():
    value = convert.now_iso()
    assert value.endswith("Z")
    assert "T" in value


def test_sha256_file(tmp_path: Path):
    file_path = tmp_path / "sample.txt"
    file_path.write_text("abc", encoding="utf-8")
    digest = convert.sha256_file(str(file_path))
    assert digest == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_export_doc_to_dict_uses_export_to_dict():
    class DummyDoc:
        def export_to_dict(self):
            return {"ok": True}

    assert convert.export_doc_to_dict(DummyDoc()) == {"ok": True}


def test_clamp_tail_limits_bytes():
    long_text = "a" * 2048
    assert convert.clamp_tail(long_text, 0) == ""
    tail = convert.clamp_tail(long_text, 1)
    assert len(tail.encode("utf-8")) <= 1024


def test_build_base_meta(tmp_path: Path):
    file_path = tmp_path / "input.pdf"
    file_path.write_text("fixture", encoding="utf-8")
    config = load_repo_config()
    settings = convert.resolve_docling_settings(load_docling_config())
    meta = convert.build_base_meta("doc-1", str(file_path), config, settings, 0)

    assert meta["id"] == "doc-1"
    assert meta["processing"]["status"] == "PENDING"
    assert meta["outputs"]["markdownPath"] is None
    assert meta["metrics"]["pages"] == 0
    assert meta["source"]["sizeBytes"] == file_path.stat().st_size


def test_write_json(tmp_path: Path):
    file_path = tmp_path / "out.json"
    convert.write_json(str(file_path), {"ok": True})
    loaded = json.loads(file_path.read_text(encoding="utf-8"))
    assert loaded == {"ok": True}


def test_run_conversion_success(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    convert.reset_converter_cache()
    config = load_repo_config()
    required = required_metrics(config)
    pages = int(max(required.get("pages", 1), 1))
    min_chars = int(
        max(
            required.get("textChars", 0),
            required.get("textCharsPerPageAvg", 0) * pages,
            0,
        )
    )
    min_words = int(max(required.get("textItems", 0), 0))
    min_md_chars = int(max(required.get("mdChars", 0), 0))
    tables_required = int(max(required.get("tables", 0), 0))

    text_body = build_text(min_chars, min_words)
    markdown = build_markdown(min_md_chars)
    tables = [object() for _ in range(max(tables_required, 0))]

    class DummyText:
        def __init__(self, text: str):
            self.text = text

    class DummyDocument:
        def __init__(self):
            self.num_pages = pages
            self.texts = [DummyText(text_body)]
            self.tables = tables

        def export_to_markdown(self):
            return markdown

        def export_to_dict(self):
            return {"ok": True}

    class DummyResult:
        def __init__(self):
            self.document = DummyDocument()

    class DummyConverter:
        def convert(self, path: str):
            return DummyResult()
        def __init__(self):
            pass

    monkeypatch.setattr(convert, "get_docling_converter", lambda settings: DummyConverter())

    input_path = tmp_path / "input.pdf"
    input_path.write_text("fixture", encoding="utf-8")

    args = types.SimpleNamespace(
        input=str(input_path),
        doc_id="doc-123",
        data_dir=str(tmp_path),
        gates=str(CONFIG_PATH),
        docling_config=str(DOCLING_CONFIG_PATH),
    )

    exit_code = convert.run_conversion(args)
    assert exit_code == 0

    meta_path = tmp_path / "exports" / "doc-123" / "meta.json"
    assert meta_path.exists()
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["processing"]["status"] == "SUCCESS"
    assert meta["outputs"]["markdownPath"] is not None
    assert meta["outputs"]["jsonPath"] is not None


def test_docling_proof_logging_requested_vs_effective(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    convert.reset_converter_cache()
    config = load_repo_config()
    docling_config = {
        "version": 1,
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
        "preflight": {"pdfText": {"enabled": False}},
        "docling": {"accelerator": {"defaultDevice": "cpu"}},
    }
    docling_path = tmp_path / "docling.json"
    docling_path.write_text(json.dumps(docling_config), encoding="utf-8")

    class DummyDocument:
        def __init__(self):
            self.num_pages = 1
            self.texts = []
            self.tables = []

        def export_to_markdown(self):
            return "# ok"

        def export_to_dict(self):
            return {"ok": True}

    class DummyResult:
        def __init__(self):
            self.document = DummyDocument()

    class DummyConverter:
        def convert(self, path: str):
            return DummyResult()

    monkeypatch.setattr(convert, "get_docling_converter", lambda settings: DummyConverter())

    input_path = tmp_path / "input.pdf"
    input_path.write_text("%PDF-1.4", encoding="utf-8")

    args = types.SimpleNamespace(
        input=str(input_path),
        doc_id="doc-proof",
        data_dir=str(tmp_path),
        gates=str(CONFIG_PATH),
        docling_config=str(docling_path),
    )

    exit_code = convert.run_conversion(args)
    assert exit_code == 0

    meta_path = tmp_path / "exports" / "doc-proof" / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    requested = meta["docling"]["requested"]
    effective = meta["docling"]["effective"]
    fallback = effective.get("fallbackReasons", [])

    assert requested["profile"] == "digital-accurate-nocellmatch"
    assert requested["pdfBackendRequested"] == "dlparse_v4"
    assert requested["tableModeRequested"] == "accurate"
    assert requested["doCellMatchingRequested"] is False
    assert effective["doclingVersion"]
    assert effective["pdfBackendEffective"]
    assert effective["tableModeEffective"]
    assert effective.get("doCellMatchingEffective", None) in (False, None)
    if effective.get("doCellMatchingEffective") is not False:
        assert "DO_CELL_MATCHING_UNSUPPORTED" in fallback


def test_preflight_rejects_scan_like_pdf(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    convert.reset_converter_cache()
    input_path = ROOT_DIR / "tests" / "fixtures" / "docs" / "scan_like_no_text.pdf"

    monkeypatch.setattr(
        convert,
        "get_docling_converter",
        lambda settings: (_ for _ in ()).throw(AssertionError("converter should not run")),
    )

    args = types.SimpleNamespace(
        input=str(input_path),
        doc_id="doc-preflight",
        data_dir=str(tmp_path),
        gates=str(CONFIG_PATH),
        docling_config=str(DOCLING_CONFIG_PATH),
    )

    exit_code = convert.run_conversion(args)
    assert exit_code != 0

    meta_path = tmp_path / "exports" / "doc-preflight" / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["processing"]["status"] == "FAILED"
    assert meta["processing"]["selectedProfile"] == "rejected-no-text"
    assert meta["processing"]["failure"]["code"] == "NO_TEXT_LAYER"
    assert meta["processing"]["preflight"]["passed"] is False


def test_preflight_allows_digital_pdf(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    convert.reset_converter_cache()
    config = load_repo_config()
    required = required_metrics(config)
    pages = int(max(required.get("pages", 1), 1))
    min_chars = int(
        max(
            required.get("textChars", 0),
            required.get("textCharsPerPageAvg", 0) * pages,
            0,
        )
    )
    min_words = int(max(required.get("textItems", 0), 0))
    min_md_chars = int(max(required.get("mdChars", 0), 0))
    tables_required = int(max(required.get("tables", 0), 0))

    text_body = build_text(min_chars, min_words)
    markdown = build_markdown(min_md_chars)
    tables = [object() for _ in range(max(tables_required, 0))]

    class DummyText:
        def __init__(self, text: str):
            self.text = text

    class DummyDocument:
        def __init__(self):
            self.num_pages = pages
            self.texts = [DummyText(text_body)]
            self.tables = tables

        def export_to_markdown(self):
            return markdown

        def export_to_dict(self):
            return {"ok": True}

    class DummyResult:
        def __init__(self):
            self.document = DummyDocument()

    class DummyConverter:
        def convert(self, path: str):
            return DummyResult()

    monkeypatch.setattr(convert, "get_docling_converter", lambda settings: DummyConverter())

    input_path = ROOT_DIR / "tests" / "fixtures" / "docs" / "short_valid_text.pdf"
    args = types.SimpleNamespace(
        input=str(input_path),
        doc_id="doc-digital",
        data_dir=str(tmp_path),
        gates=str(CONFIG_PATH),
        docling_config=str(DOCLING_CONFIG_PATH),
    )

    exit_code = convert.run_conversion(args)
    assert exit_code == 0

    meta_path = tmp_path / "exports" / "doc-digital" / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["processing"]["status"] == "SUCCESS"
    assert meta["processing"]["selectedProfile"] == "digital-balanced"
    assert meta["processing"]["docling"]["doOcr"] is False
    assert meta["processing"]["docling"]["doTableStructure"] is True
    assert meta["processing"]["docling"]["pdfBackend"] == "dlparse_v2"
    assert meta["processing"]["docling"]["tableStructureMode"] == "fast"


def test_run_conversion_fails_max_pages(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    convert.reset_converter_cache()
    config = load_repo_config()
    max_pages = int(config.get("limits", {}).get("maxPages", 1))
    pages = max_pages + 1

    min_chars = int(
        max(
            config.get("quality", {}).get("minTextChars", 0),
            config.get("quality", {}).get("minTextCharsPerPageAvg", 0) * pages,
        )
    )
    min_words = int(max(config.get("quality", {}).get("minTextItems", 0), 0))
    min_md_chars = int(max(config.get("quality", {}).get("minMarkdownChars", 0), 0))

    text_body = build_text(min_chars, min_words)
    markdown = build_markdown(min_md_chars)

    class DummyText:
        def __init__(self, text: str):
            self.text = text

    class DummyDocument:
        def __init__(self):
            self.num_pages = pages
            self.texts = [DummyText(text_body)]
            self.tables = []

        def export_to_markdown(self):
            return markdown

        def export_to_dict(self):
            return {"ok": True}

    class DummyResult:
        def __init__(self):
            self.document = DummyDocument()

    class DummyConverter:
        def convert(self, path: str):
            return DummyResult()

    monkeypatch.setattr(convert, "get_docling_converter", lambda settings: DummyConverter())

    input_path = ROOT_DIR / "tests" / "fixtures" / "docs" / "short_valid_text.pdf"
    args = types.SimpleNamespace(
        input=str(input_path),
        doc_id="doc-max-pages",
        data_dir=str(tmp_path),
        gates=str(CONFIG_PATH),
        docling_config=str(DOCLING_CONFIG_PATH),
    )

    exit_code = convert.run_conversion(args)
    assert exit_code == 0

    meta_path = tmp_path / "exports" / "doc-max-pages" / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["processing"]["status"] == "FAILED"
    assert meta["outputs"]["markdownPath"] is None
    assert any(gate["code"] == "LIMIT_MAX_PAGES" for gate in meta["qualityGates"]["failedGates"])


def test_run_conversion_failure_without_docling(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    convert.reset_converter_cache()
    monkeypatch.setattr(
        convert,
        "get_docling_converter",
        lambda settings: (_ for _ in ()).throw(RuntimeError("docling missing")),
    )

    input_path = tmp_path / "input.pdf"
    input_path.write_text("fixture", encoding="utf-8")

    args = types.SimpleNamespace(
        input=str(input_path),
        doc_id="doc-err",
        data_dir=str(tmp_path),
        gates=str(CONFIG_PATH),
        docling_config=str(DOCLING_CONFIG_PATH),
    )

    exit_code = convert.run_conversion(args)
    assert exit_code == 1

    meta_path = tmp_path / "exports" / "doc-err" / "meta.json"
    assert meta_path.exists()
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["processing"]["status"] == "FAILED"
    assert meta["logs"]["stderrTail"]


def test_converter_cache_reuses_pipeline(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    convert.reset_converter_cache()
    build_calls = 0

    class DummyText:
        def __init__(self, text: str):
            self.text = text

    class DummyDocument:
        def __init__(self):
            self.num_pages = 1
            self.texts = [DummyText("hello world")]
            self.tables = []

        def export_to_markdown(self):
            return "# ok"

        def export_to_dict(self):
            return {"ok": True}

    class DummyResult:
        def __init__(self):
            self.document = DummyDocument()

    class DummyConverter:
        def convert(self, path: str):
            return DummyResult()

    def fake_get_docling_converter(settings):
        nonlocal build_calls
        build_calls += 1
        return DummyConverter()

    monkeypatch.setattr(convert, "get_docling_converter", fake_get_docling_converter)
    monkeypatch.setattr(
        convert,
        "run_pdf_preflight",
        lambda *_: convert.PreflightResult(True, 0, 0, 0),
    )
    monkeypatch.setattr(convert, "evaluate_gates", lambda *_: (True, [], []))

    input_path = tmp_path / "input.pdf"
    input_path.write_text("%PDF-1.4", encoding="utf-8")

    args_base = {
        "input": str(input_path),
        "data_dir": str(tmp_path),
        "gates": str(CONFIG_PATH),
        "docling_config": str(DOCLING_CONFIG_PATH),
    }

    args_first = types.SimpleNamespace(doc_id="doc-cache-1", **args_base)
    args_second = types.SimpleNamespace(doc_id="doc-cache-2", **args_base)

    assert convert.run_conversion(args_first) == 0
    assert convert.run_conversion(args_second) == 0
    assert build_calls == 1
    stats = convert.get_converter_cache_stats()
    assert stats["builds"] == 1


def _write_pymupdf_config(path: Path) -> None:
    payload = {
        "version": 1,
        "defaultEngine": "docling",
        "engines": ["docling", "pymupdf4llm"],
        "pymupdf4llm": {
            "requireLayout": True,
            "toMarkdown": {
                "write_images": False,
                "embed_images": False,
                "dpi": 150,
                "page_chunks": True,
                "extract_words": False,
                "force_text": False,
                "show_progress": False,
                "margins": 0,
                "table_strategy": "lines_strict",
                "graphics_limit": 0,
                "ignore_code": False,
                "extract_tables": True,
            },
        },
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_run_conversion_pymupdf4llm_layout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    config = load_repo_config()
    required = required_metrics(config)
    min_chars = int(max(required.get("textChars", 0), required.get("mdChars", 0)))
    min_words = int(max(required.get("textItems", 0), 1))
    text_body = build_text(min_chars, min_words)

    class DummyPage:
        pass

    class DummyDoc:
        def __init__(self):
            self.page_count = 1

        def close(self):
            return None

    def fake_markdown(doc, pages=None, **kwargs):
        return {"markdown": text_body, "page_chunks": {"page": pages[0]}}

    def fake_json(doc, pages=None):
        return {"page": pages[0], "layout": True}

    dummy_pymupdf = types.SimpleNamespace(
        open=lambda path: DummyDoc(),
        __doc__="PyMuPDF 9.9.9",
    )
    dummy_pymupdf4llm = types.SimpleNamespace(
        to_markdown=fake_markdown,
        to_json=fake_json,
        version="0.2.7",
    )
    dummy_layout = types.SimpleNamespace()
    monkeypatch.setitem(sys.modules, "pymupdf", dummy_pymupdf)
    monkeypatch.setitem(sys.modules, "pymupdf4llm", dummy_pymupdf4llm)
    monkeypatch.setitem(sys.modules, "pymupdf.layout", dummy_layout)

    pymupdf_config_path = tmp_path / "pymupdf.json"
    _write_pymupdf_config(pymupdf_config_path)
    input_path = tmp_path / "input.pdf"
    input_path.write_text("%PDF-1.4", encoding="utf-8")

    args = types.SimpleNamespace(
        input=str(input_path),
        doc_id="doc-pymupdf-llm",
        data_dir=str(tmp_path),
        gates=str(CONFIG_PATH),
        docling_config=str(DOCLING_CONFIG_PATH),
        pymupdf_config=str(pymupdf_config_path),
        engine="pymupdf4llm",
    )
    exit_code = convert.run_conversion(args)
    assert exit_code == 0
    meta_path = tmp_path / "exports" / "doc-pymupdf-llm" / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["processing"]["status"] == "SUCCESS"
    assert meta["engine"]["effective"]["layoutActive"] is True


def test_run_conversion_pymupdf4llm_layout_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    dummy_pymupdf = types.SimpleNamespace(__doc__="PyMuPDF 1.2.3")
    monkeypatch.setitem(sys.modules, "pymupdf", dummy_pymupdf)

    import builtins

    original_import = builtins.__import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "pymupdf.layout":
            raise ModuleNotFoundError("No module named 'pymupdf.layout'")
        return original_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    pymupdf_config_path = tmp_path / "pymupdf.json"
    _write_pymupdf_config(pymupdf_config_path)
    input_path = tmp_path / "input.pdf"
    input_path.write_text("%PDF-1.4", encoding="utf-8")

    args = types.SimpleNamespace(
        input=str(input_path),
        doc_id="doc-pymupdf-layout-missing",
        data_dir=str(tmp_path),
        gates=str(CONFIG_PATH),
        docling_config=str(DOCLING_CONFIG_PATH),
        pymupdf_config=str(pymupdf_config_path),
        engine="pymupdf4llm",
    )
    exit_code = convert.run_conversion(args)
    assert exit_code == 1
    meta_path = tmp_path / "exports" / "doc-pymupdf-layout-missing" / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["processing"]["status"] == "FAILED"
    assert meta["processing"]["failure"]["code"] == "PYMUPDF_LAYOUT_UNAVAILABLE"
    assert (
        meta["processing"]["message"] == "PyMuPDF4LLM layout-only: layout unavailable"
    )
