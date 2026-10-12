"""Show how a PDF chunks, without a database or an embedding model.

Runs the real pipeline modules - ``ocr.extract_pages`` then
``chunker.chunk_document`` - and prints every chunk with the page, verse number
and split reason. Use it to tune boundary detection against a new book before
committing to a full ingestion run.

    python scripts/inspect_chunks.py corpus/test-sample.pdf

Needs pypdf. Tesseract is optional: without it, image-only pages are reported as
skipped with a reason, which still shows that they took the OCR branch rather
than the text-layer branch.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "siddhamind-ai"))

from app.ingestion import chunker, ocr  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--chunk-size", type=int, default=900)
    parser.add_argument("--chunk-overlap", type=int, default=150)
    parser.add_argument("--min-chars", type=int, default=60)
    parser.add_argument("--min-confidence", type=float, default=45.0)
    parser.add_argument("--preview", type=int, default=100, help="chars of content to show")
    parser.add_argument("--full", action="store_true", help="print whole chunk bodies")
    args = parser.parse_args()

    pdf = args.pdf if args.pdf.is_absolute() else REPO / args.pdf
    if not pdf.is_file():
        print(f"not found: {pdf}")
        return 1

    binaries = ocr.check_binaries()
    print(f"file            {pdf}")
    print(f"tesseract       {binaries.get('tesseract') or binaries.get('tesseract_error')}")
    print(f"poppler         {binaries.get('poppler') or binaries.get('poppler_error')}")
    print()

    results = list(
        ocr.extract_pages(pdf, min_confidence=args.min_confidence, progress_every=0)
    )

    print("PAGES")
    print(f"  {'page':>4}  {'source':<12} {'conf':>6}  {'chars':>6}  status")
    pages: list[tuple[int, str]] = []
    for page in results:
        status = f"SKIPPED - {page.reason}" if page.skipped else "indexed"
        confidence = f"{page.confidence:.1f}" if page.confidence is not None else "-"
        print(
            f"  {page.page_no:>4}  {page.source:<12} {confidence:>6}  "
            f"{len(page.text.strip()):>6}  {status}"
        )
        if not page.skipped and page.text.strip():
            pages.append((page.page_no, page.text))

    stats = ocr.summarise(results)
    print(f"\n  {stats}\n")

    rows = chunker.chunk_document(
        pages,
        source_document_id=0,
        book_name=pdf.stem,
        chunk_size=args.chunk_size,
        chunk_overlap=args.chunk_overlap,
        min_chars=args.min_chars,
    )

    print(f"CHUNKS ({len(rows)}, {chunker.structural_ratio(rows):.0%} split on a "
          f"detected boundary)")
    print(f"  {'idx':>3}  {'page':>4}  {'verse':<8} {'split':<10} {'chars':>5}  {'tok':>4}  content")
    for row in rows:
        body = " ".join(row["content"].split())
        preview = body if args.full else body[: args.preview] + ("..." if len(body) > args.preview else "")
        print(
            f"  {row['chunk_index']:>3}  {row['page_no']:>4}  "
            f"{(row['verse_no'] or '-'):<8} "
            f"{('structural' if row['structural'] else 'window'):<10} "
            f"{len(row['content']):>5}  {row['token_count']:>4}  {preview}"
        )

    by_page: dict[int, int] = {}
    for row in rows:
        by_page[row["page_no"]] = by_page.get(row["page_no"], 0) + 1
    print("\n  chunks per page:", dict(sorted(by_page.items())))
    verses = sorted({r["verse_no"] for r in rows if r["verse_no"]})
    print("  verse numbers detected:", verses or "none")
    return 0


if __name__ == "__main__":
    sys.exit(main())
