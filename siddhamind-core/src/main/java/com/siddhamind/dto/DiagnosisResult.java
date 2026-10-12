package com.siddhamind.dto;

import com.siddhamind.entity.Disease;
import com.siddhamind.entity.Formulation;

import java.util.List;

/**
 * What the diagnosis result page renders. Wraps an immutable {@link DiagnosisScores}
 * with the AI note and the persisted session ID.
 */
public class DiagnosisResult {

    private final DiagnosisScores scores;
    private Long sessionId;
    private String aiSummary;

    public DiagnosisResult(DiagnosisScores scores) {
        this.scores = scores;
    }

    public DiagnosisScores getScores() { return scores; }

    public int getVathaScore() { return scores.vathaScore(); }
    public int getPithaScore() { return scores.pithaScore(); }
    public int getKabamScore() { return scores.kabamScore(); }
    public int getVathaPercent() { return scores.vathaPercent(); }
    public int getPithaPercent() { return scores.pithaPercent(); }
    public int getKabamPercent() { return scores.kabamPercent(); }
    public String getDominantKutram() { return scores.dominantKutram(); }
    public String getPredictedDisease() { return scores.predictedDisease(); }
    public List<Disease> getCandidateDiseases() { return scores.candidateDiseases(); }
    public List<Formulation> getSuggestedFormulations() { return scores.suggestedFormulations(); }
    public boolean isInconclusive() { return scores.isInconclusive(); }

    /** Deterministic one-liner, always present even when the AI service is unavailable. */
    public String getKutramSummary() {
        if (scores.isInconclusive()) {
            return "No kutram is elevated - every examination finding was recorded as normal.";
        }
        return "The " + scores.dominantKutram().toLowerCase()
                + " kutram is elevated based on the eight-fold examination findings.";
    }

    public Long getSessionId() { return sessionId; }
    public void setSessionId(Long sessionId) { this.sessionId = sessionId; }

    /** Null until Phase 6; {@link #getKutramSummary()} carries the deterministic reading. */
    public String getAiSummary() { return aiSummary; }
    public void setAiSummary(String aiSummary) { this.aiSummary = aiSummary; }
}
