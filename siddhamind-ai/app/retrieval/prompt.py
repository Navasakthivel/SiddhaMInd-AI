"""Prompt construction and citation parsing. Pure functions - no network.

The grounding contract has two halves and both live here.

Going out: passages are numbered and the model is told, in terms it cannot
reasonably misread, to use only those passages and to mark every claim with the
number it came from.

Coming back: those numbers are parsed and resolved against the passages that
were actually sent. The model never supplies book names, page numbers or verse
numbers - it supplies an integer, and the metadata is looked up locally. That
asymmetry is deliberate: a hallucinated page number is indistinguishable from a
real one to a reader, whereas a hallucinated passage number is just an integer
that fails to resolve, and gets dropped.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Sequence

from app.retrieval.fusion import FusedPassage

SYSTEM_INSTRUCTION = """\
You are a Siddha medicine reference assistant. You answer strictly from the \
numbered passages supplied with each question, which are extracted from scanned \
Siddha texts.

Rules, in order of priority:

1. Use ONLY the numbered passages. Do not use anything you know from training. \
If the passages do not contain the answer, say so plainly and stop - do not \
fill the gap.
2. Mark every factual claim with the passage number it came from, in square \
brackets: [1], or [2][3] where several passages support it. A sentence stating \
a fact without a bracketed number is a mistake.
3. Never state a dose, a preparation method, an ingredient quantity or a verse \
number that is not written in the passages. Quantities in particular must be \
copied, never inferred or converted.
4. Answer in the language the question was asked in. Tamil terms from the \
passages should be quoted in Tamil even in an English answer.
5. Be concise. Do not add safety advice, disclaimers or context that is not in \
the passages.

If the passages are about the general subject but do not answer the specific \
question, say exactly what they do and do not cover rather than approximating \
an answer."""

NOT_FOUND_MESSAGE = (
    "That is not covered by the indexed corpus. No passage in the ingested "
    "Siddha texts is relevant enough to answer this reliably, and answering "
    "from general knowledge would produce a citation that cannot be checked."
)

# Matches [1], [2][3], [1, 2] and [1,2,3]. Bare numbers in prose are ignored on
# purpose - "boil for 3 minutes" must not become a citation of passage 3.
_CITATION = re.compile(r"\[\s*(\d+(?:\s*,\s*\d+)*)\s*\]")


def build_passage_block(passages: Sequence[FusedPassage], *, max_chars: int = 1600) -> str:
    """Render passages as a numbered block, 1-based.

    Each carries its provenance so the model can describe where an answer came
    from in prose. The numbers, not this metadata, are what the citations are
    resolved through.
    """
    blocks = []
    for index, passage in enumerate(passages, start=1):
        body = " ".join((passage.content or "").split())
        if len(body) > max_chars:
            body = body[:max_chars].rsplit(" ", 1)[0] + " ..."
        blocks.append(f"[{index}] ({passage.citation_label()})\n{body}")
    return "\n\n".join(blocks)


def build_prompt(question: str, passages: Sequence[FusedPassage], *, max_chars: int = 1600) -> str:
    """The full user-turn prompt: passages first, question last.

    Question last because the instruction nearest the end of a long context is
    the one models follow most reliably, and the instruction that matters here
    is "answer this from the above".
    """
    return (
        "Passages from the indexed Siddha corpus:\n\n"
        f"{build_passage_block(passages, max_chars=max_chars)}\n\n"
        "---\n"
        f"Question: {question.strip()}\n\n"
        "Answer using only the passages above, marking each claim with its "
        "passage number in square brackets."
    )


@dataclass(frozen=True)
class Citation:
    """Resolved source reference.

    Field names mirror ``ChatMessageCitation`` in siddhamind-core so Phase 6 can
    map this straight onto the entity without a translation layer.
    """

    passage_no: int
    chunk_id: int
    source_document_id: int | None
    book_name: str | None
    page_no: int | None
    verse_no: str | None
    chunk_index: int | None
    snippet: str
    score: float

    def to_dict(self) -> dict:
        """camelCase, matching the entity's property names."""
        return {
            "passageNo": self.passage_no,
            "chunkId": self.chunk_id,
            "sourceDocumentId": self.source_document_id,
            "bookName": self.book_name,
            "pageNo": self.page_no,
            "verseNo": self.verse_no,
            "chunkIndex": self.chunk_index,
            "snippet": self.snippet,
            "score": self.score,
        }


@dataclass(frozen=True)
class ParsedAnswer:
    answer: str
    citations: list[Citation]
    invalid_passage_numbers: list[int]


def extract_passage_numbers(answer: str) -> list[int]:
    """Every bracketed passage number, in order of first appearance."""
    seen: set[int] = set()
    ordered: list[int] = []
    for match in _CITATION.finditer(answer or ""):
        for part in match.group(1).split(","):
            try:
                number = int(part.strip())
            except ValueError:
                continue
            if number not in seen:
                seen.add(number)
                ordered.append(number)
    return ordered


def make_snippet(content: str, limit: int) -> str:
    body = " ".join((content or "").split())
    if len(body) <= limit:
        return body
    return body[:limit].rsplit(" ", 1)[0] + "..."


def parse_answer(
    answer: str,
    passages: Sequence[FusedPassage],
    *,
    snippet_chars: int = 320,
) -> ParsedAnswer:
    """Resolve the model's bracketed numbers into citations.

    A number outside the range of what was sent is dropped and reported, never
    raised. Models do occasionally cite ``[7]`` when six passages were supplied,
    and losing one citation is a far better outcome than a 500 on an answer that
    is otherwise sound. ``invalid_passage_numbers`` exists so the occurrence is
    visible rather than silent.

    Citations come back ordered by passage number, so the same answer always
    produces the same citation list.
    """
    citations: list[Citation] = []
    invalid: list[int] = []

    for number in extract_passage_numbers(answer):
        if number < 1 or number > len(passages):
            invalid.append(number)
            continue
        passage = passages[number - 1]
        citations.append(
            Citation(
                passage_no=number,
                chunk_id=passage.chunk_id,
                source_document_id=passage.source_document_id,
                book_name=passage.book_name,
                page_no=passage.page_no,
                verse_no=passage.verse_no,
                chunk_index=passage.chunk_index,
                snippet=make_snippet(passage.content, snippet_chars),
                score=passage.score,
            )
        )

    citations.sort(key=lambda c: c.passage_no)
    return ParsedAnswer(
        answer=(answer or "").strip(),
        citations=citations,
        invalid_passage_numbers=sorted(invalid),
    )


def looks_uncited(answer: str) -> bool:
    """True when a substantive answer carries no citation at all.

    Not treated as an error - the model may legitimately have replied that the
    passages do not cover the question - but it is worth logging, because a long
    confident answer with no brackets is the shape an ungrounded answer takes.
    """
    stripped = (answer or "").strip()
    return len(stripped) > 200 and not _CITATION.search(stripped)
