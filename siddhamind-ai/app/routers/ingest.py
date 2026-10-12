"""Ingestion endpoints. Called by siddhamind-core's admin corpus page only."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from app.clients import database
from app.config import Settings, get_settings
from app.ingestion import ocr, pipeline
from app.security import require_internal_token

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/ingest",
    tags=["ingestion"],
    dependencies=[Depends(require_internal_token)],
)


@router.post("/{source_document_id}", status_code=status.HTTP_202_ACCEPTED)
async def start_ingestion(
    source_document_id: int,
    background: BackgroundTasks,
    settings: Settings = Depends(get_settings),
) -> dict:
    """Queue OCR -> chunk -> embed for one document and return immediately.

    A 400-page book takes tens of minutes, far past any sane HTTP timeout, so
    the work is handed to a background task and progress is read back from
    ``source_documents`` via the status endpoint.

    The cheap failures are checked *before* accepting, though. A missing row, a
    missing PDF or a missing Tesseract would otherwise be reported as a FAILED
    status several seconds later, which the operator can only discover by
    polling - a 404 now is far more useful than a 202 followed by a failure.

    FastAPI's BackgroundTasks is sufficient at this scale. Celery would buy
    retries and cross-process visibility for a corpus of a few dozen books that
    are ingested once; it would cost a broker, a worker image and a second
    deployment target.
    """
    document = await database.fetch_document(source_document_id)
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No source_documents row with doc_id={source_document_id}.",
        )

    if pipeline.is_running(source_document_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Document {source_document_id} is already being ingested.",
        )

    try:
        pdf_path = pipeline.resolve_pdf_path(document.get("file_path"), settings)
    except pipeline.IngestionError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    # Probing Tesseract shells out, so keep it off the event loop even though it
    # takes milliseconds.
    binaries = await asyncio.to_thread(
        ocr.check_binaries, settings.tesseract_cmd, settings.poppler_path,
        settings.tessdata_dir
    )
    if not binaries["ok"]:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "message": "OCR binaries are unavailable on the AI service.",
                "tesseract": binaries.get("tesseract_error", binaries.get("tesseract")),
                "poppler": binaries.get("poppler_error", binaries.get("poppler")),
                "hint": "Install Tesseract 5 with the 'tam' pack and poppler, or set "
                "TESSERACT_CMD / POPPLER_PATH.",
            },
        )

    background.add_task(pipeline.ingest_document, source_document_id, settings)
    log.info("Queued ingestion for document %s (%s)", source_document_id, pdf_path.name)

    return {
        "status": "QUEUED",
        "sourceDocumentId": source_document_id,
        "title": document.get("title"),
        "file": pdf_path.name,
        "totalPages": document.get("total_pages"),
        "poll": f"/ingest/{source_document_id}/status",
    }


@router.get("/{source_document_id}/status")
async def ingestion_status(source_document_id: int) -> dict:
    """Current state, for the admin corpus page to poll.

    Reads ``source_documents`` rather than any in-memory state, so the answer is
    the same one Java sees and survives a restart mid-run. ``running`` is the
    single exception: it reflects this process, and distinguishes "RUNNING and
    still working" from "RUNNING when the process died", which the row alone
    cannot show.
    """
    document = await database.fetch_document(source_document_id)
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No source_documents row with doc_id={source_document_id}.",
        )

    return {
        "sourceDocumentId": source_document_id,
        "title": document.get("title"),
        "status": document.get("ingest_status"),
        "running": pipeline.is_running(source_document_id),
        "indexed": document.get("indexed"),
        "chunkCount": document.get("chunk_count"),
        "skippedPages": document.get("skipped_pages"),
        "totalPages": document.get("total_pages"),
        "error": document.get("ingest_error"),
    }
