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

/**
 * One ingredient-drug interaction rule.
 *
 * <p>The unique constraint on the pair carries over the guarantee the Firestore
 * composite document ID gave for free: a pair cannot be recorded twice, so the
 * safety engine cannot double-count one interaction toward a risk level. The
 * original MySQL schema permitted duplicates.
 */
@Entity
@Table(name = "interactions",
        uniqueConstraints = @UniqueConstraint(name = "uq_interactions_pair",
                columnNames = {"ingredient_id", "drug_id"}))
public class Interaction {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "interaction_id")
    private Long interactionId;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "ingredient_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_interactions_ingredient"))
    private Ingredient ingredient;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "drug_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_interactions_drug"))
    private AllopathicDrug drug;

    @Column(nullable = false, length = 20)
    private String severity;

    @Column(columnDefinition = "TEXT")
    private String mechanism;

    @Column(columnDefinition = "TEXT")
    private String advice;

    public Interaction() {}

    public Long getInteractionId() { return interactionId; }
    public void setInteractionId(Long interactionId) { this.interactionId = interactionId; }

    public Ingredient getIngredient() { return ingredient; }
    public void setIngredient(Ingredient ingredient) { this.ingredient = ingredient; }

    public AllopathicDrug getDrug() { return drug; }
    public void setDrug(AllopathicDrug drug) { this.drug = drug; }

    public String getSeverity() { return severity; }
    public void setSeverity(String severity) { this.severity = severity; }

    public String getMechanism() { return mechanism; }
    public void setMechanism(String mechanism) { this.mechanism = mechanism; }

    public String getAdvice() { return advice; }
    public void setAdvice(String advice) { this.advice = advice; }
}
