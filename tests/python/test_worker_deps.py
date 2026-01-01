"""Smoke tests for worker runtime dependencies."""


def test_worker_dependencies_importable():
    import pymupdf  # noqa: F401
    import pymupdf4llm  # noqa: F401
    import pymupdf.layout  # noqa: F401
