"""Runs a one-off conversion benchmark for a single input file."""
import argparse
import time
from pathlib import Path

from services.docling_worker import convert


def main() -> None:
    """Runs the benchmark using the Docling worker conversion flow."""
    parser = argparse.ArgumentParser(description="Docling conversion benchmark")
    parser.add_argument("--input", required=True, help="Path to a PDF or DOCX file.")
    parser.add_argument(
        "--data-dir",
        default="data",
        help="Output data directory (default: data).",
    )
    parser.add_argument(
        "--gates",
        default="config/quality-gates.json",
        help="Path to the quality gate config.",
    )
    parser.add_argument(
        "--docling-config",
        default="config/docling.json",
        help="Path to the docling config.",
    )
    parser.add_argument("--doc-id", help="Optional document id override.")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        raise SystemExit(f"Input not found: {input_path}")

    doc_id = args.doc_id or f"bench_{int(time.time())}"
    job_args = argparse.Namespace(
        input=str(input_path),
        doc_id=doc_id,
        data_dir=str(Path(args.data_dir).resolve()),
        gates=str(Path(args.gates).resolve()),
        docling_config=str(Path(args.docling_config).resolve()),
    )

    start = time.perf_counter()
    exit_code = convert.run_conversion(job_args)
    duration_ms = int((time.perf_counter() - start) * 1000)
    print(f"exit_code={exit_code} duration_ms={duration_ms} doc_id={doc_id}")


if __name__ == "__main__":
    main()
