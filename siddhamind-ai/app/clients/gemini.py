"""Gemini generation client.

The only place in the system that calls an LLM. siddhamind-core never talks to
Gemini directly - it calls this service, which owns the key, the prompt and the
grounding rules. Java holding its own key would mean two prompts to keep in
step, and the safety verdict engine sits on that side.

``google-genai`` is imported lazily so the service starts, answers ``/health``
and serves retrieval on a box where the SDK is absent or the key is unset.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Protocol

log = logging.getLogger(__name__)

# How many times a transient upstream failure is retried, and how long to wait
# between attempts. Three attempts over ~2.4s: long enough to ride out the
# capacity blips Gemini returns as 503, short enough that a user waiting on an
# answer does not sit through a visibly stalled request.
_MAX_ATTEMPTS = 3
_BACKOFF_SECONDS = (0.6, 1.8)


def _is_transient(exc: Exception) -> bool:
    """True only for failures where trying again is genuinely likely to work.

    Scoped deliberately narrowly to 503 UNAVAILABLE - the "model is currently
    experiencing high demand" response, which Google documents as temporary and
    which this project has observed succeeding on the very next attempt.

    NOT retried, each for its own reason:
      429  the free tier on several models here is ``limit: 0`` - no allocation
           at all rather than an exhausted daily cap - so waiting never clears
           it and a retry just spends the same budget again (see .env.example).
      4xx  a key, model-name or request-shape fault. Identical next time.
      safety blocks / token caps
           deterministic properties of this prompt and this response.

    Matched on the rendered exception because the SDK raises several unrelated
    types for transport errors and does not expose a stable status attribute on
    all of them.
    """
    text = f"{type(exc).__name__}: {exc}".upper()
    return "503" in text or "UNAVAILABLE" in text


class GenerationError(RuntimeError):
    """Generation could not be completed. Carries a message fit for an operator."""


class TextGenerator(Protocol):
    """What the query service needs from a generator.

    A Protocol rather than a base class so tests can pass a plain object with a
    ``generate`` method - and, more importantly, so a test can assert the method
    was never called on the not-found path.
    """

    def generate(self, system_instruction: str, prompt: str) -> str: ...


class GeminiGenerator:
    """Thin wrapper over ``google-genai``.

    Deliberately synchronous: the SDK's blocking call is driven from a thread by
    the service, which keeps one slow generation from stalling the event loop
    for every other request.
    """

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-2.0-flash",
        *,
        temperature: float = 0.2,
        max_output_tokens: int = 1024,
    ) -> None:
        if not api_key:
            raise GenerationError(
                "GEMINI_API_KEY is not set. Retrieval works without it; generation "
                "does not. Get a key at https://aistudio.google.com/app/apikey."
            )
        self._api_key = api_key
        self._model = model
        self._temperature = temperature
        self._max_output_tokens = max_output_tokens
        self._client: Any = None
        self._lock = threading.Lock()

    def _ensure_client(self) -> Any:
        if self._client is not None:
            return self._client
        with self._lock:
            if self._client is None:
                try:
                    from google import genai
                except ImportError as exc:
                    raise GenerationError(
                        "google-genai is not installed. Add it with "
                        "`pip install google-genai`."
                    ) from exc
                self._client = genai.Client(api_key=self._api_key)
        return self._client

    def generate(self, system_instruction: str, prompt: str) -> str:
        from google.genai import types

        client = self._ensure_client()

        # Retried only for transient upstream failures - see _is_transient for
        # what qualifies and, more importantly, what does not. Without this a
        # single 503 from Gemini's capacity limiter surfaced to the practitioner
        # as "explanation unavailable", when the same call succeeded moments
        # later. The rule engine is never gated on this, so the cost of trying
        # again is a short wait, not a wrong verdict.
        response = None
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                response = client.models.generate_content(
                    model=self._model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=self._temperature,
                        max_output_tokens=self._max_output_tokens,
                    ),
                )
                break
            except Exception as exc:  # noqa: BLE001 - SDK raises a wide variety
                if attempt < _MAX_ATTEMPTS and _is_transient(exc):
                    delay = _BACKOFF_SECONDS[attempt - 1]
                    log.warning(
                        "Gemini attempt %d/%d failed transiently (%s); retrying in %.1fs",
                        attempt, _MAX_ATTEMPTS, type(exc).__name__, delay,
                    )
                    time.sleep(delay)
                    continue
                # Out of attempts, or a fault that will fail identically.
                raise GenerationError(f"{type(exc).__name__}: {exc}") from exc

        text = getattr(response, "text", None)
        if not text:
            # A safety filter or a token cap can return a response object with no
            # text at all. Reporting that as an empty answer would look like the
            # corpus had nothing to say, which is a different and misleading claim.
            if _hit_token_cap(response):
                raise TokenBudgetExceeded(_budget_message(response, self._max_output_tokens))
            reason = _blocked_reason(response)
            raise GenerationError(f"the model returned no text ({reason})")
        return text


def _finish_reason(response: Any) -> str:
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return ""
    return str(getattr(candidates[0], "finish_reason", "") or "")


def _hit_token_cap(response: Any) -> bool:
    """True when generation stopped because it ran out of output budget."""
    return "MAX_TOKENS" in _finish_reason(response).upper()


def _budget_message(response: Any, configured: int) -> str:
    """An actionable message naming the setting and what it actually cost.

    Split out from the generic "no text" path deliberately. Running out of
    output budget produces an empty response, which looks exactly like an
    unreachable service - and reaches a practitioner as "the assistant is
    temporarily unavailable, try again", advice that will never work because
    retrying spends the same budget. It is a configuration fault, and the log
    has to say so rather than leave someone waiting for an outage to clear.
    """
    usage = getattr(response, "usage_metadata", None)
    thoughts = getattr(usage, "thoughts_token_count", None)
    output = getattr(usage, "candidates_token_count", None)
    detail = ""
    if thoughts is not None or output is not None:
        detail = f" (reasoning {thoughts}, output {output})"
    return (
        f"the model hit its output cap of {configured} tokens before writing an "
        f"answer{detail}. Raise GEMINI_MAX_OUTPUT_TOKENS - reasoning tokens are "
        f"charged against the same budget, so a value that suffices for the "
        f"answer text alone is not enough. This is a configuration limit, not a "
        f"service outage; retrying will fail identically."
    )


class TokenBudgetExceeded(GenerationError):
    """The output cap was hit before any answer text was produced.

    A subclass of {@link GenerationError} so existing handling still catches it,
    but distinguishable for callers and greppable in logs.
    """


def _blocked_reason(response: Any) -> str:
    feedback = getattr(response, "prompt_feedback", None)
    if feedback is not None and getattr(feedback, "block_reason", None):
        return f"blocked: {feedback.block_reason}"
    candidates = getattr(response, "candidates", None) or []
    if candidates:
        finish = getattr(candidates[0], "finish_reason", None)
        if finish:
            return f"finish_reason={finish}"
    return "no reason reported"


_generator: GeminiGenerator | None = None
_generator_lock = threading.Lock()


def get_generator(settings: Any) -> GeminiGenerator:
    """Cached generator for the configured model.

    Cached because constructing the SDK client sets up an HTTP session; a new
    one per request would leak connections under load.
    """
    global _generator
    with _generator_lock:
        if _generator is None:
            _generator = GeminiGenerator(
                settings.gemini_api_key,
                settings.gemini_model,
                temperature=settings.gemini_temperature,
                max_output_tokens=settings.gemini_max_output_tokens,
            )
        return _generator


def reset_generator() -> None:
    """Drop the cached client. Used by tests."""
    global _generator
    with _generator_lock:
        _generator = None
