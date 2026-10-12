"""Reciprocal rank fusion, and the gate that decides whether to answer at all.

Pure functions - no database, no model, no network.

Why RRF rather than blending scores
-----------------------------------
Cosine similarity and ``ts_rank`` are not on the same scale and never will be:
one is bounded in [-1, 1] and metric, the other is an unbounded function of term
frequency and document length. Normalising them against each other requires
picking a weight that is really a guess, and the guess has to be re-tuned every
time the corpus changes.

RRF ignores the scores and fuses the *rankings*, which is exactly the part both
methods agree on the meaning of. A passage that both methods rank highly wins;
a passage only one method found still places, which is the point of running two.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Sequence


@dataclass(frozen=True)
class FusedPassage:
    """One retrieved chunk with its provenance from both retrievers.

    Frozen because the relevance gate, the prompt builder and the citation
    parser all read these and none of them may rewrite a citation.
    """

    chunk_id: int
    source_document_id: int | None
    book_name: str | None
    page_no: int | None
    verse_no: str | None
    chunk_index: int | None
    content: str
    score: float                      # the fused RRF score
    dense_score: float | None = None  # cosine similarity, absolute and comparable
    keyword_score: float | None = None  # ts_rank, relative to this query only
    dense_rank: int | None = None
    keyword_rank: int | None = None

    @property
    def found_by(self) -> str:
        if self.dense_rank is not None and self.keyword_rank is not None:
            return "both"
        if self.dense_rank is not None:
            return "dense"
        return "keyword"

    def citation_label(self) -> str:
        """Human-readable provenance, e.g. ``Siddha Formulary p.12 v.236``."""
        parts = [self.book_name or "unknown source"]
        if self.page_no is not None:
            parts.append(f"p.{self.page_no}")
        if self.verse_no:
            parts.append(f"v.{self.verse_no}")
        return " ".join(parts)


def _key(row: dict[str, Any]) -> int | None:
    value = row.get("chunk_id")
    return int(value) if value is not None else None


def reciprocal_rank_fusion(
    dense: Sequence[dict[str, Any]],
    keyword: Sequence[dict[str, Any]],
    *,
    k: int = 60,
    limit: int = 6,
) -> list[FusedPassage]:
    """Fuse two ranked lists into one.

    ``score = sum over retrievers of 1 / (k + rank)``, rank being 1-based.

    ``k`` damps the difference between adjacent ranks: at k=60 the gap between
    rank 1 and rank 2 is small, so a passage both retrievers place in their top
    handful outranks one that a single retriever put first. That is the intended
    behaviour - agreement between two different notions of relevance is stronger
    evidence than a high score from either alone.

    Ties are broken by ``chunk_id`` ascending. Without that, two passages with
    identical fused scores would come back in whatever order the dict happened
    to iterate, and the same question could produce different citations on
    different runs.
    """
    if k < 1:
        raise ValueError(f"RRF k must be >= 1, got {k}")

    accumulator: dict[int, dict[str, Any]] = {}

    for source, rows in (("dense", dense), ("keyword", keyword)):
        for rank, row in enumerate(rows, start=1):
            chunk_id = _key(row)
            if chunk_id is None:
                continue
            entry = accumulator.setdefault(
                chunk_id, {"row": row, "rrf": 0.0}
            )
            # A retriever should not return the same chunk twice, but if it does,
            # only its best rank counts - otherwise a duplicate would inflate the
            # fused score purely by being repeated.
            if f"{source}_rank" in entry:
                continue
            entry["rrf"] += 1.0 / (k + rank)
            entry[f"{source}_rank"] = rank
            entry[f"{source}_score"] = row.get("score")
            # Prefer whichever row carries content, in case one retriever
            # projected fewer columns.
            if not entry["row"].get("content") and row.get("content"):
                entry["row"] = row

    fused = [
        FusedPassage(
            chunk_id=chunk_id,
            source_document_id=entry["row"].get("source_document_id"),
            book_name=entry["row"].get("book_name"),
            page_no=entry["row"].get("page_no"),
            verse_no=entry["row"].get("verse_no"),
            chunk_index=entry["row"].get("chunk_index"),
            content=entry["row"].get("content") or "",
            score=entry["rrf"],
            dense_score=_as_float(entry.get("dense_score")),
            keyword_score=_as_float(entry.get("keyword_score")),
            dense_rank=entry.get("dense_rank"),
            keyword_rank=entry.get("keyword_rank"),
        )
        for chunk_id, entry in accumulator.items()
    ]

    fused.sort(key=lambda p: (-p.score, p.chunk_id))
    return fused[:limit] if limit and limit > 0 else fused


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


@dataclass(frozen=True)
class RelevanceDecision:
    """Whether the corpus actually covers the question, and why."""

    relevant: bool
    reason: str
    best_dense_score: float | None = None
    keyword_matches: int = 0


def assess_relevance(
    passages: Iterable[FusedPassage],
    *,
    dense_floor: float,
) -> RelevanceDecision:
    """Decide whether these passages justify calling the model at all.

    Two arms, either of which is sufficient.

    **Dense floor.** Cosine similarity is absolute and comparable across
    queries, so a threshold on it means something. The fused RRF score is not
    usable here: RRF is ``1/(k+rank)``, so the top result scores identically
    whether it is a perfect match or the least bad of six irrelevant ones. A
    threshold on RRF would measure ordering, not relevance.

    **Keyword hit.** ``ts_rank`` is only meaningful within one query, so it gets
    no threshold - but the *existence* of a full-text match is itself decisive.
    This is the arm that protects exact Tamil formulation names and verse
    numbers such as ``௪௪``, where the dense vector for a short, rare token can
    be mediocre while an exact term match is conclusive. Dropping this arm
    discards the reason for running hybrid retrieval in the first place.
    """
    passages = list(passages)
    if not passages:
        return RelevanceDecision(False, "retrieval returned no passages")

    dense_scores = [p.dense_score for p in passages if p.dense_score is not None]
    best_dense = max(dense_scores) if dense_scores else None
    keyword_matches = sum(1 for p in passages if p.keyword_score is not None)

    if keyword_matches:
        return RelevanceDecision(
            True,
            f"{keyword_matches} passage(s) matched on exact terms",
            best_dense,
            keyword_matches,
        )

    if best_dense is not None and best_dense >= dense_floor:
        return RelevanceDecision(
            True,
            f"top similarity {best_dense:.3f} at or above the {dense_floor:.2f} floor",
            best_dense,
            keyword_matches,
        )

    shown = f"{best_dense:.3f}" if best_dense is not None else "n/a"
    return RelevanceDecision(
        False,
        f"no exact-term match and top similarity {shown} is below the "
        f"{dense_floor:.2f} floor",
        best_dense,
        keyword_matches,
    )
