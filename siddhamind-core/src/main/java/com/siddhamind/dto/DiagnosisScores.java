package com.siddhamind.dto;

import com.siddhamind.entity.Disease;
import com.siddhamind.entity.Formulation;

import java.util.List;

/**
 * The diagnosis engine's output. Immutable, for the same reason as
 * {@link SafetyVerdict}: the AI note is written against a fixed result, never
 * allowed to produce one.
 */
public record DiagnosisScores(
        int vathaScore,
        int pithaScore,
        int kabamScore,
        String dominantKutram,
        String predictedDisease,
        List<Disease> candidateDiseases,
        List<Formulation> suggestedFormulations) {

    public DiagnosisScores {
        candidateDiseases = List.copyOf(candidateDiseases);
        suggestedFormulations = List.copyOf(suggestedFormulations);
    }

    /** Floored at 1 so an all-normal examination renders as 0% rather than dividing by zero. */
    private int total() {
        return Math.max(vathaScore + pithaScore + kabamScore, 1);
    }

    public int vathaPercent() { return vathaScore * 100 / total(); }
    public int pithaPercent() { return pithaScore * 100 / total(); }
    public int kabamPercent() { return kabamScore * 100 / total(); }

    /** True when every answer was "Normal" - no kutram is genuinely elevated. */
    public boolean isInconclusive() {
        return vathaScore == 0 && pithaScore == 0 && kabamScore == 0;
    }
}
