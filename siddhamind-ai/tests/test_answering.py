"""The gate, and the guarantee that nothing reaches the model without passing it.

This is the security-critical file in Phase 5. The spec is explicit that the
service must never let the model answer from its own training knowledge, and the
only structural way to guarantee that is for the not-found path to contain no
call. So the assertion is not "the answer was discarded" - it is that the
generator was never *constructed*, let alone invoked.
"""

import pytest

from app.retrieval.answering import (
    GenerationFailed,
    decide_and_generate,
    not_found_response,
)
from app.retrieval.fusion import FusedPassage, RelevanceDecision


class RecordingGenerator:
    """Counts every call so a test can assert zero."""

    def __init__(self, reply="The dose is 2 to 4 g twice daily [1]."):
        self.reply = reply
        self.calls = []

    def generate(self, system_instruction, prompt):
        self.calls.append({"system": system_instruction, "prompt": prompt})
        return self.reply


class RecordingFactory:
    """Counts construction separately from invocation."""

    def __init__(self, generator=None):
        self.generator = generator or RecordingGenerator()
        self.calls = 0

    def __call__(self):
        self.calls += 1
        return self.generator


class ExplodingFactory:
    """Fails loudly if the gate ever lets it be reached."""

    def __call__(self):
        raise AssertionError("the generator must not be constructed on this path")


def passage(chunk_id=1, dense=0.8, keyword=None, content="101. Thiripala Chooranam. Dose: 2 to 4 g."):
    return FusedPassage(
        chunk_id=chunk_id, source_document_id=7, book_name="Siddha Formulary",
        page_no=1, verse_no="101", chunk_index=chunk_id - 1, content=content,
        score=0.03, dense_score=dense, keyword_score=keyword,
        dense_rank=1 if dense is not None else None,
        keyword_rank=1 if keyword is not None else None,
    )


# --------------------------------------------------------------------------
# the not-found path - no model call, at all
# --------------------------------------------------------------------------


def test_no_passages_means_the_generator_is_never_constructed():
    result = decide_and_generate(
        "what is the capital of France",
        [],
        dense_floor=0.35,
        generator_factory=ExplodingFactory(),
    )
    assert result["notFoundInCorpus"] is True
    assert result["citations"] == []
    assert result["retrievalCount"] == 0


def test_low_similarity_means_the_generator_is_never_constructed():
    factory = RecordingFactory()
    result = decide_and_generate(
        "how do I service a diesel engine",
        [passage(dense=0.04)],
        dense_floor=0.35,
        generator_factory=factory,
    )
    assert result["notFoundInCorpus"] is True
    assert factory.calls == 0, "the factory was invoked on the not-found path"
    assert factory.generator.calls == [], "the model was called on the not-found path"


def test_not_found_answer_refuses_rather_than_guessing():
    result = decide_and_generate(
        "unrelated", [passage(dense=0.01)], dense_floor=0.35,
        generator_factory=ExplodingFactory(),
    )
    assert "not covered" in result["answer"]
    assert "general knowledge" in result["answer"]


def test_not_found_carries_the_reason():
    result = decide_and_generate(
        "unrelated", [passage(dense=0.02)], dense_floor=0.35,
        generator_factory=ExplodingFactory(),
    )
    assert "below" in result["reason"]
    assert result["diagnostics"]["bestDenseScore"] == 0.02


def test_not_found_still_reports_how_many_passages_were_considered():
    """Zero retrieval and 'six retrieved but all weak' are different failures and
    an operator needs to tell them apart."""
    result = decide_and_generate(
        "unrelated",
        [passage(i, dense=0.05) for i in range(1, 7)],
        dense_floor=0.35,
        generator_factory=ExplodingFactory(),
    )
    assert result["retrievalCount"] == 6
    assert result["citations"] == []


def test_a_keyword_hit_does_let_the_model_run():
    """The counterpart: an exact-term match on a weak dense score must proceed,
    or hybrid retrieval buys nothing."""
    factory = RecordingFactory()
    result = decide_and_generate(
        "௪௪", [passage(dense=0.03, keyword=0.21)], dense_floor=0.35,
        generator_factory=factory,
    )
    assert result["notFoundInCorpus"] is False
    assert factory.calls == 1


def test_not_found_response_shape_matches_the_contract():
    decision = RelevanceDecision(False, "nothing relevant")
    payload = not_found_response([], decision)
    assert set(payload) >= {"answer", "citations", "notFoundInCorpus", "retrievalCount"}
    assert payload["notFoundInCorpus"] is True


# --------------------------------------------------------------------------
# the answering path
# --------------------------------------------------------------------------


def test_relevant_passages_produce_an_answer_with_citations():
    factory = RecordingFactory()
    result = decide_and_generate(
        "What is the dose of Thiripala Chooranam?",
        [passage(1, dense=0.82)],
        dense_floor=0.35,
        generator_factory=factory,
    )

    assert result["notFoundInCorpus"] is False
    assert result["answer"] == "The dose is 2 to 4 g twice daily [1]."
    assert result["retrievalCount"] == 1
    assert len(result["citations"]) == 1
    assert result["citations"][0]["passageNo"] == 1
    assert result["citations"][0]["chunkId"] == 1
    assert result["citations"][0]["bookName"] == "Siddha Formulary"


def test_the_generator_receives_the_grounding_instruction_and_numbered_passages():
    factory = RecordingFactory()
    decide_and_generate(
        "dose?", [passage(1, dense=0.9), passage(2, dense=0.8)],
        dense_floor=0.35, generator_factory=factory,
    )
    call = factory.generator.calls[0]
    assert "ONLY the numbered passages" in call["system"]
    assert "[1]" in call["prompt"] and "[2]" in call["prompt"]
    assert "dose?" in call["prompt"]


def test_the_factory_is_constructed_exactly_once():
    factory = RecordingFactory()
    decide_and_generate("dose?", [passage(dense=0.9)], dense_floor=0.35,
                        generator_factory=factory)
    assert factory.calls == 1


def test_a_model_citing_a_passage_that_does_not_exist_does_not_crash():
    factory = RecordingFactory(RecordingGenerator("Claim [1]. Other claim [9]."))
    result = decide_and_generate(
        "dose?", [passage(dense=0.9)], dense_floor=0.35, generator_factory=factory,
    )
    assert [c["passageNo"] for c in result["citations"]] == [1]
    assert result["diagnostics"]["invalidPassageNumbers"] == [9]


def test_an_uncited_answer_is_returned_not_suppressed():
    """The model may legitimately reply that the passages do not answer the
    question; that is not an error condition."""
    factory = RecordingFactory(RecordingGenerator("The passages do not state a dose."))
    result = decide_and_generate(
        "dose?", [passage(dense=0.9)], dense_floor=0.35, generator_factory=factory,
    )
    assert result["citations"] == []
    assert result["notFoundInCorpus"] is False
    assert result["answer"] == "The passages do not state a dose."


def test_generation_failure_is_wrapped_not_leaked():
    class Broken:
        def generate(self, system_instruction, prompt):
            raise RuntimeError("503 upstream")

    with pytest.raises(GenerationFailed, match="503 upstream"):
        decide_and_generate(
            "dose?", [passage(dense=0.9)], dense_floor=0.35,
            generator_factory=lambda: Broken(),
        )


def test_generation_failure_is_distinct_from_not_found():
    """A broken API key must not be reported to the user as 'the corpus does not
    cover this' - the two need different fixes."""
    class Broken:
        def generate(self, system_instruction, prompt):
            raise RuntimeError("api key invalid")

    with pytest.raises(GenerationFailed):
        decide_and_generate(
            "dose?", [passage(dense=0.9)], dense_floor=0.35,
            generator_factory=lambda: Broken(),
        )


def test_response_contract_keys_are_exactly_as_agreed():
    factory = RecordingFactory()
    result = decide_and_generate("dose?", [passage(dense=0.9)], dense_floor=0.35,
                                 generator_factory=factory)
    assert {"answer", "citations", "notFoundInCorpus", "retrievalCount"} <= set(result)
    assert isinstance(result["answer"], str)
    assert isinstance(result["citations"], list)
    assert isinstance(result["notFoundInCorpus"], bool)
    assert isinstance(result["retrievalCount"], int)


def test_diagnostics_from_retrieval_are_carried_through():
    factory = RecordingFactory()
    result = decide_and_generate(
        "dose?", [passage(dense=0.9)], dense_floor=0.35, generator_factory=factory,
        diagnostics={"tsquery": "thiripala | chooranam"},
    )
    assert result["diagnostics"]["tsquery"] == "thiripala | chooranam"


def test_passed_diagnostics_are_not_mutated():
    """The caller's dict must not gain keys behind its back."""
    original = {"tsquery": "x"}
    decide_and_generate("dose?", [passage(dense=0.9)], dense_floor=0.35,
                        generator_factory=RecordingFactory(), diagnostics=original)
    assert original == {"tsquery": "x"}
