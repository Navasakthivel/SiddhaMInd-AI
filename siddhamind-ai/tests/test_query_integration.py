"""Live retrieval and generation against the seeded corpus.

Layered so that each part runs as soon as its prerequisite exists, rather than
all-or-nothing:

* database reachable + doc_chunks populated  -> hybrid retrieval runs
* the above + GEMINI_API_KEY                 -> generation and citations run

Everything skips with a reason naming what is missing. To run the full path:

    # .env: PYTHON_DB_URL filled in, GEMINI_API_KEY set
    python -m app.cli ingest 7          # or POST /ingest/{id}
    pytest tests/test_query_integration.py -v -s
"""

from __future__ import annotations

import asyncio
import importlib.util
import os

import pytest

REQUIRED = ("asyncpg", "pgvector", "pydantic_settings")
_missing = [m for m in REQUIRED if importlib.util.find_spec(m) is None]

pytestmark = pytest.mark.skipif(
    bool(_missing) or not os.getenv("PYTHON_DB_URL"),
    reason=(
        f"needs {', '.join(_missing)} installed" if _missing
        else "PYTHON_DB_URL not set - fill in .env to run the live retrieval leg"
    ),
)

needs_key = pytest.mark.skipif(
    not os.getenv("GEMINI_API_KEY"),
    reason="GEMINI_API_KEY not set - retrieval is still exercised, generation is not",
)

# A question the synthetic fixture can actually answer, from page 1.
QUESTION = "What are the ingredients of Thiripala Chooranam?"
# Nothing in any Siddha corpus answers this; it must take the not-found path.
OFF_TOPIC = "What is the recommended tyre pressure for a Boeing 737?"


@pytest.fixture(scope="module")
def settings():
    from app.config import Settings

    return Settings()


def run(coro):
    return asyncio.run(coro)


async def _with_pool(settings, work):
    from app.clients import database

    await database.connect(settings)
    try:
        return await work(database)
    finally:
        await database.close()


@pytest.fixture(scope="module")
def chunk_count(settings):
    async def count(database):
        async with database.get_pool().acquire() as conn:
            return await conn.fetchval(
                "SELECT COUNT(*) FROM doc_chunks WHERE embedding IS NOT NULL"
            )

    try:
        return run(_with_pool(settings, count))
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"database unreachable: {type(exc).__name__}: {exc}")


@pytest.fixture(scope="module", autouse=True)
def require_embeddings(chunk_count):
    if not chunk_count:
        pytest.skip(
            "doc_chunks has no embedded rows - ingest corpus/test-sample.pdf first "
            "(POST /ingest/{doc_id}), then re-run"
        )


def test_report_corpus_state(chunk_count, capsys):
    with capsys.disabled():
        print(f"\n  embedded chunks in doc_chunks: {chunk_count}")
        print(f"  GEMINI_API_KEY: {'set' if os.getenv('GEMINI_API_KEY') else 'not set'}")


# --------------------------------------------------------------------------
# retrieval only - no key needed
# --------------------------------------------------------------------------


def test_hybrid_retrieval_finds_the_fixture_content(settings, capsys):
    from app.retrieval import service

    async def work(database):
        return await service.retrieve(QUESTION, settings)

    passages, diagnostics = run(_with_pool(settings, work))

    with capsys.disabled():
        print(f"\n  tsquery: {diagnostics['tsquery']}")
        print(f"  dense candidates {diagnostics['denseCandidates']}, "
              f"keyword candidates {diagnostics['keywordCandidates']}")
        print(f"  {'rank':>4}  {'chunk':>6} {'found_by':<9} {'rrf':>7} "
              f"{'dense':>7} {'kw':>7}  page  verse  content")
        for rank, p in enumerate(passages, start=1):
            body = " ".join(p.content.split())[:70]
            print(f"  {rank:>4}  {p.chunk_id:>6} {p.found_by:<9} {p.score:>7.4f} "
                  f"{(p.dense_score if p.dense_score is not None else float('nan')):>7.3f} "
                  f"{(p.keyword_score if p.keyword_score is not None else float('nan')):>7.4f}  "
                  f"{p.page_no}  {p.verse_no or '-':<5}  {body}")

    assert passages, "hybrid retrieval returned nothing for a question the corpus answers"
    joined = " ".join(p.content for p in passages).lower()
    assert "thiripala" in joined or "kadukkai" in joined, (
        "the passage containing the answer was not retrieved"
    )


def test_keyword_arm_actually_matches(settings):
    """The regression guard for the plainto_tsquery bug: under AND semantics
    this returned zero rows for every natural-language question."""
    from app.retrieval import service, terms

    tsquery = terms.build_tsquery(QUESTION)

    async def work(database):
        return await database.search_keyword(tsquery, 10)

    rows = run(_with_pool(settings, work))
    assert rows, f"keyword search returned nothing for tsquery {tsquery!r}"


def test_off_topic_question_is_refused_without_calling_the_model(settings):
    """End-to-end proof of the gate: a generator that raises if constructed."""
    from app.retrieval import service

    def exploding_factory():
        raise AssertionError("the model was reached on an off-topic question")

    async def work(database):
        return await service.answer_question(
            OFF_TOPIC, settings, generator_factory=exploding_factory
        )

    result = run(_with_pool(settings, work))
    assert result["notFoundInCorpus"] is True
    assert result["citations"] == []


# --------------------------------------------------------------------------
# generation - needs the key
# --------------------------------------------------------------------------


@needs_key
def test_answers_from_the_corpus_with_citations(settings, capsys):
    from app.retrieval import service

    async def work(database):
        return await service.answer_question(QUESTION, settings)

    result = run(_with_pool(settings, work))

    with capsys.disabled():
        print(f"\n  question: {QUESTION}")
        print(f"  notFoundInCorpus: {result['notFoundInCorpus']}")
        print(f"  retrievalCount:   {result['retrievalCount']}")
        print(f"\n  answer:\n    {result['answer']}")
        print("\n  citations:")
        for c in result["citations"]:
            print(f"    [{c['passageNo']}] chunk {c['chunkId']} "
                  f"{c['bookName']} p.{c['pageNo']} v.{c['verseNo']} "
                  f"score={c['score']:.4f}")
            print(f"        {c['snippet'][:110]}")

    assert result["notFoundInCorpus"] is False
    assert result["answer"].strip()
    assert result["citations"], "a grounded answer must carry at least one citation"

    for citation in result["citations"]:
        assert citation["chunkId"] is not None
        assert citation["snippet"].strip()
        assert 1 <= citation["passageNo"] <= result["retrievalCount"]

    # The fixture states these; if the answer names none of them it is not
    # actually reading the passages.
    answer = result["answer"].lower()
    assert any(term in answer for term in ("kadukkai", "thandrikkai", "nellikkai"))


@needs_key
def test_off_topic_question_returns_the_structured_refusal(settings, capsys):
    from app.retrieval import service

    async def work(database):
        return await service.answer_question(OFF_TOPIC, settings)

    result = run(_with_pool(settings, work))
    with capsys.disabled():
        print(f"\n  off-topic reason: {result.get('reason')}")

    assert result["notFoundInCorpus"] is True
    assert result["citations"] == []
    assert "not covered" in result["answer"]
