"""Explanation prompts. Pure functions - no key, no network.

What these check is that the prompt cannot be read as an invitation to
re-decide. The type system and the wire shape already make it impossible for a
different verdict to travel back; the prompt is the third layer, and it is the
one that can silently rot, because nothing breaks if the wording drifts.
"""

import pytest

from app.explain.prompts import (
    DIAGNOSIS_SYSTEM,
    SAFETY_SYSTEM,
    build_diagnosis_prompt,
    build_safety_prompt,
)

VERDICT = {
    "formulationName": "Thiripala Chooranam",
    "riskLevel": "MAJOR",
    "findings": [
        {
            "severity": "MAJOR",
            "type": "INTERACTION",
            "subject": "Warfarin",
            "detail": "Increases bleeding risk",
            "advice": "Monitor INR",
        }
    ],
    "unmatchedDrugs": ["aspirin"],
    "majorCount": 1,
    "moderateCount": 0,
    "minorCount": 0,
    "heavyMetalDailyLimitMg": 30.0,
}

SCORES = {
    "vathaScore": 6,
    "pithaScore": 2,
    "kabamScore": 1,
    "dominantKutram": "VATHAM",
    "predictedDisease": "Vatha Suram",
    "candidateDiseases": ["Vatha Suram", "Vatha Gunmam"],
    "suggestedFormulations": ["Nilavembu Kudineer"],
    "inconclusive": False,
}


# --------------------------------------------------------------------------
# the instructions
# --------------------------------------------------------------------------


def test_safety_instructions_fix_the_risk_level():
    assert "ALREADY been decided" in SAFETY_SYSTEM
    assert "risk level is fixed" in SAFETY_SYSTEM.lower()
    assert "never argue it up or down" in SAFETY_SYSTEM.lower()


def test_safety_instructions_forbid_inventing_findings():
    lowered = SAFETY_SYSTEM.lower()
    assert "do not add interactions" in lowered
    # Both directions: adding a plausible interaction and dropping a minor one
    # are equally wrong, and only one of them is the obvious failure.
    assert "do not drop a finding" in lowered


def test_safety_instructions_forbid_altering_quantities():
    assert "copied exactly" in SAFETY_SYSTEM.lower()
    assert "never convert units" in SAFETY_SYSTEM.lower()


def test_diagnosis_instructions_fix_the_kutram():
    assert "ALREADY been scored" in DIAGNOSIS_SYSTEM
    assert "fixed" in DIAGNOSIS_SYSTEM.lower()
    assert "never substitute your own reading" in DIAGNOSIS_SYSTEM.lower()


def test_diagnosis_instructions_forbid_dosing():
    """The note explains a score. A dose comes from the formulary entry."""
    assert "do not state a dose" in DIAGNOSIS_SYSTEM.lower()


def test_diagnosis_instructions_forbid_adding_formulations():
    assert "do not add, remove or reorder" in DIAGNOSIS_SYSTEM.lower()


# --------------------------------------------------------------------------
# safety prompt content
# --------------------------------------------------------------------------


def test_safety_prompt_states_the_risk_level_as_fixed():
    prompt = build_safety_prompt(VERDICT)
    assert "MAJOR" in prompt
    assert "FIXED, do not change" in prompt


def test_safety_prompt_includes_every_finding_field():
    prompt = build_safety_prompt(VERDICT)
    for value in ("Warfarin", "INTERACTION", "Increases bleeding risk", "Monitor INR"):
        assert value in prompt, f"{value!r} missing from the prompt"


def test_safety_prompt_numbers_findings_for_reference():
    prompt = build_safety_prompt(VERDICT)
    assert "1." in prompt


def test_heavy_metal_number_is_described_as_a_limit_not_an_intake():
    """The Java side renamed this field for exactly this reason. Phrasing it as
    the amount the patient receives would misstate what the number is."""
    prompt = build_safety_prompt(VERDICT)
    assert "30.0 mg" in prompt
    assert "ceiling" in prompt.lower()
    assert "NOT the amount the patient receives" in prompt


def test_heavy_metal_section_is_omitted_when_zero():
    verdict = {**VERDICT, "heavyMetalDailyLimitMg": 0.0}
    assert "ceiling" not in build_safety_prompt(verdict).lower()


def test_unscreened_drugs_must_be_declared():
    """A drug the engine could not match was not checked at all. Silence about
    it would read as a clean result."""
    prompt = build_safety_prompt(VERDICT)
    assert "aspirin" in prompt
    assert "not screened" in prompt.lower() or "NOT screened" in prompt
    assert "were not checked" in prompt


def test_no_unmatched_section_when_every_drug_matched():
    verdict = {**VERDICT, "unmatchedDrugs": []}
    assert "not screened" not in build_safety_prompt(verdict).lower()


def test_empty_findings_are_stated_explicitly():
    verdict = {**VERDICT, "findings": [], "majorCount": 0}
    prompt = build_safety_prompt(verdict)
    assert "no findings recorded" in prompt


def test_safety_prompt_survives_a_sparse_verdict():
    minimal = build_safety_prompt({"riskLevel": "SAFE"})
    assert "SAFE" in minimal
    assert "unnamed" in minimal


# --------------------------------------------------------------------------
# diagnosis prompt content
# --------------------------------------------------------------------------


def test_diagnosis_prompt_carries_scores_and_dominant_kutram():
    prompt = build_diagnosis_prompt(SCORES)
    assert "Vatham 6" in prompt and "Pitham 2" in prompt and "Kabam 1" in prompt
    assert "VATHAM" in prompt
    assert "FIXED, do not change" in prompt


def test_diagnosis_prompt_preserves_the_engines_ordering():
    prompt = build_diagnosis_prompt(SCORES)
    assert "in the engine's order" in prompt
    assert prompt.index("Vatha Suram") < prompt.index("Vatha Gunmam")


def test_suggested_formulations_are_listed():
    assert "Nilavembu Kudineer" in build_diagnosis_prompt(SCORES)


def test_inconclusive_examination_is_flagged():
    prompt = build_diagnosis_prompt({**SCORES, "inconclusive": True})
    assert "INCONCLUSIVE" in prompt
    assert "do not name a dominant kutram" in prompt


def test_patient_context_is_included_when_supplied():
    prompt = build_diagnosis_prompt(SCORES, "age 54, hypertensive")
    assert "age 54, hypertensive" in prompt


def test_blank_patient_context_adds_no_empty_section():
    assert "Practitioner's note" not in build_diagnosis_prompt(SCORES, "   ")
    assert "Practitioner's note" not in build_diagnosis_prompt(SCORES, None)


def test_diagnosis_prompt_survives_empty_scores():
    prompt = build_diagnosis_prompt({})
    assert "Vatham 0" in prompt
    assert "none" in prompt


@pytest.mark.parametrize("builder,payload", [
    (build_safety_prompt, VERDICT),
    (build_diagnosis_prompt, SCORES),
])
def test_prompts_end_with_the_actual_request(builder, payload):
    """The instruction nearest the end is the one models follow most reliably."""
    assert builder(payload).rstrip().endswith("sentences.")
