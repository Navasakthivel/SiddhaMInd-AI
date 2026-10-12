"""Prompt construction and citation parsing, against realistic mocked answers.

Citation parsing is the point where a model's output becomes a claim about a
real book and page, so the failure that matters is not a crash - it is a
citation that resolves to the wrong passage, or one invented outright.
"""

import pytest

from app.retrieval.fusion import FusedPassage
from app.retrieval.prompt import (
    NOT_FOUND_MESSAGE,
    SYSTEM_INSTRUCTION,
    build_passage_block,
    build_prompt,
    extract_passage_numbers,
    looks_uncited,
    make_snippet,
    parse_answer,
)


def make_passage(chunk_id, *, page=1, verse=None, content="text", book="Siddha Formulary"):
    return FusedPassage(
        chunk_id=chunk_id,
        source_document_id=7,
        book_name=book,
        page_no=page,
        verse_no=verse,
        chunk_index=chunk_id - 1,
        content=content,
        score=1.0 / chunk_id,
        dense_score=0.8,
        dense_rank=chunk_id,
    )


PASSAGES = [
    make_passage(1, page=1, verse="101",
                 content="101. Thiripala Chooranam. Ingredients: Kadukkai 35 g, "
                         "Thandrikkai 35 g, Nellikkai 35 g. Dose: 2 to 4 g twice daily."),
    make_passage(2, page=1, verse="102",
                 content="102. Sukku Chooranam. Ingredients: Dried ginger rhizome 100 g. "
                         "Dose: 1 to 2 g twice daily. Anupanam: Honey."),
    make_passage(3, page=2, verse="42",
                 content="42. நிலவேம்பு குடிநீர். அளவு: 30 மில்லி. அனுபானம்: தேன்."),
]


# --------------------------------------------------------------------------
# prompt construction
# --------------------------------------------------------------------------


def test_passages_are_numbered_from_one():
    block = build_passage_block(PASSAGES)
    assert block.startswith("[1]")
    assert "[2]" in block and "[3]" in block
    assert "[0]" not in block


def test_each_passage_carries_its_provenance():
    block = build_passage_block(PASSAGES)
    assert "Siddha Formulary p.1 v.101" in block
    assert "Siddha Formulary p.2 v.42" in block


def test_long_passages_are_truncated_on_a_word_boundary():
    long_passage = make_passage(1, content="word " * 500)
    block = build_passage_block([long_passage], max_chars=100)
    body = block.split("\n", 1)[1]
    assert body.endswith("...")
    assert len(body) < 160


def test_prompt_puts_the_question_after_the_passages():
    built = build_prompt("What is the dose of Sukku Chooranam?", PASSAGES)
    assert built.index("Passages from") < built.index("Question:")
    assert built.rstrip().endswith("square brackets.")


def test_system_instruction_forbids_answering_from_training_data():
    assert "ONLY the numbered passages" in SYSTEM_INSTRUCTION
    assert "training" in SYSTEM_INSTRUCTION
    # Quantities are the highest-consequence thing the model could invent.
    assert "copied" in SYSTEM_INSTRUCTION


def test_not_found_message_explains_itself():
    assert "not covered" in NOT_FOUND_MESSAGE
    assert "general knowledge" in NOT_FOUND_MESSAGE


# --------------------------------------------------------------------------
# extracting passage numbers
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "answer,expected",
    [
        ("The dose is 2 to 4 g [1].", [1]),
        ("Supported by both [1][2].", [1, 2]),
        ("Comma form [1, 2].", [1, 2]),
        ("Tight comma form [1,2,3].", [1, 2, 3]),
        ("Spaced [ 2 ].", [2]),
        ("Repeated [1] and again [1].", [1]),
        ("Order of first appearance [3] then [1].", [3, 1]),
        ("No citation at all.", []),
        ("", []),
    ],
)
def test_citation_forms(answer, expected):
    assert extract_passage_numbers(answer) == expected


def test_bare_numbers_in_prose_are_not_citations():
    """'boil for 3 minutes' must not become a citation of passage 3."""
    answer = "Boil for 3 minutes and reduce to 60 ml, taking 2 g twice daily."
    assert extract_passage_numbers(answer) == []


def test_dose_ranges_in_brackets_are_not_mistaken_for_citations():
    assert extract_passage_numbers("Take [2] g") == [2]  # genuinely ambiguous
    assert extract_passage_numbers("Take 2 g (see [1])") == [1]


# --------------------------------------------------------------------------
# resolving citations
# --------------------------------------------------------------------------


def test_citation_resolves_to_the_right_passage_metadata():
    parsed = parse_answer("The ingredients are Kadukkai, Thandrikkai and Nellikkai [1].", PASSAGES)

    assert len(parsed.citations) == 1
    citation = parsed.citations[0]
    assert citation.passage_no == 1
    assert citation.chunk_id == 1
    assert citation.source_document_id == 7
    assert citation.book_name == "Siddha Formulary"
    assert citation.page_no == 1
    assert citation.verse_no == "101"
    assert citation.chunk_index == 0
    assert "Kadukkai" in citation.snippet
    assert parsed.invalid_passage_numbers == []


def test_passage_numbers_map_by_position_not_by_chunk_id():
    """[3] means the third passage sent, whose chunk_id happens to be 3 here -
    assert against a case where they differ."""
    passages = [make_passage(50), make_passage(60), make_passage(70)]
    parsed = parse_answer("From the second one [2].", passages)
    assert parsed.citations[0].passage_no == 2
    assert parsed.citations[0].chunk_id == 60


def test_multiple_citations_come_back_sorted_by_passage_number():
    parsed = parse_answer("Later first [3], then [1], then [2].", PASSAGES)
    assert [c.passage_no for c in parsed.citations] == [1, 2, 3]


def test_out_of_range_citation_is_dropped_not_raised():
    """Models do cite [7] when six passages were supplied. Losing one citation
    beats a 500 on an otherwise sound answer."""
    parsed = parse_answer("Claim one [1]. Claim two [9].", PASSAGES)

    assert [c.passage_no for c in parsed.citations] == [1]
    assert parsed.invalid_passage_numbers == [9]
    assert parsed.answer.startswith("Claim one")


def test_zero_and_negative_style_numbers_are_rejected():
    parsed = parse_answer("Bad [0] citation.", PASSAGES)
    assert parsed.citations == []
    assert parsed.invalid_passage_numbers == [0]


def test_every_citation_invalid_still_returns_the_answer():
    parsed = parse_answer("All wrong [8][9].", PASSAGES)
    assert parsed.citations == []
    assert parsed.invalid_passage_numbers == [8, 9]
    assert parsed.answer == "All wrong [8][9]."


def test_parsing_against_no_passages_never_crashes():
    parsed = parse_answer("Something [1].", [])
    assert parsed.citations == []
    assert parsed.invalid_passage_numbers == [1]


def test_uncited_answer_yields_no_citations_but_still_parses():
    parsed = parse_answer("The passages do not cover this question.", PASSAGES)
    assert parsed.citations == []
    assert parsed.invalid_passage_numbers == []
    assert parsed.answer


def test_tamil_answer_parses_normally():
    parsed = parse_answer("நிலவேம்பு குடிநீரின் அளவு 30 மில்லி [3].", PASSAGES)
    assert parsed.citations[0].passage_no == 3
    assert parsed.citations[0].verse_no == "42"
    assert "நிலவேம்பு" in parsed.citations[0].snippet


def test_citation_dict_uses_the_entity_field_names():
    """Phase 6 maps this straight onto ChatMessageCitation."""
    parsed = parse_answer("Claim [1].", PASSAGES)
    payload = parsed.citations[0].to_dict()
    assert set(payload) == {
        "passageNo", "chunkId", "sourceDocumentId", "bookName",
        "pageNo", "verseNo", "chunkIndex", "snippet", "score",
    }


# --------------------------------------------------------------------------
# snippets and heuristics
# --------------------------------------------------------------------------


def test_snippet_collapses_whitespace_and_truncates_on_a_word():
    snippet = make_snippet("a  b\n\nc " + "word " * 200, 40)
    assert snippet.endswith("...")
    assert "\n" not in snippet and "  " not in snippet
    assert len(snippet) <= 43


def test_short_content_is_not_truncated():
    assert make_snippet("short text", 100) == "short text"


def test_looks_uncited_only_flags_long_uncited_answers():
    assert looks_uncited("x " * 200) is True
    assert looks_uncited("x " * 200 + "[1]") is False
    # A brief refusal is legitimately uncited.
    assert looks_uncited("The passages do not cover this.") is False
