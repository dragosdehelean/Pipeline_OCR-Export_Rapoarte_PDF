import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.append(os.getcwd())

from services.docling_worker.gates import evaluate_gates, load_config


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def derive_bounds(config: dict) -> dict:
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
    bounds = derive_bounds(config)
    return {metric: choose_value(entry) for metric, entry in bounds.items()}


def value_to_fail(op: str, threshold: float) -> float:
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--doc-id", required=True)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--gates", required=True)
    args = parser.parse_args()

    config = load_config(args.gates)
    export_dir = os.path.join(args.data_dir, "exports", args.doc_id)
    os.makedirs(export_dir, exist_ok=True)
    meta_path = os.path.join(export_dir, "meta.json")

    size_bytes = os.path.getsize(args.input)
    file_name = os.path.basename(args.input).lower()
    try:
        with open(args.input, "rb") as handle:
            content_text = handle.read().decode("utf-8", errors="ignore").lower()
    except OSError:
        content_text = ""
    is_bad = (
        "bad" in file_name
        or "scan" in file_name
        or "bad" in content_text
        or "scan" in content_text
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
            (gate for gate in config.get("gates", []) if gate.get("enabled") and gate.get("severity") == "FAIL"),
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

    outputs = {
        "markdownPath": None,
        "jsonPath": None,
        "bytes": {"markdown": 0, "json": 0},
    }

    if passed:
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

    meta = {
        "schemaVersion": 1,
        "id": args.doc_id,
        "createdAt": now_iso(),
        "source": {
            "originalFileName": os.path.basename(args.input),
            "mimeType": "application/pdf",
            "sizeBytes": os.path.getsize(args.input),
            "sha256": "fake",
            "storedPath": args.input,
        },
        "processing": {
            "status": status,
            "startedAt": now_iso(),
            "finishedAt": now_iso(),
            "durationMs": 10,
            "timeoutSec": config["limits"]["processTimeoutSec"],
            "exitCode": 0,
            "worker": {
                "pythonBin": sys.executable,
                "pythonVersion": sys.version.split()[0],
                "doclingVersion": "FAKE",
            },
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

    with open(meta_path, "w", encoding="utf-8") as handle:
        json.dump(meta, handle, indent=2)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
