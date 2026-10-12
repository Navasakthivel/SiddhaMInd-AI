package com.siddhamind.entity;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.ForeignKey;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Audit record for one safety check.
 *
 * <p>Both associations are optional and ON DELETE SET NULL: an audit row has to
 * outlive the user who ran it and the formulation it was about.
 * {@code formulationName} is denormalized for exactly that reason - after the
 * formulation is gone, the record still says what was checked.
 */
@Entity
@Table(name = "safety_checks")
public class SafetyCheck {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "check_id")
    private Long checkId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", foreignKey = @ForeignKey(name = "fk_safety_user"))
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "form_id", foreignKey = @ForeignKey(name = "fk_safety_formulation"))
    private Formulation formulation;

    @Column(name = "formulation_name", length = 400)
    private String formulationName;

    @Column(name = "drugs_entered", columnDefinition = "TEXT")
    private String drugsEntered;

    @Column(name = "conditions_entered", columnDefinition = "TEXT")
    private String conditionsEntered;

    /** HIGH | MODERATE | LOW - computed by the rule engine, never by a model. */
    @Column(name = "risk_level", nullable = false, length = 20)
    private String riskLevel;

    @Column(name = "major_count", nullable = false)
    private int majorCount;

    @Column(name = "moderate_count", nullable = false)
    private int moderateCount;

    @Column(name = "minor_count", nullable = false)
    private int minorCount;

    @Column(name = "heavy_metal_daily_limit_mg", nullable = false)
    private double heavyMetalDailyLimitMg;

    /** Comma-joined; these matched no drug record and are shown back to the user. */
    @Column(name = "unmatched_drugs", columnDefinition = "TEXT")
    private String unmatchedDrugs;

    @Column(name = "ai_explanation", columnDefinition = "TEXT")
    private String aiExplanation;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    /**
     * Was a nested array in Firestore. As an owned child collection the audit row
     * still shows exactly what the practitioner was told, even if the interaction
     * rule behind a finding is edited later.
     */
    @OneToMany(mappedBy = "safetyCheck", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("ordinal ASC")
    private List<SafetyCheckFinding> findings = new ArrayList<>();

    public SafetyCheck() {}

    public void addFinding(String subject, String type, String severity, String detail, String advice) {
        SafetyCheckFinding finding = new SafetyCheckFinding();
        finding.setSafetyCheck(this);
        finding.setOrdinal(findings.size());
        finding.setSubject(subject);
        finding.setType(type);
        finding.setSeverity(severity);
        finding.setDetail(detail);
        finding.setAdvice(advice);
        findings.add(finding);
    }

    public Long getCheckId() { return checkId; }
    public void setCheckId(Long checkId) { this.checkId = checkId; }

    public User getUser() { return user; }
    public void setUser(User user) { this.user = user; }

    public Formulation getFormulation() { return formulation; }
    public void setFormulation(Formulation formulation) { this.formulation = formulation; }

    public String getFormulationName() { return formulationName; }
    public void setFormulationName(String formulationName) { this.formulationName = formulationName; }

    public String getDrugsEntered() { return drugsEntered; }
    public void setDrugsEntered(String drugsEntered) { this.drugsEntered = drugsEntered; }

    public String getConditionsEntered() { return conditionsEntered; }
    public void setConditionsEntered(String conditionsEntered) { this.conditionsEntered = conditionsEntered; }

    public String getRiskLevel() { return riskLevel; }
    public void setRiskLevel(String riskLevel) { this.riskLevel = riskLevel; }

    public int getMajorCount() { return majorCount; }
    public void setMajorCount(int majorCount) { this.majorCount = majorCount; }

    public int getModerateCount() { return moderateCount; }
    public void setModerateCount(int moderateCount) { this.moderateCount = moderateCount; }

    public int getMinorCount() { return minorCount; }
    public void setMinorCount(int minorCount) { this.minorCount = minorCount; }

    public double getHeavyMetalDailyLimitMg() { return heavyMetalDailyLimitMg; }
    public void setHeavyMetalDailyLimitMg(double v) { this.heavyMetalDailyLimitMg = v; }

    public String getUnmatchedDrugs() { return unmatchedDrugs; }
    public void setUnmatchedDrugs(String unmatchedDrugs) { this.unmatchedDrugs = unmatchedDrugs; }

    public String getAiExplanation() { return aiExplanation; }
    public void setAiExplanation(String aiExplanation) { this.aiExplanation = aiExplanation; }

    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }

    public List<SafetyCheckFinding> getFindings() { return findings; }
    public void setFindings(List<SafetyCheckFinding> findings) { this.findings = findings; }
}
