"""Tests for worker emit helpers."""
import json

from services.docling_worker.convert import (
    AcceleratorSelection,
    DoclingSettings,
    emit_progress,
    emit_ready,
    emit_result,
)


def test_emit_ready_includes_prewarm(capsys):
    accelerator = AcceleratorSelection(
        requested_device="auto",
        effective_device="cpu",
        cuda_available=False,
        reason="forced-cpu",
    )
    settings = DoclingSettings(
        profile="digital-balanced",
        pdf_backend="dlparse_v2",
        do_ocr=False,
        do_table_structure=True,
        table_structure_mode="fast",
        document_timeout_sec=30,
        accelerator=accelerator,
    )
    emit_ready(120, settings)

    payload = json.loads(capsys.readouterr().out.strip())
    assert payload["event"] == "ready"
    assert payload["pythonStartupMs"] == 120
    assert payload["prewarm"]["reason"] == "forced-cpu"


def test_emit_progress_with_job_id(capsys):
    emit_progress("INIT", "Starting", 5, job_id="doc-123")
    payload = json.loads(capsys.readouterr().out.strip())
    assert payload["event"] == "progress"
    assert payload["jobId"] == "doc-123"


def test_emit_result_payload(capsys):
    emit_result("doc-123", 0, "meta.json")
    payload = json.loads(capsys.readouterr().out.strip())
    assert payload["event"] == "result"
    assert payload["exitCode"] == 0
