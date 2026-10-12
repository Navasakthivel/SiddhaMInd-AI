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
import jakarta.persistence.UniqueConstraint;

@Entity
@Table(name = "contraindications",
        uniqueConstraints = @UniqueConstraint(name = "uq_contra_form_condition",
                columnNames = {"form_id", "condition_name"}))
public class Contraindication {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "contra_id")
    private Long contraId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "form_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_contra_formulation"))
    private Formulation formulation;

    @Column(name = "condition_name", nullable = false, length = 100)
    private String conditionName;

    /** MAJOR | MODERATE | MINOR - also enforced by a CHECK constraint. */
    @Column(nullable = false, length = 20)
    private String severity;

    @Column(columnDefinition = "TEXT")
    private String note;

    public Contraindication() {}

    public Long getContraId() { return contraId; }
    public void setContraId(Long contraId) { this.contraId = contraId; }

    public Formulation getFormulation() { return formulation; }
    public void setFormulation(Formulation formulation) { this.formulation = formulation; }

    public String getConditionName() { return conditionName; }
    public void setConditionName(String conditionName) { this.conditionName = conditionName; }

    public String getSeverity() { return severity; }
    public void setSeverity(String severity) { this.severity = severity; }

    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }
}
