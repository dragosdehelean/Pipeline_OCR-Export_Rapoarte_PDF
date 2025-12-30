import json
import sys
import types
from pathlib import Path

import pytest

from services.docling_worker import convert

ROOT_DIR = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT_DIR / "config" / "quality-gates.json"


def load_repo_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as handle:
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
    meta = convert.build_base_meta("doc-1", str(file_path), config)

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

    dummy_docling = types.ModuleType("docling")
    dummy_converter = types.ModuleType("docling.document_converter")
    dummy_converter.DocumentConverter = DummyConverter
    monkeypatch.setitem(sys.modules, "docling", dummy_docling)
    monkeypatch.setitem(sys.modules, "docling.document_converter", dummy_converter)

    input_path = tmp_path / "input.pdf"
    input_path.write_text("fixture", encoding="utf-8")

    args = types.SimpleNamespace(
        input=str(input_path),
        doc_id="doc-123",
        data_dir=str(tmp_path),
        gates=str(CONFIG_PATH),
    )

    exit_code = convert.run_conversion(args)
    assert exit_code == 0

    meta_path = tmp_path / "exports" / "doc-123" / "meta.json"
    assert meta_path.exists()
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["processing"]["status"] == "SUCCESS"
    assert meta["outputs"]["markdownPath"] is not None
    assert meta["outputs"]["jsonPath"] is not None


def test_run_conversion_failure_without_docling(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delitem(sys.modules, "docling", raising=False)
    monkeypatch.delitem(sys.modules, "docling.document_converter", raising=False)

    input_path = tmp_path / "input.pdf"
    input_path.write_text("fixture", encoding="utf-8")

    args = types.SimpleNamespace(
        input=str(input_path),
        doc_id="doc-err",
        data_dir=str(tmp_path),
        gates=str(CONFIG_PATH),
    )

    exit_code = convert.run_conversion(args)
    assert exit_code == 1

    meta_path = tmp_path / "exports" / "doc-err" / "meta.json"
    assert meta_path.exists()
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["processing"]["status"] == "FAILED"
    assert meta["logs"]["stderrTail"]
