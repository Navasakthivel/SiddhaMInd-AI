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
 * Composition row. The original stored {@code form_id} and {@code ingredient_id} as
 * unconstrained Longs; both are real associations here, and the ingredient side is
 * ON DELETE RESTRICT so an ingredient in use cannot be removed out from under a
 * safety check.
 */
@Entity
@Table(name = "formulation_ingredients",
        uniqueConstraints = @UniqueConstraint(name = "uq_fi_form_ingredient",
                columnNames = {"form_id", "ingredient_id"}))
public class FormulationIngredient {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "fi_id")
    private Long fiId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "form_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_fi_formulation"))
    private Formulation formulation;

    /** EAGER: every read of this row exists to show or check the ingredient. */
    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "ingredient_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_fi_ingredient"))
    private Ingredient ingredient;

    @Column(length = 200)
    private String quantity;

    @Column(name = "sutthi_note", length = 300)
    private String sutthiNote;

    public FormulationIngredient() {}

    public Long getFiId() { return fiId; }
    public void setFiId(Long fiId) { this.fiId = fiId; }

    public Formulation getFormulation() { return formulation; }
    public void setFormulation(Formulation formulation) { this.formulation = formulation; }

    public Ingredient getIngredient() { return ingredient; }
    public void setIngredient(Ingredient ingredient) { this.ingredient = ingredient; }

    public String getQuantity() { return quantity; }
    public void setQuantity(String quantity) { this.quantity = quantity; }

    public String getSutthiNote() { return sutthiNote; }
    public void setSutthiNote(String sutthiNote) { this.sutthiNote = sutthiNote; }
}
