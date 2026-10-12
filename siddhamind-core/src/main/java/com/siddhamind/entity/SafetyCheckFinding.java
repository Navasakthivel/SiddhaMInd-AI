package com.siddhamind.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.ForeignKey;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

/** One row of a persisted safety verdict. Immutable in practice: written once, never edited. */
@Entity
@Table(name = "safety_check_findings")
public class SafetyCheckFinding {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "finding_id")
    private Long findingId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "check_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_finding_check"))
    private SafetyCheck safetyCheck;

    /** Preserves the order the rule engine emitted findings in. */
    @Column(nullable = false)
    private int ordinal;

    @Column(length = 400)
    private String subject;

    /** "Heavy metal" | "Interaction" | "Contraindication" | "Data error". */
    @Column(length = 40)
    private String type;

    @Column(nullable = false, length = 20)
    private String severity;

    @Column(columnDefinition = "TEXT")
    private String detail;

    @Column(columnDefinition = "TEXT")
    private String advice;

    public SafetyCheckFinding() {}

    public Long getFindingId() { return findingId; }
    public void setFindingId(Long findingId) { this.findingId = findingId; }

    public SafetyCheck getSafetyCheck() { return safetyCheck; }
    public void setSafetyCheck(SafetyCheck safetyCheck) { this.safetyCheck = safetyCheck; }

    public int getOrdinal() { return ordinal; }
    public void setOrdinal(int ordinal) { this.ordinal = ordinal; }

    public String getSubject() { return subject; }
    public void setSubject(String subject) { this.subject = subject; }

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    public String getSeverity() { return severity; }
    public void setSeverity(String severity) { this.severity = severity; }

    public String getDetail() { return detail; }
    public void setDetail(String detail) { this.detail = detail; }

    public String getAdvice() { return advice; }
    public void setAdvice(String advice) { this.advice = advice; }
}
