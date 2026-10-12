"""Query orchestration: the I/O half of the query path.

Embedding and both database searches live here; the decision to answer and the
generation itself live in :mod:`app.retrieval.answering`, which imports nothing
that needs installing. That split is what lets the "never call the model without
relevant passages" rule be tested without a database driver or an API key - see
``tests/test_answering.py``.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Sequence

from app.clients import database
from app.config import Settings
from app.ingestion import embedder
from app.retrieval import answering, fusion, terms
from app.retrieval.fusion import FusedPassage

log = logging.getLogger(__name__)


class QueryError(RuntimeError):
    """A failure the caller should see, phrased for an operator."""


async def embed_question(question: str, settings: Settings) -> list[float]:
    """Encode the question with the model that encoded the corpus.

    Reuses the cached instance from ingestion - a second load would cost the
    same 2 GB again, and a *different* model would put the query in a different
    vector space, where cosine distance is meaningless rather than merely poor.

    ``query_prefix`` is applied here and ``passage_prefix`` at ingestion. e5
    needs the pair; bge-m3 needs neither. Using one without the other degrades
    retrieval silently - results still come back, just worse ones.
    """
    def encode() -> list[float]:
        model = embedder.load_model(settings.embedding_model)
        vectors = embedder.embed_queries(
            [question],
            expected_dim=settings.embedding_dim,
            model=model,
            model_name=settings.embedding_model,
            batch_size=1,
        )
        return vectors[0]

    return await asyncio.to_thread(encode)


async def retrieve(
    question: str,
    settings: Settings,
    *,
    book_names: Sequence[str] | None = None,
    source_document_ids: Sequence[int] | None = None,
) -> tuple[list[FusedPassage], dict[str, Any]]:
    """Run both retrievers concurrently and fuse the rankings.

    Each retriever is asked for ``retrieval_candidates`` rows, not ``top_k``.
    Fusing two six-row lists gives RRF almost nothing to work with - the useful
    signal is which passages *both* methods ranked highly, and that only becomes
    visible with a deeper candidate pool.
    """
    tsquery = terms.build_tsquery(question)
    depth = max(settings.retrieval_candidates, settings.top_k)

    embedding = await embed_question(question, settings)

    dense_task = database.search_dense(
        embedding, depth, book_names=book_names, source_document_ids=source_document_ids
    )
    if tsquery:
        keyword_task = database.search_keyword(
            tsquery, depth, book_names=book_names, source_document_ids=source_document_ids
        )
    else:
        # Every token was a stop word. to_tsquery rejects an empty expression, so
        # the keyword half is skipped rather than sent a query that would error.
        async def _none() -> list[dict]:
            return []

        keyword_task = _none()

    dense_rows, keyword_rows = await asyncio.gather(dense_task, keyword_task)

    passages = fusion.reciprocal_rank_fusion(
        dense_rows, keyword_rows, k=settings.rrf_k, limit=settings.top_k
    )

    diagnostics = {
        "tsquery": tsquery,
        "queryTerms": terms.meaningful_terms(question),
        "denseCandidates": len(dense_rows),
        "keywordCandidates": len(keyword_rows),
        "fusedCandidates": len(dense_rows) + len(keyword_rows),
        "returned": len(passages),
    }
    log.info(
        "retrieval: %s dense + %s keyword candidates -> %s fused (tsquery=%s)",
        len(dense_rows), len(keyword_rows), len(passages), tsquery,
    )
    return passages, diagnostics


async def answer_question(
    question: str,
    settings: Settings,
    *,
    book_names: Sequence[str] | None = None,
    source_document_ids: Sequence[int] | None = None,
    generator_factory: Any = None,
) -> dict[str, Any]:
    """Full query path. Returns the response contract siddhamind-core consumes.

    :param generator_factory: injected in tests. A zero-argument callable, not a
        generator instance: it is invoked only after the relevance gate passes,
        so the not-found path never constructs a client, never mind calls one.
    """
    question = (question or "").strip()
    if not question:
        raise QueryError("question must not be empty")

    passages, diagnostics = await retrieve(
        question, settings, book_names=book_names, source_document_ids=source_document_ids
    )

    if generator_factory is None:
        def generator_factory():  # noqa: E306 - resolved lazily, past the gate
            from app.clients import gemini

            return gemini.get_generator(settings)

    try:
        # to_thread because the SDK call blocks; without it one slow generation
        # would stall health checks and every other request for its duration.
        return await asyncio.to_thread(
            answering.decide_and_generate,
            question,
            passages,
            dense_floor=settings.dense_score_floor,
            generator_factory=generator_factory,
            snippet_chars=settings.citation_snippet_chars,
            passage_max_chars=settings.passage_max_chars,
            diagnostics=diagnostics,
        )
    except answering.GenerationFailed as exc:
        raise QueryError(f"generation failed: {exc}") from exc
