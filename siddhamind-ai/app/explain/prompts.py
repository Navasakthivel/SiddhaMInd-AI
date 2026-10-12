"""Prompts that phrase a fixed result, and nothing else.

Pure functions - no network, no config - so the wording can be tested directly.

The architectural rule these implement
--------------------------------------
The safety verdict and the diagnosis scores are computed in Java by
deterministic rule engines, before either of these endpoints is called. The
model is handed the finished result and asked to put it in sentences.

That is enforced in three places, and this module is the third:

1. **Type.** ``AiExplanationPort`` takes an immutable ``SafetyVerdict`` and
   returns ``Optional<String>``. There is no return path capable of carrying a
   risk level.
2. **Wire.** These endpoints respond with ``{"explanation": "..."}`` - one
   string. A model that emitted a different verdict would have nowhere to put
   it.
3. **Prompt.** The instructions below forbid re-assessing, re-ranking, adding or
   omitting findings, and say so in the imperative rather than as a preference.

Belt and braces on purpose. A prompt alone is a request, not a guarantee - but
a prompt that contradicts the type system is a bug waiting for someone to widen
the return type, so all three have to agree.
"""

from __future__ import annotations

from typing import Any, Sequence

SAFETY_SYSTEM = """\
You explain drug-safety findings that have ALREADY been decided by a \
deterministic rule engine. You are writing the explanation, not the assessment.

Absolute rules:

1. The risk level is fixed. State it as given. Never argue it up or down, never \
hedge it, never add "however" clauses that undercut it.
2. Use only the findings supplied. Do not add interactions, contraindications or \
cautions from your own knowledge, however plausible - the engine's list is the \
complete list.
3. Do not drop a finding because it seems minor. Every one was included for a \
reason.
4. Quantities, counts and drug names are copied exactly. Never convert units or \
round.
5. Write for a practitioner: plain clinical prose, 2-4 sentences, no headings, \
no bullet lists, no disclaimers.

If the verdict has no findings, say plainly that the rule engine found no \
recorded interaction or contraindication for this combination, and that this \
reflects the contents of the formulary rather than a guarantee of safety."""

DIAGNOSIS_SYSTEM = """\
You explain the result of an Envagai Thervu (eight-fold examination) that has \
ALREADY been scored by a deterministic engine. You are writing the note, not \
making the diagnosis.

Absolute rules:

1. The dominant kutram and the scores are fixed. Report them as given. Never \
substitute your own reading of the signs.
2. The candidate conditions and suggested formulations were selected by the \
engine from the formulary. Do not add, remove or reorder them, and do not \
suggest a preparation that is not in the list.
3. Do not state a dose. This note explains a scoring result; dosing comes from \
the formulary entry and the practitioner.
4. Write for a practitioner: 2-4 sentences of plain clinical prose, no headings \
or bullets.

If the examination was inconclusive - every sign normal - say so directly and \
do not manufacture a dominant kutram."""


def _finding_line(finding: dict[str, Any]) -> str:
    """One finding as a single line, mirroring com.siddhamind.dto.Finding."""
    parts = [str(finding.get("severity") or "UNKNOWN")]
    for key in ("type", "subject", "detail", "advice"):
        value = finding.get(key)
        if value:
            parts.append(str(value))
    return " - ".join(parts)


def build_safety_prompt(verdict: dict[str, Any]) -> str:
    """Render a SafetyVerdict-shaped payload for phrasing."""
    findings: Sequence[dict[str, Any]] = verdict.get("findings") or []
    lines = [
        f"Formulation: {verdict.get('formulationName') or 'unnamed'}",
        f"Risk level (FIXED, do not change): {verdict.get('riskLevel') or 'UNKNOWN'}",
        f"Findings: {len(findings)} "
        f"({verdict.get('majorCount', 0)} major, "
        f"{verdict.get('moderateCount', 0)} moderate, "
        f"{verdict.get('minorCount', 0)} minor)",
    ]

    if findings:
        lines.append("")
        for index, finding in enumerate(findings, start=1):
            lines.append(f"  {index}. {_finding_line(finding)}")
    else:
        lines.append("")
        lines.append("  (no findings recorded)")

    limit = verdict.get("heavyMetalDailyLimitMg")
    if limit:
        # Named precisely because the Java side renamed it for exactly this
        # reason: it is a permitted ceiling, not a measured dose. Phrasing it as
        # intake would misrepresent what the number is.
        lines.append("")
        lines.append(
            f"Combined maximum permitted daily dose of the heavy-metal ingredients: "
            f"{limit} mg. This is a regulatory ceiling, NOT the amount the patient "
            f"receives - describe it as a limit."
        )

    unmatched = verdict.get("unmatchedDrugs") or []
    if unmatched:
        lines.append("")
        lines.append(
            "Drugs the practitioner named that are not in the interaction database, "
            "so they were NOT screened: " + ", ".join(str(d) for d in unmatched)
            + ". Say explicitly that these were not checked."
        )

    lines.append("")
    lines.append("Explain this verdict in 2-4 sentences.")
    return "\n".join(lines)


def build_diagnosis_prompt(scores: dict[str, Any], patient_context: str | None = None) -> str:
    """Render a DiagnosisScores-shaped payload for phrasing."""
    lines = [
        f"Vatham {scores.get('vathaScore', 0)}, "
        f"Pitham {scores.get('pithaScore', 0)}, "
        f"Kabam {scores.get('kabamScore', 0)}",
        f"Dominant kutram (FIXED, do not change): {scores.get('dominantKutram') or 'none'}",
    ]

    predicted = scores.get("predictedDisease")
    if predicted:
        lines.append(f"Engine's predicted noi: {predicted}")

    candidates = scores.get("candidateDiseases") or []
    if candidates:
        lines.append("")
        lines.append("Candidate conditions, in the engine's order:")
        for index, name in enumerate(candidates, start=1):
            lines.append(f"  {index}. {name}")

    formulations = scores.get("suggestedFormulations") or []
    if formulations:
        lines.append("")
        lines.append("Classically indicated preparations selected by the engine:")
        for index, name in enumerate(formulations, start=1):
            lines.append(f"  {index}. {name}")

    if scores.get("inconclusive"):
        lines.append("")
        lines.append(
            "The examination was INCONCLUSIVE - every sign was recorded as normal. "
            "Say so; do not name a dominant kutram."
        )

    if patient_context and patient_context.strip():
        lines.append("")
        lines.append(f"Practitioner's note on the patient: {patient_context.strip()}")

    lines.append("")
    lines.append("Write the explanatory note in 2-4 sentences.")
    return "\n".join(lines)
