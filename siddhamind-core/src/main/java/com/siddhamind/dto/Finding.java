package com.siddhamind.dto;

/**
 * One row of a safety verdict, as produced by the rule engine.
 *
 * <p>A record rather than the {@code SafetyCheckFinding} entity, so a verdict can be
 * built, compared and asserted on without a persistence context. The service maps it
 * onto the entity when writing the audit row.
 *
 * @param type "Heavy metal" | "Interaction" | "Contraindication" | "Data error"
 * @param severity MAJOR | MODERATE | MINOR
 */
public record Finding(String subject, String type, String severity, String detail, String advice) {

    /**
     * Bean-style getters beside the record's bare accessors.
     *
     * <p>Added for the template engine that has since been removed. Kept because
     * Jackson serialises a record through its accessors either way and removing
     * them is a wire-format change, not a cleanup.
     */
    public String getSubject() { return subject; }
    public String getType() { return type; }
    public String getSeverity() { return severity; }
    public String getDetail() { return detail; }
    public String getAdvice() { return advice; }
}
