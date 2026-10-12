"""Ingestion orchestration: PDF in, doc_chunks rows out, status visible throughout.

Two properties this module exists to guarantee.

**No silent loss.** Every page of the PDF ends up in exactly one of three
buckets - indexed, skipped-with-a-reason, or the run failed outright. The
skipped count reaches ``source_documents.skipped_pages`` and each individual
page is logged with why.

**No silent failure.** This runs as a background task, so an exception that
escapes goes nowhere a user will ever see it. Every path therefore terminates in
an ``update_ingest_status`` call, including the ones that failed, and the
failure path is itself wrapped - if the database is what broke, the error is at
least logged rather than swallowed by the task runner.
"""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any

from app.clients import database
from app.config import Settings
from app.ingestion import chunker, embedder, ocr, paths

log = logging.getLogger(__name__)

# Documents currently being ingested. Two concurrent runs on one document would
# both call replace_document_chunks, and the loser's DELETE would wipe the
# winner's freshly inserted rows.
_in_flight: set[int] = set()
_in_flight_lock = asyncio.Lock()


class IngestionError(RuntimeError):
    """Something the operator can act on, phrased for the admin dashboard."""


async def claim(source_document_id: int) -> bool:
    """Reserve a document for ingestion. False if a run is already in progress."""
    async with _in_flight_lock:
        if source_document_id in _in_flight:
            return False
        _in_flight.add(source_document_id)
        return True


async def release(source_document_id: int) -> None:
    async with _in_flight_lock:
        _in_flight.discard(source_document_id)


def is_running(source_document_id: int) -> bool:
    return source_document_id in _in_flight


def resolve_pdf_path(file_path: str | None, settings: Settings) -> Path:
    """Locate the PDF, refusing anything outside the corpus and upload roots.

    Thin wrapper over :func:`app.ingestion.paths.resolve_pdf`; the containment
    rule lives there so it can be tested without importing the pipeline.
    """
    try:
        return paths.resolve_pdf(file_path, settings.corpus_dir, settings.upload_dir)
    except paths.PdfNotFoundError as exc:
        raise IngestionError(str(exc)) from exc


def _run_blocking(pdf_path: Path, doc: dict, settings: Settings) -> dict[str, Any]:
    """OCR, chunk and embed. Entirely CPU-bound, so it runs off the event loop.

    Returns the chunk rows plus the counters the caller writes back to
    ``source_documents``.
    """
    started = time.monotonic()

    ocr.require_binaries(settings.tesseract_cmd, settings.poppler_path,
                         settings.tessdata_dir)
    poppler = settings.poppler_path or None

    pages: list[tuple[int, str]] = []
    results: list[ocr.PageResult] = []

    # Whether to distrust a Latin-codepoint "text layer" on this document. Keyed
    # off the row's declared language rather than applied everywhere: an English
    # textbook legitimately scores 0% Tamil and must not be forced through OCR.
    language = (doc.get("language") or "").strip().lower()
    expect_tamil = language in ("tamil", "mixed") or (
        not language and "tam" in settings.ocr_languages
    )

    for result in ocr.extract_pages(
        pdf_path,
        languages=settings.ocr_languages,
        dpi=settings.ocr_dpi,
        min_confidence=settings.ocr_min_confidence,
        text_layer_min_chars=settings.text_layer_min_chars,
        poppler_path=poppler,
        expect_tamil=expect_tamil,
        min_tamil_ratio=settings.text_layer_min_tamil_ratio,
    ):
        results.append(result)
        if not result.skipped and result.text.strip():
            pages.append((result.page_no, result.text))

    stats = ocr.summarise(results)
    log.info(
        "%s: %s pages - %s from text layer, %s OCR'd, %s skipped (mean confidence %s)",
        pdf_path.name,
        stats["pages"],
        stats["text_layer"],
        stats["ocr"],
        stats["skipped"],
        stats["mean_confidence"],
    )
    if stats["skipped_pages"]:
        log.warning("%s: skipped pages %s", pdf_path.name, stats["skipped_pages"])

    model = embedder.load_model(settings.embedding_model)

    rows = chunker.chunk_document(
        pages,
        source_document_id=doc["doc_id"],
        book_name=doc.get("title"),
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        min_chars=settings.chunk_min_chars,
        token_counter=embedder.tokeniser_for(model),
    )

    ratio = chunker.structural_ratio(rows)
    log.info(
        "%s: %s chunks, %.0f%% split on a detected boundary", pdf_path.name, len(rows), ratio * 100
    )
    if rows and ratio < 0.2:
        # Not an error, but it means citations will carry page numbers and no
        # verse numbers, which is a visible drop in answer quality.
        log.warning(
            "%s: only %.0f%% of chunks found a structural boundary - the scan may "
            "have lost its line structure, so most citations will lack a verse number.",
            pdf_path.name,
            ratio * 100,
        )

    rows = embedder.embed_chunks(
        rows,
        expected_dim=settings.embedding_dim,
        model=model,
        model_name=settings.embedding_model,
        batch_size=settings.embedding_batch_size,
    )

    # 'structural' is a chunker diagnostic, not a doc_chunks column; asyncpg
    # would reject the extra key.
    for row in rows:
        row.pop("structural", None)

    return {
        "chunks": rows,
        "stats": stats,
        "structural_ratio": ratio,
        "seconds": round(time.monotonic() - started, 1),
    }


async def ingest_document(source_document_id: int, settings: Settings) -> dict[str, Any]:
    """Run the full pipeline for one document and record the outcome.

    Never raises: the result is reported through ``source_documents``, because
    that is what the admin dashboard reads and a background task has no other
    channel back to a user.
    """
    if not await claim(source_document_id):
        log.info("Document %s is already being ingested; ignoring", source_document_id)
        return {"status": "ALREADY_RUNNING", "sourceDocumentId": source_document_id}

    try:
        doc = await database.fetch_document(source_document_id)
        if doc is None:
            raise IngestionError(f"source_documents row {source_document_id} does not exist.")

        pdf_path = resolve_pdf_path(doc.get("file_path"), settings)
        log.info("Ingesting document %s from %s", source_document_id, pdf_path)

        await database.update_ingest_status(source_document_id, "RUNNING", error=None)

        # to_thread keeps OCR and torch off the event loop. Without it a single
        # ingestion would block every other request, health checks included, for
        # the length of the book.
        outcome = await asyncio.to_thread(_run_blocking, pdf_path, doc, settings)

        written = await database.replace_document_chunks(source_document_id, outcome["chunks"])
        await database.update_ingest_status(
            source_document_id,
            "COMPLETE",
            chunk_count=written,
            skipped_pages=outcome["stats"]["skipped"],
            error=None,
        )
        log.info(
            "Document %s complete: %s chunks, %s pages skipped, %ss",
            source_document_id,
            written,
            outcome["stats"]["skipped"],
            outcome["seconds"],
        )
        return {
            "status": "COMPLETE",
            "sourceDocumentId": source_document_id,
            "chunkCount": written,
            "seconds": outcome["seconds"],
            "structuralRatio": round(outcome["structural_ratio"], 3),
            **outcome["stats"],
        }

    except Exception as exc:  # noqa: BLE001 - the terminal handler for a background task
        message = f"{type(exc).__name__}: {exc}"
        log.exception("Ingestion failed for document %s", source_document_id)
        try:
            await database.update_ingest_status(source_document_id, "FAILED", error=message)
        except Exception:  # noqa: BLE001
            # The database is the only way to report this, so if it is also the
            # thing that broke, the log is all that is left.
            log.exception("Could not record FAILED status for document %s", source_document_id)
        return {"status": "FAILED", "sourceDocumentId": source_document_id, "error": message}

    finally:
        await release(source_document_id)


async def warm_embedding_model(settings: Settings) -> None:
    """Load the encoder once at startup rather than on the first ingestion.

    Deliberately not awaited during lifespan startup: the first run downloads
    around 2 GB, and blocking on that would leave the container failing its
    health check for minutes and make the whole service look down.
    """
    try:
        await asyncio.to_thread(embedder.load_model, settings.embedding_model)
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "Embedding model %s not preloaded (%s: %s). It will load on the first "
            "ingestion instead.",
            settings.embedding_model,
            type(exc).__name__,
            exc,
        )
