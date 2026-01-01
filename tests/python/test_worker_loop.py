"""Tests for the keep-warm worker loop."""
import io
import json
import sys
from pathlib import Path

from services.docling_worker import convert


def test_run_worker_loop_processes_job(tmp_path: Path, monkeypatch):
    input_path = tmp_path / "input.pdf"
    input_path.write_text("%PDF-1.4", encoding="utf-8")

    def fake_run_conversion(args, job_id=None, python_startup_ms=None):
        return 0

    monkeypatch.setattr(convert, "run_conversion", fake_run_conversion)
    monkeypatch.setattr(convert, "prewarm_converter_cache", lambda *_: None)
    message = {
        "type": "job",
        "jobId": "job-1",
        "docId": "doc-1",
        "input": str(input_path),
        "dataDir": str(tmp_path),
        "gates": str(Path("config/quality-gates.json")),
        "doclingConfig": str(Path("config/docling.json")),
    }
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(message) + "\n"))

    exit_code = convert.run_worker_loop()
    assert exit_code == 0
