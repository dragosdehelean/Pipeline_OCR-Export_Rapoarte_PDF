"""Fixture worker that simulates Docling conversion for tests."""
import argparse
import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

sys.path.append(os.getcwd())

from services.docling_worker.gates import evaluate_gates, load_config

LAST_JOB_PROOF: dict | None = None


def now_iso():
    """Returns current UTC time as ISO-8601 with Z suffix."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_docling_config(docling_path: str | None, _gates_config: dict) -> dict:
    """Loads docling config with a fallback for tests."""
    resolved_path = docling_path or os.getenv("DOCLING_CONFIG_PATH")
    if not resolved_path:
        resolved_path = os.path.join(os.getcwd(), "config", "docling.json")
    path = Path(resolved_path)
    if path.exists():
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    return {
        "version": 1,
        "defaultProfile": "digital-balanced",
        "profiles": {
            "digital-balanced": {
                "pdfBackend": "dlparse_v2",
                "doOcr": False,
                "doTableStructure": True,
                "tableStructureMode": "fast",
                "documentTimeoutSec": 240,
            }
        },
        "docling": {"accelerator": {"defaultDevice": "auto"}},
        "preflight": {},
    }


def resolve_default_device(docling_config: dict) -> str:
    """Resolves the configured default accelerator device."""
    docling_section = docling_config.get("docling", {})
    if isinstance(docling_section, dict):
        accelerator = docling_section.get("accelerator")
        if isinstance(accelerator, dict):
            value = accelerator.get("defaultDevice", "auto")
        else:
            value = accelerator
    else:
        value = "auto"
    return str(value or "auto").strip().lower()


def emit_event(payload: dict) -> None:
    """Prints JSON events for the Node app."""
    print(json.dumps(payload), flush=True)


def emit_progress(stage: str, message: str, progress: int, job_id: str | None = None) -> None:
    """Prints progress events that the Node app can parse."""
    payload = {
        "event": "progress",
        "stage": stage,
        "message": message,
        "progress": progress,
    }
    if job_id:
        payload["jobId"] = job_id
    emit_event(payload)


def derive_bounds(config: dict) -> dict:
    """Derives numeric bounds per metric from gate config."""
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


def choose_value(entry: dict) -> float:
    """Chooses a value within bounds that avoids forbidden thresholds."""
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


def build_pass_metrics(config: dict) -> dict:
    """Builds a metrics dict that passes all FAIL gates."""
    bounds = derive_bounds(config)
    return {metric: choose_value(entry) for metric, entry in bounds.items()}


def value_to_fail(op: str, threshold: float) -> float:
    """Returns a value that intentionally fails a single gate."""
    if op == ">":
        return threshold
    if op == ">=":
        return threshold - 1
    if op == "<":
        return threshold
    if op == "<=":
        return threshold + 1
    if op == "==":
        return threshold + 1
    if op == "!=":
        return threshold
    raise ValueError(f"Unsupported op: {op}")


def run_job(
    input_path: str,
    doc_id: str,
    data_dir: str,
    gates_path: str,
    job_id: str,
    docling_config_path: str | None,
    pymupdf_config_path: str | None,
    engine: str | None,
    device_override: str | None,
    profile_override: str | None,
) -> int:
    """Runs the fixture job to generate meta.json and outputs."""
    config = load_config(gates_path)
    docling_config = load_docling_config(docling_config_path, config)
    default_profile = str(docling_config.get("defaultProfile", "digital-balanced"))
    profiles = docling_config.get("profiles", {})
    selected_profile = (
        profile_override
        if profile_override in profiles
        else default_profile
    )
    profile_cfg = profiles.get(selected_profile, {})
    requested_device = device_override or resolve_default_device(docling_config)
    cuda_available = os.getenv("FAKE_CUDA_AVAILABLE", "").strip() == "1"
    if requested_device == "cuda" and not cuda_available:
        effective_device = "cpu"
        fallback_reason = "CUDA_NOT_AVAILABLE"
    elif requested_device == "cuda":
        effective_device = "cuda"
        fallback_reason = None
    elif requested_device == "cpu":
        effective_device = "cpu"
        fallback_reason = None
    else:
        effective_device = "cuda" if cuda_available else "cpu"
        fallback_reason = None
    export_dir = os.path.join(data_dir, "exports", doc_id)
    os.makedirs(export_dir, exist_ok=True)
    meta_path = os.path.join(export_dir, "meta.json")

    emit_progress("INIT", "Preparing fixture worker.", 5, job_id)
    size_bytes = os.path.getsize(input_path)
    file_name = os.path.basename(input_path).lower()
    engine_name = engine or "docling"
    layout_available = os.getenv("FAKE_PYMUPDF_LAYOUT_AVAILABLE", "1").strip() != "0"
    layout_missing = engine_name == "pymupdf4llm" and not layout_available
    try:
        with open(input_path, "rb") as handle:
            content_text = handle.read().decode("utf-8", errors="ignore").lower()
    except OSError:
        content_text = ""
    has_text_ops = "tj" in content_text
    is_bad = (
        "bad" in file_name
        or "scan" in file_name
        or "bad" in content_text
        or "scan" in content_text
        or not has_text_ops
    )
    default_metrics = {
        "pages": 0,
        "textChars": 0,
        "mdChars": 0,
        "textItems": 0,
        "tables": 0,
        "textCharsPerPageAvg": 0,
    }

    if is_bad:
        metrics = build_pass_metrics(config)
        fail_gate = next(
            (
                gate
                for gate in config.get("gates", [])
                if gate.get("enabled")
                and gate.get("severity") == "FAIL"
                and gate.get("metric") == "textChars"
            ),
            None,
        )
        if not fail_gate:
            fail_gate = next(
                (
                    gate
                    for gate in config.get("gates", [])
                    if gate.get("enabled") and gate.get("severity") == "FAIL"
                ),
                None,
            )
        if fail_gate:
            metrics[fail_gate["metric"]] = value_to_fail(
                fail_gate["op"], float(fail_gate["threshold"])
            )
    else:
        metrics = build_pass_metrics(config)

    for key, value in default_metrics.items():
        metrics.setdefault(key, value)

    passed, failed, evaluated = evaluate_gates(metrics, config)
    status = "SUCCESS" if passed else "FAILED"
    if layout_missing:
        passed = False
        failed = []
        evaluated = []
        status = "FAILED"
    emit_progress("GATES", "Evaluated quality gates.", 80, job_id)

    outputs = {
        "markdownPath": None,
        "jsonPath": None,
        "bytes": {"markdown": 0, "json": 0},
    }

    if passed:
        emit_progress("WRITE_OUTPUTS", "Writing fixture outputs.", 92, job_id)
        md_path = os.path.join(export_dir, "output.md")
        json_path = os.path.join(export_dir, "output.json")
        with open(md_path, "w", encoding="utf-8") as handle:
            handle.write("# Fixture export\n")
        with open(json_path, "w", encoding="utf-8") as handle:
            json.dump({"ok": True}, handle)
        outputs = {
            "markdownPath": md_path,
            "jsonPath": json_path,
            "bytes": {
                "markdown": len("# Fixture export\n".encode("utf-8")),
                "json": len(json.dumps({"ok": True}).encode("utf-8")),
            },
        }

    docling_meta = {
        "pdfBackend": profile_cfg.get("pdfBackend", "dlparse_v2"),
        "doOcr": profile_cfg.get("doOcr", False),
        "doTableStructure": profile_cfg.get("doTableStructure", False),
        "tableStructureMode": profile_cfg.get("tableStructureMode", "fast"),
        "documentTimeoutSec": profile_cfg.get("documentTimeoutSec", 0),
        "accelerator": effective_device,
    }
    if "doCellMatching" in profile_cfg:
        docling_meta["doCellMatching"] = profile_cfg.get("doCellMatching")

    docling_requested = None
    docling_effective = None
    docling_caps = None
    docling_processing = None
    if engine_name == "docling":
        docling_requested = {
            "profile": selected_profile,
            "pdfBackendRequested": profile_cfg.get("pdfBackend", "dlparse_v2"),
            "tableModeRequested": profile_cfg.get("tableStructureMode", "fast"),
            "doCellMatchingRequested": (
                bool(profile_cfg.get("doCellMatching"))
                if "doCellMatching" in profile_cfg
                else None
            ),
        }
        docling_effective = {
            "doclingVersion": "FAKE",
            "pdfBackendEffective": docling_meta["pdfBackend"],
            "tableModeEffective": docling_meta["tableStructureMode"],
            "doCellMatchingEffective": docling_meta.get("doCellMatching"),
            "acceleratorEffective": effective_device,
            "fallbackReasons": [],
        }
        docling_caps = {
            "doclingVersion": "FAKE",
            "pdfBackends": ["dlparse_v2", "dlparse_v4"],
            "tableModes": ["fast", "accurate"],
            "tableStructureOptionsFields": ["mode", "do_cell_matching"],
            "cudaAvailable": cuda_available,
            "gpuName": "FAKE_GPU" if cuda_available else None,
            "torchVersion": "FAKE",
            "torchCudaVersion": "FAKE",
        }
        docling_processing = docling_meta

    engine_requested = {
        "name": engine_name,
    }
    engine_effective = {
        "name": engine_name,
        **({"pymupdfVersion": "FAKE"} if engine_name != "docling" else {}),
        **({"pymupdf4llmVersion": "FAKE"} if engine_name == "pymupdf4llm" else {}),
    }
    if engine_name == "pymupdf4llm":
        engine_effective["layoutActive"] = not layout_missing
        engine_effective["layoutOnly"] = True

    meta = {
        "schemaVersion": 1,
        "id": doc_id,
        "createdAt": now_iso(),
        "source": {
            "originalFileName": os.path.basename(input_path),
            "mimeType": "application/pdf",
            "sizeBytes": size_bytes,
            "sha256": "fake",
            "storedPath": input_path,
        },
        "processing": {
            "status": status,
            "stage": "DONE" if status == "SUCCESS" else "FAILED",
            "startedAt": now_iso(),
            "finishedAt": now_iso(),
            "durationMs": 10,
            "timeoutSec": config["limits"]["processTimeoutSec"],
            "exitCode": 0,
            **(
                {
                    "message": "PyMuPDF4LLM layout-only: layout unavailable",
                    "failure": {
                        "code": "PYMUPDF_LAYOUT_UNAVAILABLE",
                        "message": "PyMuPDF4LLM layout-only: layout unavailable",
                        "details": "FAKE_PYMUPDF_LAYOUT_AVAILABLE=0",
                    },
                }
                if layout_missing
                else {}
            ),
            "selectedProfile": selected_profile,
            **({"docling": docling_processing} if docling_processing else {}),
            "accelerator": {
                "requestedDevice": requested_device,
                "effectiveDevice": effective_device,
                "cudaAvailable": cuda_available,
                **({"reason": fallback_reason} if fallback_reason else {}),
            },
            "timings": {
                "pythonStartupMs": 1,
                "preflightMs": 1,
                "doclingConvertMs": 1,
                "exportMs": 1,
            },
            "worker": {
                "pythonBin": sys.executable,
                "pythonVersion": sys.version.split()[0],
                "doclingVersion": "FAKE",
            },
        },
        **(
            {
                "docling": {
                    "requested": docling_requested,
                    "effective": docling_effective,
                    "capabilities": docling_caps,
                }
            }
            if docling_requested and docling_effective and docling_caps
            else {}
        ),
        "engine": {
            "requested": engine_requested,
            "effective": engine_effective,
        },
        "outputs": outputs,
        "metrics": metrics,
        "qualityGates": {
            "configVersion": config["version"],
            "strict": config["strict"],
            "passed": passed,
            "failedGates": failed,
            "evaluated": evaluated,
        },
        "logs": {"stdoutTail": "fake worker", "stderrTail": ""},
    }

    emit_progress("DONE", "Fixture processing complete.", 100, job_id)
    with open(meta_path, "w", encoding="utf-8") as handle:
        json.dump(meta, handle, indent=2)
    global LAST_JOB_PROOF
    if docling_requested and docling_effective:
        LAST_JOB_PROOF = {
            "docId": doc_id,
            "requested": docling_requested,
            "effective": docling_effective,
            "fallbackReasons": [],
        }
    return 0


def run_worker_loop() -> int:
    """Runs the fixture worker in keep-warm mode."""
    emit_event({"event": "ready", "pythonStartupMs": 1})
    for line in sys.stdin:
        payload = line.strip()
        if not payload:
            continue
        try:
            message = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if not isinstance(message, dict):
            continue
        if message.get("type") == "shutdown":
            break
        if message.get("type") == "capabilities":
            emit_event(
                {
                    "event": "capabilities",
                    "requestId": message.get("requestId"),
                    "capabilities": {
                        "doclingVersion": "FAKE",
                        "pdfBackends": ["dlparse_v2", "dlparse_v4"],
                        "tableModes": ["fast", "accurate"],
                        "tableStructureOptionsFields": ["mode", "do_cell_matching"],
                        "cudaAvailable": os.getenv("FAKE_CUDA_AVAILABLE", "").strip() == "1",
                        "gpuName": "FAKE_GPU",
                        "torchVersion": "FAKE",
                        "torchCudaVersion": "FAKE",
                        "pymupdf": {
                            "pymupdf4llm": {"available": True, "reason": None, "version": "FAKE"},
                            "layout": {"available": True, "reason": None},
                        },
                    },
                    "lastJob": LAST_JOB_PROOF,
                }
            )
            continue
        if message.get("type") != "job":
            continue

        job_id = str(message.get("jobId") or message.get("docId") or "")
        input_path = message.get("input")
        doc_id = message.get("docId")
        data_dir = message.get("dataDir")
        gates_path = message.get("gates")
        docling_config_path = message.get("doclingConfig")
        pymupdf_config_path = message.get("pymupdfConfig")
        engine = message.get("engine")
        device_override = message.get("deviceOverride")
        if not job_id or not input_path or not doc_id or not data_dir or not gates_path:
            continue
        run_job(
            input_path,
            doc_id,
            data_dir,
            gates_path,
            job_id,
            docling_config_path,
            pymupdf_config_path,
            engine,
            device_override,
            message.get("profile"),
        )
        meta_path = os.path.join(data_dir, "exports", doc_id, "meta.json")
        emit_event({"event": "result", "jobId": job_id, "exitCode": 0, "metaPath": meta_path})
    return 0


def main() -> int:
    """Runs the fixture worker to generate meta.json and outputs."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", action="store_true", help="Run in keep-warm mode.")
    parser.add_argument("--input")
    parser.add_argument("--doc-id")
    parser.add_argument("--data-dir")
    parser.add_argument("--gates")
    parser.add_argument("--docling-config")
    args = parser.parse_args()

    if args.worker:
        return run_worker_loop()

    missing = [name for name in ("input", "doc_id", "data_dir", "gates") if not getattr(args, name)]
    if missing:
        raise SystemExit(f"Missing required args: {', '.join(missing)}")

    return run_job(
        args.input,
        args.doc_id,
        args.data_dir,
        args.gates,
        args.doc_id,
        args.docling_config,
        None,
        None,
        None,
        None,
    )


if __name__ == "__main__":
    raise SystemExit(main())
