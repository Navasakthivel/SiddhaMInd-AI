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

/** A formulation suggested for a session, in the order the engine produced it. */
@Entity
@Table(name = "diagnosis_suggestions",
        uniqueConstraints = @UniqueConstraint(name = "uq_dxs_session_form",
                columnNames = {"session_id", "form_id"}))
public class DiagnosisSuggestion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_dxs_session"))
    private DiagnosisSession session;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "form_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_dxs_formulation"))
    private Formulation formulation;

    @Column(nullable = false)
    private int ordinal;

    public DiagnosisSuggestion() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public DiagnosisSession getSession() { return session; }
    public void setSession(DiagnosisSession session) { this.session = session; }

    public Formulation getFormulation() { return formulation; }
    public void setFormulation(Formulation formulation) { this.formulation = formulation; }

    public int getOrdinal() { return ordinal; }
    public void setOrdinal(int ordinal) { this.ordinal = ordinal; }
}
