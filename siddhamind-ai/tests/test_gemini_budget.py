"""The output-cap guard.

Running out of output budget returns a response with no text - byte-identical,
from the caller's point of view, to a service that could not be reached. Left
undistinguished it reaches a practitioner as "the assistant is temporarily
unavailable, try again", advice that can never work: retrying spends the same
budget and fails the same way.

Phase 6 exists to keep "we could not reach the service" apart from "the corpus
does not cover this". This keeps a third case - "the budget was too small" -
from being folded into the first.
"""

import pytest

from app.clients.gemini import (
    GeminiGenerator,
    GenerationError,
    TokenBudgetExceeded,
    _budget_message,
    _hit_token_cap,
)


class Usage:
    def __init__(self, thoughts=None, output=None):
        self.thoughts_token_count = thoughts
        self.candidates_token_count = output


class Candidate:
    def __init__(self, finish_reason):
        self.finish_reason = finish_reason


class Response:
    """Shape of google-genai's GenerateContentResponse, as far as we read it."""

    def __init__(self, text=None, finish_reason="STOP", usage=None):
        self.text = text
        self.candidates = [Candidate(finish_reason)]
        self.usage_metadata = usage
        self.prompt_feedback = None


def generator(max_tokens=1024):
    g = GeminiGenerator("fake-key", "gemini-3.6-flash", max_output_tokens=max_tokens)
    return g


# --------------------------------------------------------------------------
# detecting the cap
# --------------------------------------------------------------------------


@pytest.mark.parametrize("reason", ["MAX_TOKENS", "FinishReason.MAX_TOKENS", "max_tokens"])
def test_recognises_the_cap_in_any_casing_or_enum_form(reason):
    # google-genai may hand back a bare string or an enum whose repr carries the
    # class name; both must be recognised.
    assert _hit_token_cap(Response(finish_reason=reason)) is True


@pytest.mark.parametrize("reason", ["STOP", "SAFETY", "RECITATION", ""])
def test_other_finish_reasons_are_not_the_cap(reason):
    assert _hit_token_cap(Response(finish_reason=reason)) is False


def test_a_response_with_no_candidates_is_not_the_cap():
    r = Response()
    r.candidates = []
    assert _hit_token_cap(r) is False


# --------------------------------------------------------------------------
# the message an operator reads
# --------------------------------------------------------------------------


def test_the_message_names_the_setting_to_change():
    msg = _budget_message(Response(usage=Usage(868, 0)), configured=1024)
    assert "GEMINI_MAX_OUTPUT_TOKENS" in msg
    assert "1024" in msg


def test_the_message_says_reasoning_tokens_share_the_budget():
    # The non-obvious part: sizing the budget for the answer text alone is what
    # produces this failure in the first place.
    msg = _budget_message(Response(usage=Usage(868, 0)), configured=1024)
    assert "reasoning" in msg.lower()


def test_the_message_reports_the_actual_token_split():
    msg = _budget_message(Response(usage=Usage(868, 12)), configured=1024)
    assert "868" in msg and "12" in msg


def test_the_message_denies_being_an_outage():
    """The distinction the whole guard exists for."""
    msg = _budget_message(Response(usage=Usage(868, 0)), configured=1024)
    assert "not a service outage" in msg
    assert "retrying will fail" in msg


def test_the_message_survives_missing_usage_metadata():
    msg = _budget_message(Response(usage=None), configured=2048)
    assert "2048" in msg
    assert "GEMINI_MAX_OUTPUT_TOKENS" in msg


# --------------------------------------------------------------------------
# what generate() raises
# --------------------------------------------------------------------------


def test_hitting_the_cap_raises_the_specific_error(monkeypatch):
    g = generator(1024)
    monkeypatch.setattr(g, "_ensure_client", lambda: _client(
        Response(text=None, finish_reason="MAX_TOKENS", usage=Usage(868, 0))))

    with pytest.raises(TokenBudgetExceeded) as excinfo:
        g.generate("system", "prompt")
    assert "GEMINI_MAX_OUTPUT_TOKENS" in str(excinfo.value)


def test_the_specific_error_is_still_a_generation_error(monkeypatch):
    """Existing handling catches GenerationError; nothing should start escaping."""
    g = generator(1024)
    monkeypatch.setattr(g, "_ensure_client", lambda: _client(
        Response(text=None, finish_reason="MAX_TOKENS", usage=Usage(868, 0))))

    with pytest.raises(GenerationError):
        g.generate("system", "prompt")


def test_an_empty_response_for_another_reason_stays_generic(monkeypatch):
    g = generator(4096)
    monkeypatch.setattr(g, "_ensure_client", lambda: _client(
        Response(text=None, finish_reason="SAFETY")))

    with pytest.raises(GenerationError) as excinfo:
        g.generate("system", "prompt")
    assert not isinstance(excinfo.value, TokenBudgetExceeded)
    assert "GEMINI_MAX_OUTPUT_TOKENS" not in str(excinfo.value)


def test_a_normal_answer_is_returned_untouched(monkeypatch):
    g = generator(4096)
    monkeypatch.setattr(g, "_ensure_client", lambda: _client(
        Response(text="Kadukkai, Thandrikkai and Nellikkai [1].", finish_reason="STOP")))

    assert g.generate("system", "prompt") == "Kadukkai, Thandrikkai and Nellikkai [1]."


def _client(response):
    """Minimal stand-in for genai.Client."""
    class Models:
        def generate_content(self, **kwargs):
            return response

    class Client:
        models = Models()

    return Client()


# --------------------------------------------------------------------------
# the configured default
# --------------------------------------------------------------------------


def test_the_shipped_budget_clears_the_measured_worst_case():
    """At top_k=6 x 1600 chars, the worst of three identical calls spent 868
    reasoning + 163 output = 1031. The default must leave real headroom, not
    merely exceed that by a token."""
    from app.config import Settings

    budget = Settings().gemini_max_output_tokens
    assert budget >= 2 * 1031, f"budget {budget} leaves too little room above the measured worst case"


def test_the_shipped_model_is_a_pinned_id_not_an_alias():
    from app.config import Settings

    model = Settings().gemini_model
    assert not model.endswith("latest"), (
        f"{model} is an alias - the model behind the citation-grounded prompt "
        "would change without a repo diff"
    )
