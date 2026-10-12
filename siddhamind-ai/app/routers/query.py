"""The assistant query endpoint. Consumed by siddhamind-core's AssistantApiController."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.retrieval import service
from app.security import require_internal_token

log = logging.getLogger(__name__)

router = APIRouter(tags=["assistant"], dependencies=[Depends(require_internal_token)])


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    # Optional narrowing, e.g. a student restricted to one textbook.
    book_names: list[str] | None = None
    source_document_ids: list[int] | None = None


class Citation(BaseModel):
    """Mirrors ChatMessageCitation in siddhamind-core, field for field."""

    passageNo: int
    chunkId: int
    sourceDocumentId: int | None = None
    bookName: str | None = None
    pageNo: int | None = None
    verseNo: str | None = None
    chunkIndex: int | None = None
    snippet: str
    score: float


class QueryResponse(BaseModel):
    answer: str
    citations: list[Citation]
    notFoundInCorpus: bool
    retrievalCount: int
    # Beyond the agreed contract, and safe for Java to ignore: why the corpus was
    # or was not judged to cover the question, and the retrieval counts behind
    # that. Without it, a "not found" is indistinguishable from a broken index.
    reason: str | None = None
    diagnostics: dict | None = None


@router.post("/query", response_model=QueryResponse)
async def query(
    request: QueryRequest,
    settings: Settings = Depends(get_settings),
) -> dict:
    """Answer a question from the indexed corpus, or decline to.

    A ``notFoundInCorpus`` response is a success, not an error - it carries HTTP
    200 with an empty citation list. Returning 404 would push Java into treating
    "the corpus does not cover this" as a failure to retry, when it is the
    correct and final answer.
    """
    try:
        return await service.answer_question(
            request.question,
            settings,
            book_names=request.book_names,
            source_document_ids=request.source_document_ids,
        )
    except service.QueryError as exc:
        # Retrieval succeeded but generation did not - a missing key, a blocked
        # response, an SDK error. Distinct from "not in corpus", and the
        # difference must survive to the operator.
        log.error("query failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc
