"""Benchmarks keep-warm worker reuse by measuring time to first progress event."""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path


def read_event(stream) -> dict | None:
    """Reads and parses a JSON event from the worker stdout."""
    line = stream.readline()
    if not line:
        return None
    try:
        return json.loads(line.strip())
    except json.JSONDecodeError:
        return None


def wait_for_ready(stream, timeout_sec: float) -> None:
    """Waits for the worker ready event."""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        event = read_event(stream)
        if not event:
            continue
        if event.get("event") == "ready":
            return
    raise TimeoutError("Timed out waiting for worker ready event.")


def run_job(stream, writer, payload: dict, timeout_sec: float) -> int:
    """Sends a job payload and returns ms to first progress event."""
    start = time.perf_counter()
    writer.write(json.dumps(payload) + "\n")
    writer.flush()
    first_progress_ms = None
    deadline = time.time() + timeout_sec

    while time.time() < deadline:
        event = read_event(stream)
        if not event:
            continue
        if event.get("event") == "progress" and event.get("jobId") == payload["jobId"]:
            if first_progress_ms is None:
                first_progress_ms = int((time.perf_counter() - start) * 1000)
        if event.get("event") == "result" and event.get("jobId") == payload["jobId"]:
            return first_progress_ms or int((time.perf_counter() - start) * 1000)
    raise TimeoutError("Timed out waiting for worker result event.")


def main() -> None:
    """Runs the keep-warm reuse benchmark."""
    parser = argparse.ArgumentParser(description="Benchmark keep-warm worker reuse")
    parser.add_argument("--input", required=True, help="Path to a PDF or DOCX file.")
    parser.add_argument(
        "--python-bin",
        default=os.getenv("PYTHON_BIN", "python"),
        help="Python executable for the worker.",
    )
    parser.add_argument(
        "--worker",
        default=os.getenv(
            "DOCLING_WORKER", str(Path("services/docling_worker/convert.py"))
        ),
        help="Path to the worker entrypoint.",
    )
    parser.add_argument(
        "--gates",
        default=os.getenv("GATES_CONFIG_PATH", "config/quality-gates.json"),
        help="Path to the quality gates config.",
    )
    parser.add_argument(
        "--docling-config",
        default=os.getenv("DOCLING_CONFIG_PATH", "config/docling.json"),
        help="Path to the docling config.",
    )
    parser.add_argument(
        "--timeout-sec",
        type=float,
        default=60,
        help="Timeout per job in seconds.",
    )
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        raise SystemExit(f"Input not found: {input_path}")

    with tempfile.TemporaryDirectory(prefix="docling-bench-") as temp_dir:
        process = subprocess.Popen(
            [args.python_bin, args.worker, "--worker"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=os.environ.copy(),
        )
        if not process.stdin or not process.stdout:
            raise SystemExit("Failed to open worker pipes.")

        wait_for_ready(process.stdout, args.timeout_sec)

        def build_payload(doc_id: str) -> dict:
            return {
                "type": "job",
                "jobId": doc_id,
                "docId": doc_id,
                "input": str(input_path),
                "dataDir": temp_dir,
                "gates": str(Path(args.gates).resolve()),
                "doclingConfig": str(Path(args.docling_config).resolve()),
            }

        first_id = f"bench_{uuid.uuid4().hex}"
        second_id = f"bench_{uuid.uuid4().hex}"

        first_ms = run_job(process.stdout, process.stdin, build_payload(first_id), args.timeout_sec)
        second_ms = run_job(process.stdout, process.stdin, build_payload(second_id), args.timeout_sec)

        try:
            process.stdin.write(json.dumps({"type": "shutdown"}) + "\n")
            process.stdin.flush()
        except BrokenPipeError:
            pass
        process.wait(timeout=5)

    print(f"spawn_ms_first={first_ms} spawn_ms_second={second_ms}")


if __name__ == "__main__":
    main()
