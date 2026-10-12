package com.siddhamind.service;

import com.siddhamind.dto.DiagnosisScores;
import com.siddhamind.dto.SafetyVerdict;

import java.util.Optional;

/**
 * The only channel through which an LLM touches the safety or diagnosis features.
 *
 * <p>Both methods take an already-computed, immutable result and return prose. The
 * signatures are the enforcement mechanism: there is no way for an implementation to
 * hand back a different risk level or a different dominant kutram, because it cannot
 * return one.
 *
 * <p>Phase 6 supplies an implementation that calls siddhamind-ai over internal REST.
 * Until then {@link NoOpAiExplanationAdapter} returns empty and every feature works
 * without it - the deterministic output is the product, the phrasing is a garnish.
 */
public interface AiExplanationPort {

    /** @return AI phrasing of an existing verdict, or empty when unavailable. */
    Optional<String> explainSafety(SafetyVerdict verdict);

    /** @return AI phrasing of existing scores, or empty when unavailable. */
    Optional<String> explainDiagnosis(DiagnosisScores scores, String patientContext);

    boolean isAvailable();
}
