"""Explanation endpoints. Phrase a decided result; never produce one.

Both responses carry exactly one field: ``explanation``. That is the wire-level
half of the guarantee - a model that tried to hand back a different risk level
or a different dominant kutram would have nowhere to put it, and Java's
``AiExplanationPort`` returns ``Optional<String>`` so it could not receive one
either.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.explain import prompts
from app.security import require_internal_token

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/explain",
    tags=["explain"],
    dependencies=[Depends(require_internal_token)],
)


class Finding(BaseModel):
    """Mirrors com.siddhamind.dto.Finding."""

    severity: str | None = None
    type: str | None = None
    subject: str | None = None
    detail: str | None = None
    advice: str | None = None


class SafetyVerdictPayload(BaseModel):
    """Mirrors com.siddhamind.dto.SafetyVerdict.

    Read-only as far as this service is concerned - it is rendered into a prompt
    and never sent back.
    """

    formulationName: str | None = None
    riskLevel: str
    findings: list[Finding] = Field(default_factory=list)
    unmatchedDrugs: list[str] = Field(default_factory=list)
    majorCount: int = 0
    moderateCount: int = 0
    minorCount: int = 0
    heavyMetalDailyLimitMg: float = 0.0


class DiagnosisScoresPayload(BaseModel):
    """Mirrors com.siddhamind.dto.DiagnosisScores, flattened.

    ``candidateDiseases`` and ``suggestedFormulations`` arrive as plain name
    strings. On the Java side they are JPA entities; serialising those directly
    would drag lazy proxies over the wire, and with open-in-view disabled it
    would throw rather than merely waste bandwidth.
    """

    vathaScore: int = 0
    pithaScore: int = 0
    kabamScore: int = 0
    dominantKutram: str | None = None
    predictedDisease: str | None = None
    candidateDiseases: list[str] = Field(default_factory=list)
    suggestedFormulations: list[str] = Field(default_factory=list)
    inconclusive: bool = False
    patientContext: str | None = None


class Explanation(BaseModel):
    """The entire response surface. One string, by design."""

    explanation: str


def _generate(system: str, prompt: str, settings: Settings) -> str:
    from app.clients import gemini

    generator = gemini.get_generator(settings)
    return generator.generate(system, prompt)


async def _explain(system: str, prompt: str, settings: Settings, what: str) -> dict:
    try:
        text = await asyncio.to_thread(_generate, system, prompt, settings)
    except Exception as exc:  # noqa: BLE001
        # 502 rather than 500: the failure is upstream. Java turns any non-200
        # into Optional.empty() and the deterministic verdict is displayed
        # without a phrased explanation, which is a degraded view of a correct
        # result - not an error the practitioner needs to see.
        log.warning("%s explanation unavailable: %s: %s", what, type(exc).__name__, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"explanation unavailable: {exc}",
        ) from exc
    return {"explanation": text.strip()}


@router.post("/safety", response_model=Explanation)
async def explain_safety(
    verdict: SafetyVerdictPayload,
    settings: Settings = Depends(get_settings),
) -> dict:
    """Phrase an already-computed safety verdict.

    Cannot alter it: the verdict arrives fully formed, and the response carries
    only prose.
    """
    return await _explain(
        prompts.SAFETY_SYSTEM,
        prompts.build_safety_prompt(verdict.model_dump()),
        settings,
        "safety",
    )


@router.post("/diagnosis", response_model=Explanation)
async def explain_diagnosis(
    scores: DiagnosisScoresPayload,
    settings: Settings = Depends(get_settings),
) -> dict:
    """Phrase an already-computed Envagai Thervu result."""
    payload = scores.model_dump()
    return await _explain(
        prompts.DIAGNOSIS_SYSTEM,
        prompts.build_diagnosis_prompt(payload, payload.get("patientContext")),
        settings,
        "diagnosis",
    )
