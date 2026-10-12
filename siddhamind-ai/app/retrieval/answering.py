"""The decision to answer, and the answer itself.

Imports only :mod:`app.retrieval.fusion` and :mod:`app.retrieval.prompt` - no
database, no config, no SDK. That is deliberate. The rule this module enforces -
*never call a language model without passages that justify one* - is the single
most important behaviour in the service, and it is worth being able to test it
on any machine without a database driver, an API key or 2 GB of weights
installed.

The generator arrives as a **factory**, not an instance. If it were an instance
the caller would have to build it before knowing the decision, and "we
constructed a client but did not use it" is a much weaker guarantee than "no
code path reached the client at all". The factory is invoked after the gate or
not at all, and the tests assert the zero-call case directly.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Sequence

from app.retrieval import fusion, prompt as prompt_module
from app.retrieval.fusion import FusedPassage

log = logging.getLogger(__name__)


class GenerationFailed(RuntimeError):
    """The gate passed but the model could not be reached or produced nothing."""


def not_found_response(
    passages: Sequence[FusedPassage],
    decision: fusion.RelevanceDecision,
    diagnostics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The structured refusal.

    Empty citations, because nothing supports an answer - and a refusal carrying
    citations would invite the reader to believe something was found.
    """
    return {
        "answer": prompt_module.NOT_FOUND_MESSAGE,
        "citations": [],
        "notFoundInCorpus": True,
        "retrievalCount": len(passages),
        "reason": decision.reason,
        "diagnostics": dict(diagnostics or {}),
    }


def decide_and_generate(
    question: str,
    passages: Sequence[FusedPassage],
    *,
    dense_floor: float,
    generator_factory: Callable[[], Any],
    snippet_chars: int = 320,
    passage_max_chars: int = 1600,
    diagnostics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Gate, then generate, then resolve citations.

    Synchronous throughout: prompt assembly and the SDK call are both blocking,
    so the caller runs the whole thing in a worker thread rather than
    interleaving awaits around CPU work.
    """
    passages = list(passages)
    diagnostics = dict(diagnostics or {})

    decision = fusion.assess_relevance(passages, dense_floor=dense_floor)
    diagnostics["relevance"] = decision.reason
    diagnostics["bestDenseScore"] = decision.best_dense_score
    diagnostics["keywordMatches"] = decision.keyword_matches

    if not decision.relevant:
        log.info("not found in corpus: %s (question=%r)", decision.reason, question)
        return not_found_response(passages, decision, diagnostics)

    # Nothing above this line may touch the generator.
    generator = generator_factory()

    built = prompt_module.build_prompt(question, passages, max_chars=passage_max_chars)
    try:
        raw = generator.generate(prompt_module.SYSTEM_INSTRUCTION, built)
    except Exception as exc:  # noqa: BLE001 - SDKs raise widely
        raise GenerationFailed(f"{type(exc).__name__}: {exc}") from exc

    parsed = prompt_module.parse_answer(raw, passages, snippet_chars=snippet_chars)

    if parsed.invalid_passage_numbers:
        # Dropped rather than fatal, but worth knowing: a model citing passages
        # it was never given suggests the numbering in the prompt is not landing.
        log.warning(
            "model cited passages that were not supplied: %s (sent %s)",
            parsed.invalid_passage_numbers, len(passages),
        )
    if prompt_module.looks_uncited(parsed.answer):
        log.warning("long answer returned with no citations (question=%r)", question)

    diagnostics["invalidPassageNumbers"] = parsed.invalid_passage_numbers

    return {
        "answer": parsed.answer,
        "citations": [c.to_dict() for c in parsed.citations],
        "notFoundInCorpus": False,
        "retrievalCount": len(passages),
        "reason": decision.reason,
        "diagnostics": diagnostics,
    }
