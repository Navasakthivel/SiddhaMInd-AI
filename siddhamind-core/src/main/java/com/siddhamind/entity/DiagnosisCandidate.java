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

/** A disease the engine considered for a session. {@code ordinal} preserves the deterministic ranking. */
@Entity
@Table(name = "diagnosis_candidates",
        uniqueConstraints = @UniqueConstraint(name = "uq_dxc_session_disease",
                columnNames = {"session_id", "disease_id"}))
public class DiagnosisCandidate {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_dxc_session"))
    private DiagnosisSession session;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "disease_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_dxc_disease"))
    private Disease disease;

    @Column(nullable = false)
    private int ordinal;

    public DiagnosisCandidate() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public DiagnosisSession getSession() { return session; }
    public void setSession(DiagnosisSession session) { this.session = session; }

    public Disease getDisease() { return disease; }
    public void setDisease(Disease disease) { this.disease = disease; }

    public int getOrdinal() { return ordinal; }
    public void setOrdinal(int ordinal) { this.ordinal = ordinal; }
}
