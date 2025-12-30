"""Generates PDF fixtures that exercise quality gate thresholds."""
import json
import math
from pathlib import Path

from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas


ROOT_DIR = Path(__file__).resolve().parents[3]
CONFIG_PATH = ROOT_DIR / "config" / "quality-gates.json"
OUTPUT_DIR = Path(__file__).resolve().parent


def load_config() -> dict:
    """Loads the gate config used to size the fixtures."""
    with CONFIG_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_text_pdf(path: Path, title: str, lines: list[str], columns: int) -> None:
    """Writes a multi-column text PDF fixture."""
    pdf = canvas.Canvas(str(path), pagesize=LETTER)
    width, height = LETTER
    margin = 48
    line_height = 12
    col_width = (width - 2 * margin) / columns
    rows_per_page = int((height - 2 * margin) / line_height) - 1

    pdf.setFont("Helvetica", 10)
    y = height - margin
    pdf.drawString(margin, y, title)

    for index, line in enumerate(lines):
        if index > 0 and index % (rows_per_page * columns) == 0:
            pdf.showPage()
            pdf.setFont("Helvetica", 10)
            pdf.drawString(margin, height - margin, title)

        page_index = index % (rows_per_page * columns)
        row = page_index // columns
        col = page_index % columns
        x = margin + col * col_width
        y = height - margin - ((row + 1) * line_height)
        text = pdf.beginText(x, y)
        text.textLine(line)
        pdf.drawText(text)

    pdf.save()


def write_scan_like_pdf(path: Path, title: str) -> None:
    """Writes a scan-like PDF with low text content."""
    pdf = canvas.Canvas(str(path), pagesize=LETTER)
    width, height = LETTER
    margin = 48

    pdf.setFillGray(0.92)
    pdf.rect(margin, margin, width - 2 * margin, height - 2 * margin, fill=1)
    pdf.setFillGray(0.75)
    pdf.rect(margin + 20, margin + 20, width - 2 * margin - 40, height - 2 * margin - 40, fill=1)
    pdf.save()


def derive_bounds(config: dict) -> dict:
    """Derives numeric bounds per metric from gate rules."""
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


def required_metrics(config: dict) -> dict:
    """Returns a metrics dict that satisfies all FAIL gates."""
    bounds = derive_bounds(config)
    return {metric: choose_value(entry) for metric, entry in bounds.items()}


def build_good_lines(config: dict) -> list[str]:
    """Builds enough lines to satisfy text-related gate thresholds."""
    required = required_metrics(config)
    min_text_chars = int(required.get("textChars", 0))
    min_md_chars = int(required.get("mdChars", 0))
    min_text_items = int(required.get("textItems", 0))
    min_chars_per_page = int(required.get("textCharsPerPageAvg", 0))

    base_line = "Fixture text block 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ."
    line_template = "{index:04d} " + base_line
    line_len = len(line_template.format(index=0))
    words_per_line = len(line_template.format(index=0).split())

    min_chars = max(min_text_chars, min_md_chars, min_chars_per_page)
    lines_for_chars = math.ceil(min_chars / max(line_len, 1))
    lines_for_words = math.ceil(min_text_items / max(words_per_line, 1))
    total_lines = max(lines_for_chars, lines_for_words)

    lines_per_page = estimate_lines_per_page(columns=3)
    total_lines = ensure_min_avg(total_lines, line_len, lines_per_page, min_chars_per_page)

    return [line_template.format(index=index) for index in range(total_lines)]


def estimate_lines_per_page(columns: int) -> int:
    """Estimates how many lines fit per page for layout sizing."""
    width, height = LETTER
    margin = 48
    line_height = 12
    rows_per_page = int((height - 2 * margin) / line_height) - 1
    return rows_per_page * columns


def ensure_min_avg(total_lines: int, line_len: int, lines_per_page: int, min_avg: int) -> int:
    """Ensures the average text chars per page clears the minimum."""
    if min_avg <= 0:
        return total_lines
    while True:
        pages = math.ceil(total_lines / max(lines_per_page, 1))
        avg = (total_lines * line_len) / max(pages, 1)
        if avg >= min_avg:
            return total_lines
        total_lines += max(lines_per_page, 1)


def main() -> None:
    """Generates the fixture PDFs on disk."""
    config = load_config()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    good_lines = build_good_lines(config)
    columns = 3

    write_text_pdf(
        OUTPUT_DIR / "short_valid_text.pdf",
        "Short valid text fixture",
        good_lines,
        columns,
    )
    write_scan_like_pdf(OUTPUT_DIR / "scan_like_no_text.pdf", "Scan-like fixture")

    print("Generated fixtures:")
    print(" -", OUTPUT_DIR / "short_valid_text.pdf")
    print(" -", OUTPUT_DIR / "scan_like_no_text.pdf")


if __name__ == "__main__":
    main()
