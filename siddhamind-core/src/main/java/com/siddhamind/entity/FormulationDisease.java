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

/** Indication row linking a formulation to a disease it classically treats. */
@Entity
@Table(name = "formulation_diseases",
        uniqueConstraints = @UniqueConstraint(name = "uq_fd_form_disease",
                columnNames = {"form_id", "disease_id"}))
public class FormulationDisease {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "fd_id")
    private Long fdId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "form_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_fd_formulation"))
    private Formulation formulation;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "disease_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_fd_disease"))
    private Disease disease;

    @Column(name = "evidence_note", length = 300)
    private String evidenceNote;

    public FormulationDisease() {}

    public Long getFdId() { return fdId; }
    public void setFdId(Long fdId) { this.fdId = fdId; }

    public Formulation getFormulation() { return formulation; }
    public void setFormulation(Formulation formulation) { this.formulation = formulation; }

    public Disease getDisease() { return disease; }
    public void setDisease(Disease disease) { this.disease = disease; }

    public String getEvidenceNote() { return evidenceNote; }
    public void setEvidenceNote(String evidenceNote) { this.evidenceNote = evidenceNote; }
}
