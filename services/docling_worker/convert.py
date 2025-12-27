import argparse
import hashlib
import json
import os
import platform
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, Tuple

try:
    from .gates import evaluate_gates, load_config
except ImportError:
    from gates import evaluate_gates, load_config


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_doc_to_dict(document: Any) -> Dict[str, Any]:
    export_fn = getattr(document, "export_to_dict", None)
    if callable(export_fn):
        return export_fn()
    model_dump = getattr(document, "model_dump", None)
    if callable(model_dump):
        return model_dump()
    fallback = getattr(document, "dict", None)
    if callable(fallback):
        return fallback()
    raise RuntimeError("No supported export method found for document")


def compute_metrics(document: Any, markdown: str) -> Dict[str, float]:
    pages = 0
    if hasattr(document, "num_pages"):
        pages_value = getattr(document, "num_pages")
        pages = int(pages_value() if callable(pages_value) else pages_value)
    elif hasattr(document, "pages"):
        pages_value = getattr(document, "pages")
        pages = len(pages_value() if callable(pages_value) else pages_value)

    texts_value = getattr(document, "texts", []) or []
    tables_value = getattr(document, "tables", []) or []
    texts = texts_value() if callable(texts_value) else texts_value
    tables = tables_value() if callable(tables_value) else tables_value

    text_chars = 0
    text_items = 0
    for item in texts:
        text_value = getattr(item, "text", "")
        text_str = str(text_value)
        text_chars += len(text_str)
        text_items += len(text_str.split())

    md_chars = len(markdown)
    tables_count = len(tables)
    avg = text_chars / pages if pages > 0 else 0

    return {
        "pages": pages,
        "textChars": text_chars,
        "mdChars": md_chars,
        "textItems": text_items,
        "tables": tables_count,
        "textCharsPerPageAvg": avg,
    }


def clamp_tail(text: str, max_kb: int) -> str:
    if max_kb <= 0:
        return ""
    max_bytes = max_kb * 1024
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text
    tail = encoded[-max_bytes:]
    return tail.decode("utf-8", errors="ignore")


def get_docling_version() -> str:
    try:
        import docling

        return getattr(docling, "__version__", "UNKNOWN")
    except Exception:
        return "UNKNOWN"


def build_base_meta(
    doc_id: str,
    input_path: str,
    config: Dict[str, Any],
) -> Dict[str, Any]:
    size_bytes = os.path.getsize(input_path)
    return {
        "schemaVersion": 1,
        "id": doc_id,
        "createdAt": now_iso(),
        "source": {
            "originalFileName": os.path.basename(input_path),
            "mimeType": "",
            "sizeBytes": size_bytes,
            "sha256": sha256_file(input_path),
            "storedPath": input_path,
        },
        "processing": {
            "status": "PENDING",
            "startedAt": now_iso(),
            "finishedAt": None,
            "durationMs": 0,
            "timeoutSec": config.get("limits", {}).get("processTimeoutSec", 0),
            "exitCode": 0,
            "worker": {
                "pythonBin": sys.executable,
                "pythonVersion": platform.python_version(),
                "doclingVersion": get_docling_version(),
            },
        },
        "outputs": {
            "markdownPath": None,
            "jsonPath": None,
            "bytes": {"markdown": 0, "json": 0},
        },
        "metrics": {
            "pages": 0,
            "textChars": 0,
            "mdChars": 0,
            "textItems": 0,
            "tables": 0,
            "textCharsPerPageAvg": 0,
        },
        "qualityGates": {
            "configVersion": config.get("version"),
            "strict": config.get("strict", True),
            "passed": False,
            "failedGates": [],
            "evaluated": [],
        },
        "logs": {"stdoutTail": "", "stderrTail": ""},
    }


def write_json(path: str, payload: Dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def run_conversion(args: argparse.Namespace) -> int:
    config = load_config(args.gates)
    export_dir = os.path.join(args.data_dir, "exports", args.doc_id)
    os.makedirs(export_dir, exist_ok=True)
    meta_path = os.path.join(export_dir, "meta.json")

    meta = build_base_meta(args.doc_id, args.input, config)
    start = time.time()

    try:
        from docling.document_converter import DocumentConverter

        converter = DocumentConverter()
        result = converter.convert(args.input)
        document = result.document
        markdown = document.export_to_markdown()
        doc_dict = export_doc_to_dict(document)

        metrics = compute_metrics(document, markdown)
        gates_passed, failed, evaluated = evaluate_gates(metrics, config)

        max_pages = config.get("limits", {}).get("maxPages", 0)
        if max_pages and metrics["pages"] > max_pages:
            failed.append(
                {
                    "code": "LIMIT_MAX_PAGES",
                    "message": "Page count exceeds maxPages limit.",
                    "actual": metrics["pages"],
                    "expectedOp": "<=",
                    "expected": max_pages,
                }
            )
            gates_passed = False

        status = "SUCCESS" if gates_passed else "FAILED"

        meta["metrics"] = metrics
        meta["qualityGates"]["passed"] = gates_passed
        meta["qualityGates"]["failedGates"] = failed
        meta["qualityGates"]["evaluated"] = evaluated
        meta["processing"]["status"] = status

        if gates_passed:
            md_path = os.path.join(export_dir, "output.md")
            json_path = os.path.join(export_dir, "output.json")
            with open(md_path, "w", encoding="utf-8") as handle:
                handle.write(markdown)
            with open(json_path, "w", encoding="utf-8") as handle:
                json.dump(doc_dict, handle)

            meta["outputs"] = {
                "markdownPath": md_path,
                "jsonPath": json_path,
                "bytes": {
                    "markdown": len(markdown.encode("utf-8")),
                    "json": len(json.dumps(doc_dict).encode("utf-8")),
                },
            }
        else:
            meta["outputs"] = {
                "markdownPath": None,
                "jsonPath": None,
                "bytes": {"markdown": 0, "json": 0},
            }

        meta["processing"]["exitCode"] = 0
    except Exception as exc:
        meta["processing"]["status"] = "FAILED"
        meta["processing"]["exitCode"] = 1
        meta["logs"]["stderrTail"] = clamp_tail(str(exc), config["limits"]["stderrTailKb"])
        end = time.time()
        meta["processing"]["finishedAt"] = now_iso()
        meta["processing"]["durationMs"] = int((end - start) * 1000)
        write_json(meta_path, meta)
        return 1

    end = time.time()
    meta["processing"]["finishedAt"] = now_iso()
    meta["processing"]["durationMs"] = int((end - start) * 1000)

    write_json(meta_path, meta)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Docling worker")
    parser.add_argument("--input", required=True)
    parser.add_argument("--doc-id", required=True)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--gates", required=True)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    return run_conversion(args)


if __name__ == "__main__":
    sys.exit(main())
