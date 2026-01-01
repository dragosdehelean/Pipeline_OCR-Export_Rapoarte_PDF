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
import importlib
import inspect
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

try:
    from .gates import evaluate_gates, load_config
except ImportError:
    from gates import evaluate_gates, load_config

SCRIPT_START = time.perf_counter()
CONVERTER_CACHE: Dict[str, Any] = {}
CONVERTER_CACHE_STATS = {"builds": 0, "hits": 0}
CAPABILITIES_CACHE: Optional[Dict[str, Any]] = None
LAST_JOB_PROOF: Optional[Dict[str, Any]] = None

ENGINE_DOCLING = "docling"
ENGINE_PYMUPDF4LLM = "pymupdf4llm"
ENGINE_PYMUPDF_TEXT = "pymupdf_text"


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
    requested_settings: Dict[str, Any] = field(default_factory=dict)
    effective_settings: Dict[str, Any] = field(default_factory=dict)
    fallback_reasons: Tuple[str, ...] = ()
    capabilities: Dict[str, Any] = field(default_factory=dict)


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


def log_docling_effective(doc_id: str, settings: DoclingSettings) -> None:
    """Emits a single-line JSON log for Docling requested/effective settings."""
    payload = {
        "docId": doc_id,
        "requested": settings.requested_settings,
        "effective": settings.effective_settings,
        "fallbackReasons": list(settings.fallback_reasons),
    }
    print(f"DOCLING_EFFECTIVE {json.dumps(payload)}", flush=True)


def record_docling_proof(doc_id: str, settings: DoclingSettings) -> None:
    """Stores the last job's Docling proof for health/debug."""
    global LAST_JOB_PROOF
    LAST_JOB_PROOF = {
        "docId": doc_id,
        "requested": settings.requested_settings,
        "effective": settings.effective_settings,
        "fallbackReasons": list(settings.fallback_reasons),
    }


def get_docling_version() -> str:
    """Returns the docling version when available."""
    try:
        import docling

        return getattr(docling, "__version__", "UNKNOWN")
    except Exception:
        return "UNKNOWN"


def get_pymupdf_version() -> str:
    """Returns the PyMuPDF version by parsing pymupdf.__doc__ when possible."""
    try:
        import pymupdf

        doc = getattr(pymupdf, "__doc__", "") or ""
        match = re.search(r"PyMuPDF\s+([0-9.]+)", doc)
        if match:
            return match.group(1)
        return getattr(pymupdf, "__version__", "UNKNOWN")
    except Exception:
        return "UNKNOWN"


def get_pymupdf4llm_version() -> str:
    """Returns the PyMuPDF4LLM version when available."""
    try:
        import pymupdf4llm

        return getattr(pymupdf4llm, "version", None) or getattr(
            pymupdf4llm, "__version__", "UNKNOWN"
        )
    except Exception:
        return "UNKNOWN"


def resolve_pymupdf_text_flags(flag_names: list[str]) -> Tuple[int, list[str]]:
    """Resolves PyMuPDF TEXT_* flags into a bitmask."""
    try:
        import pymupdf
    except Exception as exc:
        raise RuntimeError("PyMuPDF is not available.") from exc
    mask = 0
    resolved: list[str] = []
    for name in flag_names:
        if not hasattr(pymupdf, name):
            raise ValueError(f"Unknown PyMuPDF text flag: {name}")
        value = getattr(pymupdf, name)
        if not isinstance(value, int):
            raise ValueError(f"PyMuPDF flag {name} is not an int value.")
        mask |= value
        resolved.append(name)
    return mask, resolved


def compute_text_metrics(pages_text: list[str], markdown: str) -> Dict[str, float]:
    """Computes basic metrics from extracted text and markdown."""
    pages = len(pages_text)
    text_chars = sum(len(text) for text in pages_text)
    text_items = sum(len(text.split()) for text in pages_text)
    md_chars = len(markdown)
    avg = text_chars / pages if pages > 0 else 0
    return {
        "pages": pages,
        "textChars": text_chars,
        "mdChars": md_chars,
        "textItems": text_items,
        "tables": 0,
        "textCharsPerPageAvg": avg,
    }


def compute_split_spacing(
    pages_text: list[str], pymupdf_config: Dict[str, Any]
) -> Optional[Dict[str, float]]:
    """Computes a split-spacing suspicion score from extracted text."""
    split_config = pymupdf_config.get("splitDetection", {}) if pymupdf_config else {}
    if not split_config.get("enabled", False):
        return None
    threshold = float(split_config.get("singleCharTokenRatioThreshold", 0.0))
    min_tokens = int(split_config.get("minTokenCount", 0))
    min_run = int(split_config.get("minSingleCharRun", 0))
    tokens: list[str] = []
    for text in pages_text:
        tokens.extend(re.findall(r"\S+", text))
    token_count = len(tokens)
    if token_count == 0:
        return {
            "score": 0.0,
            "suspicious": False,
            "singleCharTokenRatio": 0.0,
            "singleCharRuns": 0.0,
        }
    single_char_count = sum(1 for token in tokens if len(token) == 1)
    single_char_ratio = single_char_count / token_count
    runs = 0
    current_run = 0
    for token in tokens:
        if len(token) == 1:
            current_run += 1
        else:
            if current_run >= min_run:
                runs += 1
            current_run = 0
    if current_run >= min_run:
        runs += 1
    score = min(1.0, single_char_ratio / threshold) if threshold > 0 else 0.0
    suspicious = token_count >= min_tokens and (
        (threshold > 0 and single_char_ratio >= threshold) or runs > 0
    )
    return {
        "score": score,
        "suspicious": suspicious,
        "singleCharTokenRatio": single_char_ratio,
        "singleCharRuns": float(runs),
    }

def _try_import_attr(module_name: str, attr_name: str) -> bool:
    """Checks whether a module exposes a given attribute."""
    try:
        module = importlib.import_module(module_name)
    except Exception:
        return False
    return hasattr(module, attr_name)


def get_docling_capabilities() -> Dict[str, Any]:
    """Returns best-effort Docling runtime capabilities without heavy imports."""
    global CAPABILITIES_CACHE
    if CAPABILITIES_CACHE is not None:
        return dict(CAPABILITIES_CACHE)

    capabilities: Dict[str, Any] = {
        "doclingVersion": get_docling_version(),
        "pdfBackends": [],
        "tableModes": [],
        "tableStructureOptionsFields": [],
        "cudaAvailable": None,
        "gpuName": None,
        "torchVersion": None,
        "torchCudaVersion": None,
    }

    backend_checks = [
        ("dlparse_v1", "docling.backend.docling_parse_backend", "DoclingParseDocumentBackend"),
        ("dlparse_v2", "docling.backend.docling_parse_v2_backend", "DoclingParseV2DocumentBackend"),
        ("dlparse_v4", "docling.backend.docling_parse_v4_backend", "DoclingParseV4DocumentBackend"),
        ("pypdfium2", "docling.backend.pypdfium2_backend", "PyPdfiumDocumentBackend"),
    ]
    for backend_name, module_name, attr_name in backend_checks:
        if _try_import_attr(module_name, attr_name):
            capabilities["pdfBackends"].append(backend_name)

    try:
        from docling.datamodel.pipeline_options import TableFormerMode, TableStructureOptions

        capabilities["tableModes"] = [
            member.name.lower() for member in TableFormerMode
        ]
        signature = inspect.signature(TableStructureOptions.__init__)
        capabilities["tableStructureOptionsFields"] = [
            param.name for param in signature.parameters.values() if param.name != "self"
        ]
    except Exception:
        capabilities["tableModes"] = []
        capabilities["tableStructureOptionsFields"] = []

    torch_available, torch_version, torch_cuda_version, cuda_available = get_torch_info()
    if torch_available:
        capabilities["torchVersion"] = torch_version
        capabilities["torchCudaVersion"] = torch_cuda_version
        capabilities["cudaAvailable"] = cuda_available
        if cuda_available:
            try:
                import torch

                capabilities["gpuName"] = torch.cuda.get_device_name(0)
            except Exception:
                capabilities["gpuName"] = None

    CAPABILITIES_CACHE = dict(capabilities)
    return dict(capabilities)


def check_module_available(module_name: str) -> Tuple[bool, Optional[str]]:
    """Checks whether a module can be imported."""
    try:
        importlib.import_module(module_name)
        return True, None
    except Exception:
        reason = f"IMPORT_{module_name.upper().replace('.', '_')}_FAILED"
        return False, reason


def get_pymupdf_capabilities() -> Dict[str, Any]:
    """Returns PyMuPDF engine availability with reasons."""
    pymupdf_ok, pymupdf_reason = check_module_available("pymupdf")
    pymupdf4llm_ok, pymupdf4llm_reason = check_module_available("pymupdf4llm")
    layout_ok, layout_reason = check_module_available("pymupdf.layout")
    return {
        "pymupdf": {
            "available": pymupdf_ok,
            "reason": pymupdf_reason,
            "version": get_pymupdf_version() if pymupdf_ok else "UNKNOWN",
        },
        "pymupdf4llm": {
            "available": pymupdf_ok and pymupdf4llm_ok,
            "reason": pymupdf4llm_reason if not pymupdf4llm_ok else pymupdf_reason,
            "version": get_pymupdf4llm_version()
            if pymupdf_ok and pymupdf4llm_ok
            else "UNKNOWN",
        },
        "layout": {
            "available": pymupdf_ok and layout_ok,
            "reason": layout_reason if not layout_ok else pymupdf_reason,
        },
    }


def get_worker_capabilities() -> Dict[str, Any]:
    """Returns combined worker capabilities for docling and PyMuPDF engines."""
    capabilities = get_docling_capabilities()
    capabilities["pymupdf"] = get_pymupdf_capabilities()
    return capabilities


def resolve_docling_config_path(docling_path: Optional[str]) -> Optional[str]:
    """Resolves the Docling config path from args or env defaults."""
    candidate = docling_path or os.getenv("DOCLING_CONFIG_PATH")
    if candidate and str(candidate).strip():
        return str(candidate)
    return os.path.join(os.getcwd(), "config", "docling.json")


def resolve_pymupdf_config_path(pymupdf_path: Optional[str]) -> Optional[str]:
    """Resolves the PyMuPDF config path from args or env defaults."""
    candidate = pymupdf_path or os.getenv("PYMUPDF_CONFIG_PATH")
    if candidate and str(candidate).strip():
        return str(candidate)
    return os.path.join(os.getcwd(), "config", "pymupdf.json")


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


def load_pymupdf_config(pymupdf_path: Optional[str]) -> Dict[str, Any]:
    """Loads the PyMuPDF config from disk with defaults."""
    resolved_path = resolve_pymupdf_config_path(pymupdf_path)
    if not resolved_path:
        raise FileNotFoundError("Missing config/pymupdf.json path.")
    with open(resolved_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


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
    requested_pdf_backend = str(profile_cfg.get("pdfBackend", "dlparse_v2"))
    requested_table_mode = resolve_table_structure_mode(
        str(profile_cfg.get("tableStructureMode", "fast"))
    )
    requested_cell_matching = profile_cfg.get("doCellMatching")
    requested_settings = {
        "profile": profile,
        "pdfBackendRequested": requested_pdf_backend,
        "tableModeRequested": requested_table_mode,
        "doCellMatchingRequested": (
            bool(requested_cell_matching) if requested_cell_matching is not None else None
        ),
    }
    capabilities = get_docling_capabilities()
    fallback_reasons: list[str] = []
    available_backends = set(capabilities.get("pdfBackends", []))
    effective_pdf_backend = requested_pdf_backend
    if available_backends and requested_pdf_backend not in available_backends:
        for fallback in ("dlparse_v4", "dlparse_v2", "dlparse_v1", "pypdfium2"):
            if fallback in available_backends:
                effective_pdf_backend = fallback
                break
        fallback_reasons.append(
            f"PDF_BACKEND_FALLBACK:{requested_pdf_backend}->{effective_pdf_backend}"
        )

    available_modes = set(capabilities.get("tableModes", []))
    effective_table_mode = requested_table_mode
    if available_modes and requested_table_mode not in available_modes:
        effective_table_mode = "fast" if "fast" in available_modes else requested_table_mode
        fallback_reasons.append(
            f"TABLE_MODE_FALLBACK:{requested_table_mode}->{effective_table_mode}"
        )

    requested_cell_value = requested_settings["doCellMatchingRequested"]
    effective_cell_matching: Optional[bool] = requested_cell_value
    supported_fields = set(capabilities.get("tableStructureOptionsFields", []))
    if requested_cell_value is not None and supported_fields:
        if "do_cell_matching" not in supported_fields:
            effective_cell_matching = None
            fallback_reasons.append("DO_CELL_MATCHING_UNSUPPORTED")

    effective_settings = {
        "doclingVersion": capabilities.get("doclingVersion", "UNKNOWN"),
        "pdfBackendEffective": effective_pdf_backend,
        "tableModeEffective": effective_table_mode,
        "doCellMatchingEffective": effective_cell_matching,
        "acceleratorEffective": accelerator.effective_device,
        "fallbackReasons": fallback_reasons,
    }
    return DoclingSettings(
        profile=profile,
        pdf_backend=effective_pdf_backend,
        do_ocr=bool(profile_cfg.get("doOcr", False)),
        do_table_structure=bool(profile_cfg.get("doTableStructure", False)),
        table_structure_mode=effective_table_mode,
        document_timeout_sec=int(profile_cfg.get("documentTimeoutSec", 0)),
        accelerator=accelerator,
        do_cell_matching=effective_cell_matching,
        requested_settings=requested_settings,
        effective_settings=effective_settings,
        fallback_reasons=tuple(fallback_reasons),
        capabilities=capabilities,
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
    engine_meta: Optional[Dict[str, Any]] = None,
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
    docling_summary = {
        "requested": settings.requested_settings,
        "effective": settings.effective_settings,
        "capabilities": settings.capabilities,
    }
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
        "docling": docling_summary,
        **({"engine": engine_meta} if engine_meta else {}),
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


def build_pymupdf_meta(
    doc_id: str,
    input_path: str,
    config: Dict[str, Any],
    python_startup_ms: Optional[int],
    engine_meta: Dict[str, Any],
) -> Dict[str, Any]:
    """Builds the initial meta.json payload for PyMuPDF-based engines."""
    size_bytes = os.path.getsize(input_path)
    timings = {"pythonStartupMs": python_startup_ms}
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
            "timings": timings,
            "worker": {
                "pythonBin": sys.executable,
                "pythonVersion": platform.python_version(),
                "doclingVersion": get_docling_version(),
            },
        },
        "engine": engine_meta,
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


def build_engine_meta(
    requested: Dict[str, Any],
    effective: Dict[str, Any],
    capabilities: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Builds engine proof metadata."""
    payload = {"requested": requested, "effective": effective}
    if capabilities:
        payload["capabilities"] = capabilities
    return payload


def normalize_engine(value: Optional[str]) -> str:
    """Normalizes engine values to supported identifiers."""
    normalized = str(value or ENGINE_DOCLING).strip().lower()
    if normalized in {ENGINE_DOCLING, ENGINE_PYMUPDF4LLM, ENGINE_PYMUPDF_TEXT}:
        return normalized
    return ENGINE_DOCLING


def resolve_layout_mode(
    value: Optional[str], pymupdf_config: Dict[str, Any]
) -> str:
    """Resolves the layout mode for PyMuPDF4LLM."""
    normalized = str(value or "").strip().lower()
    if normalized in {"layout", "standard"}:
        return normalized
    return str(
        pymupdf_config.get("pymupdf4llm", {}).get("layoutModeDefault", "layout")
    )


def run_pymupdf_text_conversion(
    args: argparse.Namespace,
    config: Dict[str, Any],
    pymupdf_config: Dict[str, Any],
    job_id: Optional[str],
    python_startup_ms: Optional[int],
) -> int:
    """Runs a PyMuPDF text extraction workflow."""
    export_dir = os.path.join(args.data_dir, "exports", args.doc_id)
    os.makedirs(export_dir, exist_ok=True)
    meta_path = os.path.join(export_dir, "meta.json")
    text_config = pymupdf_config.get("pymupdf_text", {})
    text_flags = list(text_config.get("textFlags", []))
    text_kind = str(text_config.get("getTextKind", "text"))
    mask, resolved_flags = resolve_pymupdf_text_flags(text_flags)

    engine_requested = {
        "name": ENGINE_PYMUPDF_TEXT,
        "getTextKind": text_kind,
        "flags": {"names": resolved_flags},
    }
    engine_effective = {
        "name": ENGINE_PYMUPDF_TEXT,
        "getTextKind": text_kind,
        "flags": {"mask": mask, "names": resolved_flags},
        "pymupdfVersion": get_pymupdf_version(),
    }
    engine_meta = build_engine_meta(engine_requested, engine_effective)
    startup_ms = (
        python_startup_ms
        if python_startup_ms is not None
        else int((time.perf_counter() - SCRIPT_START) * 1000)
    )
    meta = build_pymupdf_meta(args.doc_id, args.input, config, startup_ms, engine_meta)
    start = time.time()

    try:
        emit_progress("INIT", "Preparing PyMuPDF extraction.", 5, job_id)
        if not args.input.lower().endswith(".pdf"):
            raise ValueError("PyMuPDF engines require PDF input.")
        import pymupdf

        doc = pymupdf.open(args.input)
        pages_text: list[str] = []
        total_pages = doc.page_count
        try:
            for index in range(total_pages):
                page = doc.load_page(index)
                text = page.get_text(text_kind, flags=mask)
                pages_text.append(text)
                progress = 15 + int(((index + 1) / max(total_pages, 1)) * 55)
                emit_progress(
                    "EXTRACT_PYMUPDF",
                    f"Page {index + 1}/{total_pages}",
                    progress,
                    job_id,
                )
        finally:
            doc.close()

        markdown = "\n\n---\n\n".join(pages_text)
        emit_progress("METRICS", "Computing metrics.", 75, job_id)
        metrics = compute_text_metrics(pages_text, markdown)
        split_spacing = compute_split_spacing(pages_text, pymupdf_config)
        if split_spacing:
            metrics["splitSpacing"] = split_spacing

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
            output_payload = {
                "engine": ENGINE_PYMUPDF_TEXT,
                "flags": {"mask": mask, "names": resolved_flags},
                "pages": [
                    {"page": idx + 1, "text": text}
                    for idx, text in enumerate(pages_text)
                ],
            }
            with open(json_path, "w", encoding="utf-8") as handle:
                json.dump(output_payload, handle)
            meta["outputs"] = {
                "markdownPath": md_path,
                "jsonPath": json_path,
                "bytes": {
                    "markdown": len(markdown.encode("utf-8")),
                    "json": len(json.dumps(output_payload).encode("utf-8")),
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


def normalize_pymupdf4llm_result(
    result: Any,
) -> Tuple[str, Optional[Any]]:
    """Normalizes PyMuPDF4LLM markdown output and page chunks."""
    markdown = ""
    page_chunks = None
    if isinstance(result, str):
        return result, None
    if isinstance(result, tuple) and result:
        if isinstance(result[0], str):
            markdown = result[0]
        if len(result) > 1:
            page_chunks = result[1]
        return markdown, page_chunks
    if isinstance(result, dict):
        if isinstance(result.get("markdown"), str):
            markdown = result["markdown"]
        elif isinstance(result.get("text"), str):
            markdown = result["text"]
        elif isinstance(result.get("md"), str):
            markdown = result["md"]
        page_chunks = result.get("page_chunks") or result.get("pageChunks")
    return markdown, page_chunks


def run_pymupdf4llm_conversion(
    args: argparse.Namespace,
    config: Dict[str, Any],
    pymupdf_config: Dict[str, Any],
    layout_mode: str,
    job_id: Optional[str],
    python_startup_ms: Optional[int],
) -> int:
    """Runs a PyMuPDF4LLM extraction workflow with optional layout mode."""
    export_dir = os.path.join(args.data_dir, "exports", args.doc_id)
    os.makedirs(export_dir, exist_ok=True)
    meta_path = os.path.join(export_dir, "meta.json")
    llm_config = pymupdf_config.get("pymupdf4llm", {})
    to_markdown_config = dict(llm_config.get("toMarkdown", {}))
    to_markdown_config["show_progress"] = False
    layout_requested = layout_mode == "layout"
    layout_enabled = bool(llm_config.get("layoutEnabled", True))
    layout_effective = False
    fallback_reasons: list[str] = []
    if layout_requested:
        if layout_enabled:
            try:
                import pymupdf.layout  # noqa: F401

                layout_effective = True
            except Exception:
                fallback_reasons.append("LAYOUT_IMPORT_FAILED")
        else:
            fallback_reasons.append("LAYOUT_DISABLED")

    layout_mode_effective = "layout" if layout_effective else "standard"
    engine_requested = {
        "name": ENGINE_PYMUPDF4LLM,
        "layoutMode": layout_mode,
        "toMarkdown": to_markdown_config,
    }
    engine_effective = {
        "name": ENGINE_PYMUPDF4LLM,
        "layoutMode": layout_mode_effective,
        "layoutEnabledEffective": layout_effective,
        "fallbackReasons": fallback_reasons,
        "pymupdfVersion": get_pymupdf_version(),
        "pymupdf4llmVersion": get_pymupdf4llm_version(),
    }
    engine_meta = build_engine_meta(engine_requested, engine_effective)
    startup_ms = (
        python_startup_ms
        if python_startup_ms is not None
        else int((time.perf_counter() - SCRIPT_START) * 1000)
    )
    meta = build_pymupdf_meta(args.doc_id, args.input, config, startup_ms, engine_meta)
    start = time.time()

    try:
        emit_progress("INIT", "Preparing PyMuPDF4LLM extraction.", 5, job_id)
        if not args.input.lower().endswith(".pdf"):
            raise ValueError("PyMuPDF engines require PDF input.")
        import pymupdf
        import pymupdf4llm

        doc = pymupdf.open(args.input)
        pages_text: list[str] = []
        markdown_pages: list[str] = []
        page_chunks: list[Any] = []
        json_pages: list[Any] = []
        total_pages = doc.page_count
        try:
            to_json_fn = getattr(pymupdf4llm, "to_json", None)
            for index in range(total_pages):
                progress = 15 + int(((index + 1) / max(total_pages, 1)) * 55)
                emit_progress(
                    "EXTRACT_PYMUPDF4LLM",
                    f"Page {index + 1}/{total_pages}",
                    progress,
                    job_id,
                )
                md_result = pymupdf4llm.to_markdown(
                    doc, pages=[index], **to_markdown_config
                )
                markdown, chunks = normalize_pymupdf4llm_result(md_result)
                markdown_pages.append(markdown)
                pages_text.append(markdown)
                if chunks is not None:
                    page_chunks.append(chunks)
                if layout_effective and callable(to_json_fn):
                    try:
                        json_pages.append(to_json_fn(doc, pages=[index]))
                    except Exception:
                        fallback_reasons.append("TO_JSON_FAILED")
                        json_pages = []
                        to_json_fn = None
        finally:
            doc.close()

        layout_mode_effective = "layout" if layout_effective else "standard"
        engine_effective["layoutMode"] = layout_mode_effective
        engine_effective["layoutEnabledEffective"] = layout_effective
        engine_effective["fallbackReasons"] = fallback_reasons

        markdown = "\n\n---\n\n".join(markdown_pages)
        emit_progress("METRICS", "Computing metrics.", 75, job_id)
        metrics = compute_text_metrics(pages_text, markdown)
        split_spacing = compute_split_spacing(pages_text, pymupdf_config)
        if split_spacing:
            metrics["splitSpacing"] = split_spacing

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
            output_payload: Dict[str, Any]
            if layout_mode_effective == "layout" and json_pages:
                output_payload = {
                    "engine": ENGINE_PYMUPDF4LLM,
                    "layoutMode": layout_mode_effective,
                    "pages": json_pages,
                }
            else:
                output_payload = {
                    "engine": ENGINE_PYMUPDF4LLM,
                    "layoutMode": layout_mode_effective,
                    "pages": page_chunks
                    if page_chunks
                    else [
                        {"page": idx + 1, "markdown": text}
                        for idx, text in enumerate(markdown_pages)
                    ],
                }
            with open(json_path, "w", encoding="utf-8") as handle:
                json.dump(output_payload, handle)
            meta["outputs"] = {
                "markdownPath": md_path,
                "jsonPath": json_path,
                "bytes": {
                    "markdown": len(markdown.encode("utf-8")),
                    "json": len(json.dumps(output_payload).encode("utf-8")),
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


def run_pymupdf_conversion(
    args: argparse.Namespace,
    config: Dict[str, Any],
    engine: str,
    job_id: Optional[str],
    python_startup_ms: Optional[int],
) -> int:
    """Routes conversion for PyMuPDF engines."""
    pymupdf_config = load_pymupdf_config(getattr(args, "pymupdf_config", None))
    if engine == ENGINE_PYMUPDF_TEXT:
        return run_pymupdf_text_conversion(
            args, config, pymupdf_config, job_id, python_startup_ms
        )
    layout_mode = resolve_layout_mode(getattr(args, "layout_mode", None), pymupdf_config)
    return run_pymupdf4llm_conversion(
        args, config, pymupdf_config, layout_mode, job_id, python_startup_ms
    )


def run_conversion(
    args: argparse.Namespace,
    job_id: Optional[str] = None,
    python_startup_ms: Optional[int] = None,
) -> int:
    """Runs the conversion workflow for the requested engine."""
    config = load_config(args.gates)
    engine = normalize_engine(getattr(args, "engine", None))
    if engine != ENGINE_DOCLING:
        return run_pymupdf_conversion(
            args, config, engine, job_id, python_startup_ms
        )

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
    engine_meta = build_engine_meta(
        {"name": ENGINE_DOCLING},
        {
            "name": ENGINE_DOCLING,
            "doclingVersion": settings.effective_settings.get(
                "doclingVersion", get_docling_version()
            ),
        },
    )
    meta = build_base_meta(
        args.doc_id, args.input, config, settings, startup_ms, engine_meta
    )
    record_docling_proof(args.doc_id, settings)
    log_docling_effective(args.doc_id, settings)
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
        if message.get("type") == "capabilities":
            emit_event(
                {
                    "event": "capabilities",
                    "requestId": message.get("requestId"),
                    "capabilities": get_worker_capabilities(),
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
        layout_mode = message.get("layoutMode")
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
            pymupdf_config=pymupdf_config_path,
            engine=engine,
            layout_mode=layout_mode,
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
    parser.add_argument("--pymupdf-config")
    parser.add_argument("--engine")
    parser.add_argument("--layout-mode")
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
