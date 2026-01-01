"""Smoke tests for worker runtime dependencies."""

from __future__ import annotations

import json
from pathlib import Path

import pytest


def load_pymupdf_config() -> dict:
    config_path = Path(__file__).resolve().parents[2] / "config" / "pymupdf.json"
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        pytest.fail("Missing config/pymupdf.json; required to check layout support.")
    except json.JSONDecodeError as exc:
        pytest.fail(f"Invalid config/pymupdf.json: {exc}")


def test_worker_dependencies_importable():
    try:
        import pymupdf  # noqa: F401
    except Exception as exc:
        pytest.fail(f"Missing runtime dependency: pymupdf ({exc})")

    try:
        import pymupdf4llm  # noqa: F401
    except Exception as exc:
        pytest.fail(f"Missing runtime dependency: pymupdf4llm ({exc})")

    config = load_pymupdf_config()
    layout_enabled = bool(config.get("pymupdf4llm", {}).get("layoutEnabled", True))
    if not layout_enabled:
        return

    try:
        import pymupdf.layout  # noqa: F401
    except Exception as exc:
        pytest.fail(
            f"Missing runtime dependency: pymupdf-layout (layoutEnabled=true): {exc}"
        )
