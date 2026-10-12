"""End-to-end ingestion against a real PDF.

Everything here skips - loudly, with a reason naming what is missing - rather
than failing, because the suite has to stay green on a machine with no corpus,
no Tesseract and no torch. That is the normal state for anyone running the unit
tests, and a red suite that everybody learns to ignore is worse than a skipped
one.

To actually exercise these:

    pip install -r requirements.txt          # Python 3.12
    # Tesseract 5 with the 'tam' pack + poppler on PATH (or TESSERACT_CMD /
    # POPPLER_PATH); Docker already has both
    cp <a Siddha PDF> corpus/
    pytest tests/test_ingestion_integration.py -v -s
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
CORPUS_DIRS = [REPO_ROOT / "corpus", Path(__file__).resolve().parents[1] / "corpus"]


def _find_pdf() -> Path | None:
    for directory in CORPUS_DIRS:
        if not directory.is_dir():
            continue
        for pdf in sorted(directory.glob("*.pdf")):
            return pdf
    return None


def _missing(*modules: str) -> list[str]:
    return [m for m in modules if importlib.util.find_spec(m) is None]


CORPUS_PDF = _find_pdf()

needs_pdf = pytest.mark.skipif(
    CORPUS_PDF is None,
    reason=f"no PDF in {' or '.join(str(d) for d in CORPUS_DIRS)} - "
    "drop a Siddha PDF there to exercise the OCR path",
)
needs_ocr_libs = pytest.mark.skipif(
    bool(_missing("pypdf", "pdf2image", "pytesseract", "cv2", "numpy")),
    reason=f"OCR libraries not installed: {', '.join(_missing('pypdf', 'pdf2image', 'pytesseract', 'cv2', 'numpy')) or 'n/a'}"
    " - pip install -r requirements.txt on Python 3.12",
)


def _binary_status() -> dict:
    """Probe the OCR binaries, tolerating the libraries being absent."""
    if _missing("pytesseract", "pdf2image"):
        return {"ok": False, "tesseract_error": "pytesseract/pdf2image not installed"}
    from app.ingestion import ocr

    return ocr.check_binaries(os.getenv("TESSERACT_CMD", ""), os.getenv("POPPLER_PATH", ""),
                              os.getenv("TESSDATA_DIR", ""))


_BINARIES = _binary_status()

# Separate from needs_ocr_libs on purpose. pytesseract and pdf2image are thin
# wrappers that shell out; having them installed says nothing about whether
# tesseract.exe and pdftoppm exist. Skipping on the libraries alone made these
# tests *fail* with OcrUnavailableError on a machine that had run
# `pip install -r requirements.txt` but not installed the binaries - an
# environmental gap reported as a code failure.
needs_ocr_binaries = pytest.mark.skipif(
    not _BINARIES.get("ok"),
    reason="Tesseract/poppler binaries unavailable ("
    + "; ".join(str(v) for k, v in _BINARIES.items() if k.endswith("_error"))
    + ") - install them, or set TESSERACT_CMD / POPPLER_PATH",
)
needs_torch = pytest.mark.skipif(
    bool(_missing("sentence_transformers", "torch")),
    reason="sentence-transformers/torch not installed (~2.5 GB) - the first run "
    "also downloads bge-m3 (~2 GB)",
)
needs_db = pytest.mark.skipif(
    not os.getenv("PYTHON_DB_URL"),
    reason="PYTHON_DB_URL not set - fill in .env to run the database leg",
)


@pytest.fixture(scope="module")
def settings():
    pytest.importorskip("pydantic_settings", reason="pydantic-settings not installed")
    from app.config import Settings

    return Settings(corpus_dir=str(CORPUS_PDF.parent) if CORPUS_PDF else "corpus")


# --------------------------------------------------------------------------
# environment report - always runs, so a skipped suite still explains itself
# --------------------------------------------------------------------------


def test_report_what_is_available(capsys):
    """Never fails. Prints why the rest skipped, which is the useful part."""
    with capsys.disabled():
        print("\n  corpus PDF ......... ", CORPUS_PDF or "none found")
        missing_ocr = _missing("pypdf", "pdf2image", "pytesseract", "cv2", "numpy")
        print("  OCR libraries ...... ", "missing: " + ", ".join(missing_ocr) if missing_ocr else "ok")
        missing_ml = _missing("sentence_transformers", "torch")
        print("  embedding stack .... ", "missing: " + ", ".join(missing_ml) if missing_ml else "ok")
        print("  PYTHON_DB_URL ...... ", "set" if os.getenv("PYTHON_DB_URL") else "not set")

        if not missing_ocr:
            from app.ingestion import ocr

            status = ocr.check_binaries(
                os.getenv("TESSERACT_CMD", ""), os.getenv("POPPLER_PATH", ""),
                os.getenv("TESSDATA_DIR", "")
            )
            print("  tesseract .......... ", status.get("tesseract") or status.get("tesseract_error"))
            print("  poppler ............ ", status.get("poppler") or status.get("poppler_error"))
            languages = status.get("languages") or []
            print("  tamil pack ......... ", "yes" if "tam" in languages else "NO - Tamil will OCR badly")


# --------------------------------------------------------------------------
# OCR
# --------------------------------------------------------------------------


@needs_pdf
@needs_ocr_libs
@needs_ocr_binaries
def test_extracts_pages_from_a_real_pdf():
    from app.ingestion import ocr

    ocr.require_binaries(os.getenv("TESSERACT_CMD", ""), os.getenv("POPPLER_PATH", ""),
                        os.getenv("TESSDATA_DIR", ""))

    results = []
    for page in ocr.extract_pages(
        CORPUS_PDF,
        poppler_path=os.getenv("POPPLER_PATH") or None,
        progress_every=0,
    ):
        results.append(page)
        if len(results) >= 5:  # five pages is enough to prove the path works
            break

    assert results, "the PDF yielded no pages at all"

    stats = ocr.summarise(results)
    print(f"\n  {CORPUS_PDF.name}: {stats}")

    # The invariant that matters: every page landed in exactly one bucket.
    assert stats["text_layer"] + stats["ocr"] + stats["skipped"] == stats["pages"]
    for page in results:
        assert page.skipped == (not page.text.strip()) or page.text.strip()
        if page.skipped:
            assert page.reason, f"page {page.page_no} skipped with no reason recorded"


@needs_pdf
@needs_ocr_libs
@needs_ocr_binaries
def test_page_count_matches_the_pdf():
    from app.ingestion import ocr

    assert ocr.page_count(CORPUS_PDF) > 0


# --------------------------------------------------------------------------
# OCR -> chunk
# --------------------------------------------------------------------------


@needs_pdf
@needs_ocr_libs
@needs_ocr_binaries
def test_real_pages_chunk_into_rows():
    from app.ingestion import chunker, ocr

    ocr.require_binaries(os.getenv("TESSERACT_CMD", ""), os.getenv("POPPLER_PATH", ""),
                        os.getenv("TESSDATA_DIR", ""))

    pages = []
    for page in ocr.extract_pages(
        CORPUS_PDF, poppler_path=os.getenv("POPPLER_PATH") or None, progress_every=0
    ):
        if not page.skipped and page.text.strip():
            pages.append((page.page_no, page.text))
        if len(pages) >= 5:
            break

    if not pages:
        pytest.skip("every sampled page was skipped - check OCR quality and the tam pack")

    rows = chunker.chunk_document(pages, source_document_id=1, book_name=CORPUS_PDF.stem)
    assert rows, "real pages produced no chunks"

    indices = [r["chunk_index"] for r in rows]
    assert indices == list(range(len(rows))), "chunk_index must be gapless and unique"

    ratio = chunker.structural_ratio(rows)
    verses = {r["verse_no"] for r in rows if r["verse_no"]}
    print(f"\n  {len(rows)} chunks, {ratio:.0%} structural, verse numbers found: {sorted(verses)[:10]}")

    for row in rows:
        assert row["content"].strip()
        assert row["page_no"] in dict(pages)
        assert row["token_count"] > 0


# --------------------------------------------------------------------------
# full pipeline, no database
# --------------------------------------------------------------------------


@needs_pdf
@needs_ocr_libs
@needs_ocr_binaries
@needs_torch
def test_chunks_embed_to_the_configured_width(settings):
    """The one check that cannot be faked: the real model against the real
    column width."""
    from app.ingestion import chunker, embedder, ocr

    ocr.require_binaries(settings.tesseract_cmd, settings.poppler_path,
                        settings.tessdata_dir)

    pages = []
    for page in ocr.extract_pages(
        CORPUS_PDF, poppler_path=settings.poppler_path or None, progress_every=0
    ):
        if not page.skipped and page.text.strip():
            pages.append((page.page_no, page.text))
        if len(pages) >= 2:
            break
    if not pages:
        pytest.skip("no readable pages to embed")

    model = embedder.load_model(settings.embedding_model)
    rows = chunker.chunk_document(
        pages,
        source_document_id=1,
        book_name=CORPUS_PDF.stem,
        token_counter=embedder.tokeniser_for(model),
    )[:8]

    embedded = embedder.embed_chunks(
        rows,
        expected_dim=settings.embedding_dim,
        model=model,
        model_name=settings.embedding_model,
        batch_size=settings.embedding_batch_size,
    )
    assert embedded
    for row in embedded:
        assert len(row["embedding"]) == settings.embedding_dim


# --------------------------------------------------------------------------
# the database leg
# --------------------------------------------------------------------------


@needs_pdf
@needs_ocr_libs
@needs_ocr_binaries
@needs_torch
@needs_db
def test_ingest_document_writes_chunks_and_status(settings):
    """Full run against Supabase. Requires a seeded source_documents row whose
    file_path points at the PDF in corpus/."""
    import asyncio

    from app.clients import database
    from app.ingestion import pipeline

    doc_id = int(os.getenv("INGEST_TEST_DOC_ID", "1"))

    async def run():
        await database.connect(settings)
        try:
            document = await database.fetch_document(doc_id)
            if document is None:
                pytest.skip(
                    f"no source_documents row with doc_id={doc_id} - seed the database "
                    "first, or set INGEST_TEST_DOC_ID"
                )
            outcome = await pipeline.ingest_document(doc_id, settings)
            after = await database.fetch_document(doc_id)
            return outcome, after
        finally:
            await database.close()

    outcome, after = asyncio.run(run())

    print(f"\n  outcome: {outcome}")
    assert outcome["status"] == "COMPLETE", outcome.get("error")
    assert after["ingest_status"] == "COMPLETE"
    assert after["indexed"] is True
    assert after["chunk_count"] == outcome["chunkCount"] > 0
    # skipped_pages must be recorded even when it is zero, or the "no silent
    # loss" guarantee is unverifiable from the dashboard.
    assert after["skipped_pages"] is not None
    assert after["ingest_error"] is None
