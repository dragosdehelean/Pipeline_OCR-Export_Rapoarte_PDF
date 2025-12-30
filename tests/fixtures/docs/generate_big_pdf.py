import argparse
from pathlib import Path


def build_pdf(page_count: int, output_path: Path, repeat: int) -> None:
    text = ("Lorem ipsum dolor sit amet, consectetur adipiscing elit. " * repeat).strip()
    header = b"%PDF-1.4\n"

    objects: list[tuple[int, bytes]] = []
    kids = []
    font_obj = 3
    first_content_obj = 4

    for index in range(page_count):
        content_obj = first_content_obj + index * 2
        page_obj = content_obj + 1
        kids.append(f"{page_obj} 0 R")

        stream = f"BT /F1 12 Tf 72 720 Td ({text} Page {index + 1}) Tj ET"
        stream_bytes = stream.encode("ascii")
        content = (
            f"<< /Length {len(stream_bytes)} >>\nstream\n{stream}\nendstream"
        ).encode("ascii")
        objects.append((content_obj, content))

        page = (
            "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 "
            f"{font_obj} 0 R >> >> /MediaBox [0 0 612 792] /Contents {content_obj} 0 R >>"
        ).encode("ascii")
        objects.append((page_obj, page))

    pages = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {page_count} >>".encode(
        "ascii"
    )
    catalog = b"<< /Type /Catalog /Pages 2 0 R >>"
    font = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    ordered_objects = [(1, catalog), (2, pages), (3, font)] + objects
    offsets = [0] * (len(ordered_objects) + 1)

    body = bytearray()
    body.extend(header)
    for obj_num, content in ordered_objects:
        offsets[obj_num] = len(body)
        body.extend(f"{obj_num} 0 obj\n".encode("ascii"))
        body.extend(content)
        body.extend(b"\nendobj\n")

    xref_offset = len(body)
    body.extend(f"xref\n0 {len(ordered_objects) + 1}\n".encode("ascii"))
    body.extend(b"0000000000 65535 f \n")
    for obj_num in range(1, len(ordered_objects) + 1):
        body.extend(f"{offsets[obj_num]:010} 00000 n \n".encode("ascii"))
    body.extend(
        f"trailer\n<< /Size {len(ordered_objects) + 1} /Root 1 0 R >>\n".encode(
            "ascii"
        )
    )
    body.extend(f"startxref\n{xref_offset}\n%%EOF\n".encode("ascii"))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(body)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a large PDF fixture.")
    parser.add_argument("--pages", type=int, default=150)
    parser.add_argument("--repeat", type=int, default=120)
    parser.add_argument("--output", default="tests/fixtures/docs/big.pdf")
    args = parser.parse_args()

    output_path = Path(args.output)
    build_pdf(args.pages, output_path, args.repeat)
    print(f"Wrote {args.pages} pages to {output_path}")


if __name__ == "__main__":
    main()
