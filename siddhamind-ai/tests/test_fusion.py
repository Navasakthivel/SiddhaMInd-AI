"""Reciprocal rank fusion and the relevance gate. Pure logic, no database.

The fusion tests assert on resulting order and on the arithmetic behind it,
because "it returned six things" would pass for almost any implementation,
including one that ignored a retriever entirely.
"""

import pytest

from app.retrieval.fusion import (
    FusedPassage,
    RelevanceDecision,
    assess_relevance,
    reciprocal_rank_fusion,
)


def row(chunk_id, score=0.5, content=None, **extra):
    base = {
        "chunk_id": chunk_id,
        "source_document_id": 1,
        "book_name": "Test Book",
        "page_no": 1,
        "verse_no": None,
        "chunk_index": chunk_id,
        "content": content or f"content of chunk {chunk_id}",
        "score": score,
    }
    base.update(extra)
    return base


def rrf(k, rank):
    return 1.0 / (k + rank)


# --------------------------------------------------------------------------
# fusion order
# --------------------------------------------------------------------------


def test_agreement_between_retrievers_beats_a_single_first_place():
    """The whole point of RRF. Chunk 2 is second in both lists; chunk 1 is first
    in one and absent from the other. Agreement should win."""
    dense = [row(1), row(2), row(3)]
    keyword = [row(4), row(2), row(5)]

    fused = reciprocal_rank_fusion(dense, keyword, k=60, limit=5)

    assert fused[0].chunk_id == 2
    assert fused[0].found_by == "both"
    assert fused[0].score == pytest.approx(rrf(60, 2) + rrf(60, 2))
    assert fused[1].chunk_id == 1
    assert fused[1].score == pytest.approx(rrf(60, 1))


def test_a_passage_found_by_only_one_retriever_still_places():
    """Keyword-only hits are the reason hybrid retrieval exists - an exact Tamil
    formulation name the embedding missed must not be discarded."""
    dense = [row(1), row(2)]
    keyword = [row(99)]

    fused = reciprocal_rank_fusion(dense, keyword, k=60, limit=5)
    ids = [p.chunk_id for p in fused]

    assert 99 in ids
    keyword_only = next(p for p in fused if p.chunk_id == 99)
    assert keyword_only.found_by == "keyword"
    assert keyword_only.dense_rank is None
    assert keyword_only.keyword_rank == 1


def test_score_is_the_sum_of_reciprocal_ranks():
    dense = [row(7), row(8)]
    keyword = [row(8), row(7)]

    fused = reciprocal_rank_fusion(dense, keyword, k=10, limit=5)
    by_id = {p.chunk_id: p for p in fused}

    assert by_id[7].score == pytest.approx(rrf(10, 1) + rrf(10, 2))
    assert by_id[8].score == pytest.approx(rrf(10, 1) + rrf(10, 2))


def test_ranks_and_source_scores_are_preserved():
    dense = [row(1, score=0.91), row(2, score=0.72)]
    keyword = [row(2, score=0.05)]

    fused = reciprocal_rank_fusion(dense, keyword, k=60, limit=5)
    two = next(p for p in fused if p.chunk_id == 2)

    assert two.dense_rank == 2 and two.dense_score == pytest.approx(0.72)
    assert two.keyword_rank == 1 and two.keyword_score == pytest.approx(0.05)
    assert two.found_by == "both"


def test_ties_break_deterministically_on_chunk_id():
    """Two passages at rank 1 in different lists score identically. Without an
    explicit tie-break the order would follow dict iteration and the same
    question could cite different sources on different runs."""
    first = reciprocal_rank_fusion([row(9)], [row(4)], k=60, limit=5)
    second = reciprocal_rank_fusion([row(9)], [row(4)], k=60, limit=5)

    assert [p.chunk_id for p in first] == [4, 9]
    assert [p.chunk_id for p in first] == [p.chunk_id for p in second]


def test_smaller_k_sharpens_the_advantage_of_rank_one():
    """k damps the gap between adjacent ranks. At k=1 a first place is worth far
    more than a second; at k=60 the two are nearly equal."""
    dense, keyword = [row(1), row(2)], [row(2), row(1)]

    sharp = reciprocal_rank_fusion(dense, keyword, k=1, limit=2)
    flat = reciprocal_rank_fusion(dense, keyword, k=60, limit=2)

    sharp_spread = abs(sharp[0].score - sharp[1].score)
    flat_spread = abs(flat[0].score - flat[1].score)
    assert sharp_spread >= flat_spread


def test_limit_truncates_after_fusion_not_before():
    dense = [row(i) for i in range(1, 11)]
    keyword = [row(i) for i in range(20, 30)]

    fused = reciprocal_rank_fusion(dense, keyword, k=60, limit=3)
    assert len(fused) == 3
    # Rank 1 from each list must both survive a limit of 3.
    assert {1, 20}.issubset({p.chunk_id for p in fused})


def test_limit_zero_returns_everything():
    fused = reciprocal_rank_fusion([row(1), row(2)], [row(3)], k=60, limit=0)
    assert len(fused) == 3


# --------------------------------------------------------------------------
# fusion edge cases
# --------------------------------------------------------------------------


def test_empty_inputs_give_an_empty_result():
    assert reciprocal_rank_fusion([], [], k=60, limit=6) == []


def test_one_empty_retriever_is_not_an_error():
    """Happens whenever a question is all stop words and the keyword half is
    skipped."""
    fused = reciprocal_rank_fusion([row(1), row(2)], [], k=60, limit=6)
    assert [p.chunk_id for p in fused] == [1, 2]
    assert all(p.found_by == "dense" for p in fused)


def test_duplicate_chunk_in_one_list_counts_once():
    """A repeat must not inflate the fused score just by being repeated."""
    fused = reciprocal_rank_fusion([row(1), row(1), row(2)], [], k=60, limit=6)
    one = next(p for p in fused if p.chunk_id == 1)
    assert one.score == pytest.approx(rrf(60, 1))
    assert len(fused) == 2


def test_rows_without_a_chunk_id_are_skipped():
    fused = reciprocal_rank_fusion([{"content": "orphan", "score": 1.0}, row(5)], [], k=60)
    assert [p.chunk_id for p in fused] == [5]


def test_content_is_taken_from_whichever_row_has_it():
    dense = [{"chunk_id": 1, "score": 0.8, "content": ""}]
    keyword = [row(1, content="the real text")]
    fused = reciprocal_rank_fusion(dense, keyword, k=60)
    assert fused[0].content == "the real text"


def test_invalid_k_is_rejected():
    with pytest.raises(ValueError, match="k must be"):
        reciprocal_rank_fusion([row(1)], [], k=0)


def test_non_numeric_source_score_becomes_none_not_a_crash():
    fused = reciprocal_rank_fusion([row(1, score="n/a")], [], k=60)
    assert fused[0].dense_score is None


def test_citation_label_includes_page_and_verse():
    passage = FusedPassage(
        chunk_id=1, source_document_id=1, book_name="Siddha Formulary",
        page_no=12, verse_no="236", chunk_index=3, content="x", score=0.1,
    )
    assert passage.citation_label() == "Siddha Formulary p.12 v.236"


def test_citation_label_survives_missing_metadata():
    passage = FusedPassage(
        chunk_id=1, source_document_id=None, book_name=None,
        page_no=None, verse_no=None, chunk_index=None, content="x", score=0.1,
    )
    assert passage.citation_label() == "unknown source"


# --------------------------------------------------------------------------
# the relevance gate
# --------------------------------------------------------------------------


def passage(chunk_id=1, dense=None, keyword=None):
    return FusedPassage(
        chunk_id=chunk_id, source_document_id=1, book_name="B", page_no=1,
        verse_no=None, chunk_index=0, content="text", score=0.01,
        dense_score=dense, keyword_score=keyword,
        dense_rank=1 if dense is not None else None,
        keyword_rank=1 if keyword is not None else None,
    )


def test_strong_dense_similarity_passes():
    decision = assess_relevance([passage(dense=0.71)], dense_floor=0.35)
    assert decision.relevant
    assert decision.best_dense_score == 0.71


def test_weak_dense_similarity_with_no_keyword_hit_fails():
    decision = assess_relevance([passage(dense=0.11)], dense_floor=0.35)
    assert not decision.relevant
    assert "below" in decision.reason


def test_exactly_at_the_floor_passes():
    assert assess_relevance([passage(dense=0.35)], dense_floor=0.35).relevant


def test_a_keyword_hit_rescues_a_weak_dense_score():
    """The arm that protects exact Tamil formulation names and verse numbers,
    where the dense vector for a short rare token is often mediocre."""
    decision = assess_relevance([passage(dense=0.04, keyword=0.19)], dense_floor=0.35)
    assert decision.relevant
    assert "exact terms" in decision.reason
    assert decision.keyword_matches == 1


def test_no_passages_at_all_fails():
    decision = assess_relevance([], dense_floor=0.35)
    assert not decision.relevant
    assert "no passages" in decision.reason


def test_passages_without_any_scores_fail_closed():
    """Scores absent means nothing established relevance; refusing is correct."""
    decision = assess_relevance([passage(dense=None, keyword=None)], dense_floor=0.35)
    assert not decision.relevant


def test_the_best_dense_score_is_used_not_the_first():
    decision = assess_relevance(
        [passage(1, dense=0.10), passage(2, dense=0.88)], dense_floor=0.35
    )
    assert decision.relevant
    assert decision.best_dense_score == 0.88


def test_reason_is_always_populated():
    for decision in (
        assess_relevance([], dense_floor=0.35),
        assess_relevance([passage(dense=0.9)], dense_floor=0.35),
        assess_relevance([passage(dense=0.01)], dense_floor=0.35),
    ):
        assert isinstance(decision, RelevanceDecision)
        assert decision.reason.strip()
