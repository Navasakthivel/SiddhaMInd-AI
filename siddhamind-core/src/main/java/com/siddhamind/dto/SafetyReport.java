package com.siddhamind.dto;

import java.util.List;

/**
 * What the safety page renders: an immutable {@link SafetyVerdict} plus the optional
 * AI phrasing of it, plus the ID of the persisted audit record.
 */
public class SafetyReport {

    private final SafetyVerdict verdict;
    private String aiExplanation;
    private Long checkId;

    public SafetyReport(SafetyVerdict verdict) {
        this.verdict = verdict;
    }

    public SafetyVerdict getVerdict() { return verdict; }

    public String getFormulationName() { return verdict.formulationName(); }
    public String getRiskLevel() { return verdict.riskLevel(); }
    public List<Finding> getFindings() { return verdict.findings(); }
    public List<String> getUnmatchedDrugs() { return verdict.unmatchedDrugs(); }
    public int getMajorCount() { return verdict.majorCount(); }
    public int getModerateCount() { return verdict.moderateCount(); }
    public int getMinorCount() { return verdict.minorCount(); }
    public double getHeavyMetalDailyLimitMg() { return verdict.heavyMetalDailyLimitMg(); }

    /** Null until Phase 6 wires the Python AI service; the verdict stands without it. */
    public String getAiExplanation() { return aiExplanation; }
    public void setAiExplanation(String aiExplanation) { this.aiExplanation = aiExplanation; }

    public Long getCheckId() { return checkId; }
    public void setCheckId(Long checkId) { this.checkId = checkId; }
}
