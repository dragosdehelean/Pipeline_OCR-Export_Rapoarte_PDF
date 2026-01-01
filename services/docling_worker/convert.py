"""Docling worker that converts documents and writes export artifacts."""
import argparse
import hashlib
import json
import os
import platform
import re
import sys
import time
import base64
import zlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

try:
    from .gates import evaluate_gates, load_config
except ImportError:
    from gates import evaluate_gates, load_config

SCRIPT_START = time.perf_counter()
CONVERTER_CACHE: Dict[str, Any] = {}
CONVERTER_CACHE_STATS = {"builds": 0, "hits": 0}


@dataclass(frozen=True)
class AcceleratorSelection:
    requested_device: str
    effective_device: str
    cuda_available: bool
    reason: Optional[str] = None
    torch_version: Optional[str] = None
    torch_cuda_version: Optional[str] = None


@dataclass(frozen=True)
class DoclingSettings:
    profile: str
    pdf_backend: str
    do_ocr: bool
    do_table_structure: bool
    table_structure_mode: str
    document_timeout_sec: int
    accelerator: AcceleratorSelection
    do_cell_matching: Optional[bool] = None


@dataclass(frozen=True)
class PreflightResult:
    passed: bool
    sample_pages: int
    text_chars: int
    text_chars_per_page_avg: float
    error: Optional[str] = None


def now_iso() -> str:
    """Returns current UTC time as ISO-8601 with a Z suffix."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: str) -> str:
    """Computes the SHA-256 hex digest of a file."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_doc_to_dict(document: Any) -> Dict[str, Any]:
    """Exports a document to a plain dict using supported hooks."""
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
    """Computes basic page/text/table metrics for quality gates."""
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
    """Returns a UTF-8 safe tail of the input text capped to max_kb."""
    if max_kb <= 0:
        return ""
    max_bytes = max_kb * 1024
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text
    tail = encoded[-max_bytes:]
    return tail.decode("utf-8", errors="ignore")


def emit_event(payload: Dict[str, Any]) -> None:
    """Prints a JSON event payload to stdout for the Node orchestrator."""
    print(json.dumps(payload), flush=True)


def emit_progress(
    stage: str, message: str, progress: int, job_id: Optional[str] = None
) -> None:
    """Prints a structured progress event for the Node orchestrator."""
    payload = {
        "event": "progress",
        "stage": stage,
        "message": message,
        "progress": progress,
    }
    if job_id:
        payload["jobId"] = job_id
    emit_event(payload)


def emit_ready(
    python_startup_ms: int,
    settings: Optional[DoclingSettings] = None,
) -> None:
    """Emits a ready event once the worker is warm."""
    payload: Dict[str, Any] = {"event": "ready", "pythonStartupMs": python_startup_ms}
    if settings:
        accelerator = settings.accelerator
        prewarm_payload = {
            "profile": settings.profile,
            "requestedDevice": accelerator.requested_device,
            "effectiveDevice": accelerator.effective_device,
            "cudaAvailable": accelerator.cuda_available,
        }
        if accelerator.reason:
            prewarm_payload["reason"] = accelerator.reason
        payload["prewarm"] = prewarm_payload
    emit_event(payload)


def emit_result(job_id: str, exit_code: int, meta_path: str) -> None:
    """Emits a result event for the finished job."""
    emit_event(
        {
            "event": "result",
            "jobId": job_id,
            "exitCode": exit_code,
            "metaPath": meta_path,
        }
    )


def get_docling_version() -> str:
    """Returns the docling version when available."""
    try:
        import docling

        return getattr(docling, "__version__", "UNKNOWN")
    except Exception:
        return "UNKNOWN"


def resolve_docling_config_path(docling_path: Optional[str]) -> Optional[str]:
    """Resolves the Docling config path from args or env defaults."""
    candidate = docling_path or os.getenv("DOCLING_CONFIG_PATH")
    if candidate and str(candidate).strip():
        return str(candidate)
    return os.path.join(os.getcwd(), "config", "docling.json")


def has_legacy_docling_keys(gates_config: Dict[str, Any]) -> bool:
    """Checks for deprecated docling/preflight keys in the gates config."""
    return "docling" in gates_config or "preflight" in gates_config


def warn_legacy_docling_keys() -> None:
    """Warns about deprecated docling/preflight keys in quality-gates.json."""
    print(
        "[config] Deprecated docling/preflight keys found in quality-gates.json. Move them to config/docling.json.",
        file=sys.stderr,
    )


def build_legacy_docling_config(gates_config: Dict[str, Any]) -> Dict[str, Any]:
    """Builds a Docling config shim from deprecated gate config keys."""
    docling_cfg = gates_config.get("docling", {})
    profile = str(docling_cfg.get("profile", "digital-fast"))
    preflight_cfg = gates_config.get("preflight", {})
    return {
        "version": 0,
        "defaultProfile": profile,
        "profiles": {
            profile: {
                "pdfBackend": docling_cfg.get("pdfBackend", "dlparse_v2"),
                "doOcr": docling_cfg.get("doOcr", False),
                "doTableStructure": docling_cfg.get("doTableStructure", False),
                "tableStructureMode": docling_cfg.get("tableStructureMode", "fast"),
                "documentTimeoutSec": docling_cfg.get("documentTimeoutSec", 0),
            }
        },
        "preflight": preflight_cfg,
        "docling": {
            "accelerator": {
                "defaultDevice": docling_cfg.get("accelerator", "auto")
            }
        },
    }


def load_docling_config(
    docling_path: Optional[str],
    gates_config: Dict[str, Any],
) -> Dict[str, Any]:
    """Loads docling config with legacy fallback for deprecated keys."""
    resolved_path = resolve_docling_config_path(docling_path)
    loaded = None
    if resolved_path:
        try:
            with open(resolved_path, "r", encoding="utf-8") as handle:
                loaded = json.load(handle)
        except FileNotFoundError:
            loaded = None

    legacy = build_legacy_docling_config(gates_config) if has_legacy_docling_keys(gates_config) else None
    if legacy:
        warn_legacy_docling_keys()

    if loaded is None:
        if legacy:
            return legacy
        raise FileNotFoundError("Missing config/docling.json and no legacy docling keys found.")
    return loaded


def resolve_profile_config(
    docling_config: Dict[str, Any],
    profile_override: Optional[str] = None,
) -> Tuple[str, Dict[str, Any]]:
    """Resolves the selected profile name and its config."""
    profiles = docling_config.get("profiles", {}) if isinstance(docling_config, dict) else {}
    profile = profile_override or docling_config.get("defaultProfile") or docling_config.get("profile")
    if not profile and profiles:
        profile = next(iter(profiles))
    profile = str(profile or "digital-balanced")
    profile_cfg = profiles.get(profile)
    if not isinstance(profile_cfg, dict):
        raise ValueError(f"Unknown docling profile: {profile}")
    return profile, profile_cfg


def normalize_device(value: Optional[str]) -> str:
    """Normalizes accelerator device values to auto/cpu/cuda."""
    normalized = str(value or "").lower().strip()
    if normalized in {"cpu", "cuda"}:
        return normalized
    return "auto"


def resolve_default_device(docling_config: Dict[str, Any]) -> str:
    """Reads the default accelerator device from config."""
    docling_section = docling_config.get("docling", {})
    if isinstance(docling_section, dict):
        accelerator = docling_section.get("accelerator")
        if isinstance(accelerator, dict):
            return normalize_device(accelerator.get("defaultDevice"))
        if isinstance(accelerator, str):
            return normalize_device(accelerator)
    return "auto"


def resolve_requested_device(
    docling_config: Dict[str, Any],
    device_override: Optional[str] = None,
) -> str:
    """Resolves the requested device from job overrides and config defaults."""
    if device_override and str(device_override).strip():
        return normalize_device(device_override)
    return resolve_default_device(docling_config)


def resolve_docling_settings(
    docling_config: Dict[str, Any],
    profile_override: Optional[str] = None,
    device_override: Optional[str] = None,
) -> DoclingSettings:
    """Resolves Docling settings from the docling config."""
    profile, profile_cfg = resolve_profile_config(docling_config, profile_override)
    requested_device = resolve_requested_device(docling_config, device_override)
    accelerator = select_accelerator(requested_device)
    do_cell_matching_raw = profile_cfg.get("doCellMatching")
    do_cell_matching = (
        bool(do_cell_matching_raw) if do_cell_matching_raw is not None else None
    )
    return DoclingSettings(
        profile=profile,
        pdf_backend=str(profile_cfg.get("pdfBackend", "dlparse_v2")),
        do_ocr=bool(profile_cfg.get("doOcr", False)),
        do_table_structure=bool(profile_cfg.get("doTableStructure", False)),
        table_structure_mode=resolve_table_structure_mode(
            str(profile_cfg.get("tableStructureMode", "fast"))
        ),
        document_timeout_sec=int(profile_cfg.get("documentTimeoutSec", 0)),
        accelerator=accelerator,
        do_cell_matching=do_cell_matching,
    )


def get_torch_info() -> Tuple[bool, Optional[str], Optional[str], bool]:
    """Returns torch availability, version, CUDA version, and CUDA availability."""
    try:
        import torch

        return (
            True,
            getattr(torch, "__version__", None),
            getattr(torch.version, "cuda", None),
            bool(torch.cuda.is_available()),
        )
    except Exception:
        return False, None, None, False


def select_accelerator(requested: str) -> AcceleratorSelection:
    """Selects the effective device based on torch availability."""
    requested_device = normalize_device(requested)
    torch_available, torch_version, torch_cuda_version, cuda_available = get_torch_info()
    reason = None
    if requested_device == "cuda":
        if torch_available and cuda_available:
            effective = "cuda"
        else:
            effective = "cpu"
            reason = "CUDA_NOT_AVAILABLE"
    elif requested_device == "cpu":
        effective = "cpu"
    else:
        effective = "cuda" if cuda_available else "cpu"
    return AcceleratorSelection(
        requested_device=requested_device,
        effective_device=effective,
        cuda_available=cuda_available,
        reason=reason,
        torch_version=torch_version if torch_available else None,
        torch_cuda_version=torch_cuda_version if torch_available else None,
    )


def resolve_pdf_backend_class(backend_name: str) -> Any:
    """Resolves the configured PDF backend class."""
    normalized = backend_name.lower().replace("-", "_").strip()
    if normalized in {"dlparse_v2", "dlparse2"}:
        from docling.backend.docling_parse_v2_backend import (
            DoclingParseV2DocumentBackend,
        )

        return DoclingParseV2DocumentBackend
    if normalized in {"dlparse_v4", "dlparse4"}:
        from docling.backend.docling_parse_v4_backend import (
            DoclingParseV4DocumentBackend,
        )

        return DoclingParseV4DocumentBackend
    if normalized in {"dlparse_v1", "dlparse1", "dlparse"}:
        from docling.backend.docling_parse_backend import DoclingParseDocumentBackend

        return DoclingParseDocumentBackend
    if normalized in {"pypdfium2", "pdfium"}:
        from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend

        return PyPdfiumDocumentBackend
    raise ValueError(f"Unsupported pdf backend: {backend_name}")


def resolve_table_structure_mode(mode: str) -> str:
    """Normalizes table structure mode values."""
    normalized = mode.lower().strip()
    if normalized in {"fast", "accurate"}:
        return normalized
    return "fast"


def build_converter_cache_key(settings: DoclingSettings) -> str:
    """Builds a stable cache key for Docling converters."""
    return (
        f"{settings.profile}|{settings.pdf_backend}|{settings.do_ocr}|"
        f"{settings.do_table_structure}|{settings.table_structure_mode}|"
        f"{settings.document_timeout_sec}|{settings.accelerator.effective_device}|"
        f"{settings.do_cell_matching}"
    )


def get_cached_converter(settings: DoclingSettings) -> Tuple[Any, bool]:
    """Returns a cached converter when available, otherwise builds one."""
    key = build_converter_cache_key(settings)
    cached = CONVERTER_CACHE.get(key)
    if cached is not None:
        CONVERTER_CACHE_STATS["hits"] += 1
        return cached, True
    converter = get_docling_converter(settings)
    CONVERTER_CACHE[key] = converter
    CONVERTER_CACHE_STATS["builds"] += 1
    return converter, False


def reset_converter_cache() -> None:
    """Clears the converter cache (primarily for tests)."""
    CONVERTER_CACHE.clear()
    CONVERTER_CACHE_STATS["builds"] = 0
    CONVERTER_CACHE_STATS["hits"] = 0


def get_converter_cache_stats() -> Dict[str, int]:
    """Returns converter cache stats for testing."""
    return dict(CONVERTER_CACHE_STATS)


def prewarm_converter_cache(
    docling_path: Optional[str],
    gates_path: Optional[str],
) -> Optional[DoclingSettings]:
    """Warms the converter cache with the default profile."""
    gates_config: Dict[str, Any] = {}
    if gates_path:
        try:
            gates_config = load_config(gates_path)
        except Exception:
            gates_config = {}

    try:
        docling_config = load_docling_config(docling_path, gates_config)
        settings = resolve_docling_settings(docling_config)
        get_cached_converter(settings)
        return settings
    except Exception as exc:
        print(f"[worker] Converter prewarm failed: {exc}", file=sys.stderr)
    return None


def get_docling_converter(settings: DoclingSettings) -> Any:
    """Builds a Docling converter with explicit PDF pipeline options."""
    from docling.datamodel.accelerator_options import AcceleratorOptions
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        PdfPipelineOptions,
        TableFormerMode,
        TableStructureOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption

    accelerator_device = settings.accelerator.effective_device
    table_mode = resolve_table_structure_mode(settings.table_structure_mode)
    table_options_kwargs: Dict[str, Any] = {
        "mode": TableFormerMode.FAST if table_mode == "fast" else TableFormerMode.ACCURATE
    }
    if settings.do_cell_matching is not None:
        table_options_kwargs["do_cell_matching"] = settings.do_cell_matching
    table_options = TableStructureOptions(**table_options_kwargs)

    document_timeout = (
        float(settings.document_timeout_sec)
        if settings.document_timeout_sec > 0
        else None
    )
    pipeline_options = PdfPipelineOptions(
        do_ocr=settings.do_ocr,
        do_table_structure=settings.do_table_structure,
        document_timeout=document_timeout,
        table_structure_options=table_options,
        accelerator_options=AcceleratorOptions(device=accelerator_device),
    )

    pdf_backend = resolve_pdf_backend_class(settings.pdf_backend)
    pdf_format = PdfFormatOption(pipeline_options=pipeline_options, backend=pdf_backend)

    return DocumentConverter(format_options={InputFormat.PDF: pdf_format})


def safe_close(resource: Any) -> None:
    """Closes a resource when the close hook is available."""
    close_fn = getattr(resource, "close", None)
    if callable(close_fn):
        close_fn()


def count_non_whitespace(text: str) -> int:
    """Counts non-whitespace characters in a string."""
    return sum(1 for char in text if not char.isspace())


def sample_pdf_text(input_path: str, sample_pages: int) -> Tuple[int, int]:
    """Samples text from the first N pages of a PDF using pypdfium2."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(input_path)
    pages_to_sample = min(sample_pages, len(pdf))
    total_chars = 0
    try:
        for index in range(pages_to_sample):
            page = pdf.get_page(index)
            text_page = page.get_textpage()
            char_count = text_page.count_chars()
            text = text_page.get_text_range(0, char_count) if char_count else ""
            total_chars += count_non_whitespace(text)
            safe_close(text_page)
            safe_close(page)
    finally:
        safe_close(pdf)
    return total_chars, pages_to_sample


def fallback_pdf_text_count(input_path: str) -> int:
    """Counts text operators in the PDF content as a fallback heuristic."""
    with open(input_path, "rb") as handle:
        raw = handle.read()
    return max(count_text_ops_in_bytes(raw), count_text_ops_in_streams(raw))


def count_text_ops_in_bytes(data: bytes) -> int:
    """Counts text operators in raw PDF bytes."""
    text = data.decode("latin-1", errors="ignore")
    total = 0

    for match in re.finditer(r"\[(.*?)\]\s*TJ", text, re.DOTALL):
        total += sum(len(m.group(1)) for m in re.finditer(r"\(([^)]*)\)", match.group(1)))
        total += sum(len(m.group(1)) // 2 for m in re.finditer(r"<([0-9A-Fa-f]+)>", match.group(1)))

    for match in re.finditer(r"\(([^)]*)\)\s*Tj", text):
        total += len(match.group(1))

    for match in re.finditer(r"<([0-9A-Fa-f]+)>\s*Tj", text):
        total += len(match.group(1)) // 2

    return total


def count_text_ops_in_streams(data: bytes) -> int:
    """Attempts to decompress PDF streams and count text operators."""
    total = 0
    for match in re.finditer(rb"stream\r?\n", data):
        start = match.end()
        end = data.find(b"endstream", start)
        if end == -1:
            continue
        stream_data = data[start:end].strip(b"\r\n")
        if stream_data.endswith(b"~>"):
            stream_data = stream_data[:-2]
        decoded = None
        try:
            decoded = zlib.decompress(stream_data)
        except Exception:
            try:
                decoded = base64.a85decode(stream_data, adobe=False)
                decoded = zlib.decompress(decoded)
            except Exception:
                decoded = None
        if decoded:
            total += count_text_ops_in_bytes(decoded)
    return total


def run_pdf_preflight(input_path: str, docling_config: Dict[str, Any]) -> PreflightResult:
    """Runs a fast PDF text-layer preflight check."""
    preflight_cfg = docling_config.get("preflight", {}).get("pdfText", {})
    if not preflight_cfg.get("enabled", True):
        return PreflightResult(True, 0, 0, 0)

    sample_pages = int(preflight_cfg.get("samplePages", 0))
    if sample_pages <= 0:
        return PreflightResult(True, 0, 0, 0)

    min_text_chars = int(preflight_cfg.get("minTextChars", 0))
    min_avg = float(preflight_cfg.get("minTextCharsPerPageAvg", 0))

    try:
        text_chars, sampled = sample_pdf_text(input_path, sample_pages)
    except Exception as exc:
        try:
            text_chars = fallback_pdf_text_count(input_path)
            sampled = sample_pages
            avg = text_chars / sampled if sampled > 0 else 0
            passed = text_chars >= min_text_chars and avg >= min_avg
            return PreflightResult(passed, sampled, text_chars, avg, error=str(exc))
        except Exception:
            return PreflightResult(True, 0, 0, 0, error=str(exc))

    avg = text_chars / sampled if sampled > 0 else 0
    passed = text_chars >= min_text_chars and avg >= min_avg
    return PreflightResult(passed, sampled, text_chars, avg)


def is_probable_pdf(input_path: str) -> bool:
    """Checks whether the input looks like a PDF file."""
    try:
        with open(input_path, "rb") as handle:
            return handle.read(4) == b"%PDF"
    except OSError:
        return False


def build_base_meta(
    doc_id: str,
    input_path: str,
    config: Dict[str, Any],
    settings: DoclingSettings,
    python_startup_ms: Optional[int],
) -> Dict[str, Any]:
    """Builds the initial meta.json payload for a document."""
    size_bytes = os.path.getsize(input_path)
    accelerator = settings.accelerator
    docling_meta = {
        "pdfBackend": settings.pdf_backend,
        "doOcr": settings.do_ocr,
        "doTableStructure": settings.do_table_structure,
        "tableStructureMode": settings.table_structure_mode,
        "documentTimeoutSec": settings.document_timeout_sec,
        "accelerator": accelerator.effective_device,
    }
    if settings.do_cell_matching is not None:
        docling_meta["doCellMatching"] = settings.do_cell_matching
    timings = {
        "pythonStartupMs": python_startup_ms,
        "preflightMs": 0,
        "doclingConvertMs": 0,
        "exportMs": 0,
    }
    accelerator_meta = {
        "requestedDevice": accelerator.requested_device,
        "effectiveDevice": accelerator.effective_device,
        "cudaAvailable": accelerator.cuda_available,
    }
    if accelerator.reason:
        accelerator_meta["reason"] = accelerator.reason
    if accelerator.torch_version:
        accelerator_meta["torchVersion"] = accelerator.torch_version
    if accelerator.torch_cuda_version:
        accelerator_meta["torchCudaVersion"] = accelerator.torch_cuda_version
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
            "selectedProfile": settings.profile,
            "docling": docling_meta,
            "accelerator": accelerator_meta,
            "timings": timings,
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
    """Writes JSON to disk with indentation."""
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def record_processing_end(meta: Dict[str, Any], start_time: float) -> None:
    """Finalizes processing timestamps and duration."""
    end = time.time()
    meta["processing"]["finishedAt"] = now_iso()
    meta["processing"]["durationMs"] = int((end - start_time) * 1000)


def run_conversion(
    args: argparse.Namespace,
    job_id: Optional[str] = None,
    python_startup_ms: Optional[int] = None,
) -> int:
    """Runs the Docling conversion workflow and writes outputs."""
    config = load_config(args.gates)
    docling_config = load_docling_config(
        getattr(args, "docling_config", None),
        config,
    )
    settings = resolve_docling_settings(
        docling_config,
        profile_override=getattr(args, "profile", None),
        device_override=getattr(args, "device_override", None),
    )
    export_dir = os.path.join(args.data_dir, "exports", args.doc_id)
    os.makedirs(export_dir, exist_ok=True)
    meta_path = os.path.join(export_dir, "meta.json")

    startup_ms = (
        python_startup_ms
        if python_startup_ms is not None
        else int((time.perf_counter() - SCRIPT_START) * 1000)
    )
    meta = build_base_meta(args.doc_id, args.input, config, settings, startup_ms)
    start = time.time()

    try:
        emit_progress("INIT", "Preparing conversion.", 5, job_id)

        preflight = None
        if args.input.lower().endswith(".pdf") and is_probable_pdf(args.input):
            emit_progress("PREFLIGHT", "Checking PDF text layer.", 12, job_id)
            preflight_start = time.perf_counter()
            preflight = run_pdf_preflight(args.input, docling_config)
            preflight_ms = int((time.perf_counter() - preflight_start) * 1000)
            meta["processing"]["timings"]["preflightMs"] = preflight_ms
            meta["processing"]["preflight"] = {
                "passed": preflight.passed,
                "samplePages": preflight.sample_pages,
                "textChars": preflight.text_chars,
                "textCharsPerPageAvg": preflight.text_chars_per_page_avg,
                **({"error": preflight.error} if preflight.error else {}),
            }

            if not preflight.passed:
                meta["processing"]["status"] = "FAILED"
                meta["processing"]["stage"] = "PREFLIGHT"
                meta["processing"]["message"] = (
                    "PDF appears scan-like; OCR is disabled by design; document rejected fast."
                )
                meta["processing"]["selectedProfile"] = "rejected-no-text"
                meta["processing"]["failure"] = {
                    "code": "NO_TEXT_LAYER",
                    "message": meta["processing"]["message"],
                }
                meta["processing"]["exitCode"] = 2
                meta["qualityGates"]["passed"] = False
                emit_progress("FAILED", "PDF rejected before conversion.", 100, job_id)
                record_processing_end(meta, start)
                write_json(meta_path, meta)
                return 2

        emit_progress("CONVERT", "Converting document.", 25, job_id)
        converter, _ = get_cached_converter(settings)
        convert_start = time.perf_counter()
        result = converter.convert(args.input)
        meta["processing"]["timings"]["doclingConvertMs"] = int(
            (time.perf_counter() - convert_start) * 1000
        )

        document = result.document
        emit_progress("EXPORT", "Exporting markdown.", 55, job_id)
        export_start = time.perf_counter()
        markdown = document.export_to_markdown()
        emit_progress("EXPORT_JSON", "Exporting JSON.", 65, job_id)
        doc_dict = export_doc_to_dict(document)
        meta["processing"]["timings"]["exportMs"] = int(
            (time.perf_counter() - export_start) * 1000
        )

        emit_progress("METRICS", "Computing metrics.", 75, job_id)
        metrics = compute_metrics(document, markdown)
        emit_progress("GATES", "Evaluating quality gates.", 85, job_id)
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
        meta["processing"]["stage"] = "DONE" if status == "SUCCESS" else "FAILED"

        if gates_passed:
            emit_progress("WRITE_OUTPUTS", "Writing outputs.", 92, job_id)
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
        meta["processing"]["stage"] = "FAILED"
        meta["processing"]["exitCode"] = 1
        meta["processing"]["message"] = "Processing failed."
        meta["processing"]["failure"] = {"code": "WORKER_EXCEPTION", "message": str(exc)}
        meta["logs"]["stderrTail"] = clamp_tail(
            str(exc), config["limits"]["stderrTailKb"]
        )
        emit_progress("FAILED", "Processing failed.", 100, job_id)
        record_processing_end(meta, start)
        write_json(meta_path, meta)
        return 1

    record_processing_end(meta, start)
    emit_progress("DONE", "Processing complete.", 100, job_id)
    write_json(meta_path, meta)
    return 0


def run_worker_loop() -> int:
    """Runs a keep-warm worker that receives JSONL jobs over stdin."""
    get_docling_version()
    prewarm_settings = prewarm_converter_cache(
        os.getenv("DOCLING_CONFIG_PATH"),
        os.getenv("GATES_CONFIG_PATH"),
    )
    python_startup_ms = int((time.perf_counter() - SCRIPT_START) * 1000)
    emit_ready(python_startup_ms, prewarm_settings)

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
        if message.get("type") != "job":
            continue

        job_id = str(message.get("jobId") or message.get("docId") or "")
        input_path = message.get("input")
        doc_id = message.get("docId")
        data_dir = message.get("dataDir")
        gates_path = message.get("gates")
        docling_config_path = message.get("doclingConfig")
        device_override = message.get("deviceOverride")
        profile = message.get("profile")
        if (
            not job_id
            or not input_path
            or not doc_id
            or not data_dir
            or not gates_path
        ):
            continue

        args = argparse.Namespace(
            input=input_path,
            doc_id=doc_id,
            data_dir=data_dir,
            gates=gates_path,
            docling_config=docling_config_path,
            device_override=device_override,
            profile=profile,
        )
        exit_code = run_conversion(args, job_id=job_id, python_startup_ms=python_startup_ms)
        meta_path = os.path.join(data_dir, "exports", doc_id, "meta.json")
        emit_result(job_id, exit_code, meta_path)

    return 0


def build_parser() -> argparse.ArgumentParser:
    """Creates the CLI argument parser for the worker."""
    parser = argparse.ArgumentParser(description="Docling worker")
    parser.add_argument("--worker", action="store_true", help="Run in keep-warm mode.")
    parser.add_argument("--input")
    parser.add_argument("--doc-id")
    parser.add_argument("--data-dir")
    parser.add_argument("--gates")
    parser.add_argument("--docling-config")
    parser.add_argument("--device-override")
    parser.add_argument("--profile")
    return parser


def main() -> int:
    """CLI entrypoint for the Docling worker."""
    args = build_parser().parse_args()
    if args.worker:
        return run_worker_loop()

    missing = [name for name in ("input", "doc_id", "data_dir", "gates") if not getattr(args, name)]
    if missing:
        raise SystemExit(f"Missing required args: {', '.join(missing)}")

    return run_conversion(args)


if __name__ == "__main__":
    sys.exit(main())
