package com.siddhamind.dto;

import java.util.List;

/**
 * The rule engine's output. Immutable by construction.
 *
 * <p>This exists as a separate type from {@link SafetyReport} so the AI service
 * cannot influence a verdict. The explanation port receives one of these and returns
 * a {@code String} - there is no path by which a model response can change
 * {@code riskLevel} or the findings, because it is never handed anything mutable and
 * its return type carries no verdict fields.
 */
public record SafetyVerdict(
        String formulationName,
        String riskLevel,
        List<Finding> findings,
        List<String> unmatchedDrugs,
        int majorCount,
        int moderateCount,
        int minorCount,
        double heavyMetalDailyLimitMg) {

    public SafetyVerdict {
        findings = List.copyOf(findings);
        unmatchedDrugs = List.copyOf(unmatchedDrugs);
    }

    /**
     * Sum of the maximum permitted daily dose of each heavy-metal ingredient, in mg.
     *
     * <p><b>A limit, not a measured content.</b> The original computed this same sum
     * and named it {@code heavyMetalLoadMg}, which reads as "how much metal the
     * patient receives" - it is not. Actual content is not derivable from this data:
     * formulation quantities are free text ({@code "35 கிராம்"},
     * {@code "தேவையான அளவு"}) with no elemental yield after sutthi and pudam.
     */
    public double heavyMetalDailyLimitMg() {
        return heavyMetalDailyLimitMg;
    }

    public boolean hasFindings() {
        return !findings.isEmpty();
    }
}
