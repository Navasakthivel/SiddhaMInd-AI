package com.siddhamind.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * The authoritative home for toxicity data. The safety engine reads this row, never
 * a copy held elsewhere.
 *
 * <p>{@code slug} is the stable natural key the seed file references
 * ({@code zinc}, {@code white-arsenic}); {@code ingredientId} is the surrogate key
 * the foreign keys use.
 */
@Entity
@Table(name = "ingredients")
public class Ingredient {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "ingredient_id")
    private Long ingredientId;

    @Column(nullable = false, unique = true, length = 100)
    private String slug;

    @Column(name = "name_tamil", length = 100)
    private String nameTamil;

    @Column(name = "name_english", length = 100)
    private String nameEnglish;

    @Column(name = "scientific_name", length = 200)
    private String scientificName;

    @Column(name = "source_type", length = 20)
    private String sourceType;

    @Column(name = "part_used", length = 100)
    private String partUsed;

    @Column(name = "sutthi_required", nullable = false)
    private boolean sutthiRequired;

    @Column(name = "heavy_metal", nullable = false)
    private boolean heavyMetal;

    @Column(name = "element_symbol", length = 5)
    private String elementSymbol;

    @Column(name = "toxicity_class", length = 20)
    private String toxicityClass;

    @Column(name = "max_daily_mg")
    private Integer maxDailyMg;

    @Column(columnDefinition = "TEXT")
    private String notes;

    public Ingredient() {}

    public Long getIngredientId() { return ingredientId; }
    public void setIngredientId(Long ingredientId) { this.ingredientId = ingredientId; }

    public String getSlug() { return slug; }
    public void setSlug(String slug) { this.slug = slug; }

    public String getNameTamil() { return nameTamil; }
    public void setNameTamil(String nameTamil) { this.nameTamil = nameTamil; }

    public String getNameEnglish() { return nameEnglish; }
    public void setNameEnglish(String nameEnglish) { this.nameEnglish = nameEnglish; }

    public String getScientificName() { return scientificName; }
    public void setScientificName(String scientificName) { this.scientificName = scientificName; }

    public String getSourceType() { return sourceType; }
    public void setSourceType(String sourceType) { this.sourceType = sourceType; }

    public String getPartUsed() { return partUsed; }
    public void setPartUsed(String partUsed) { this.partUsed = partUsed; }

    public boolean isSutthiRequired() { return sutthiRequired; }
    public void setSutthiRequired(boolean sutthiRequired) { this.sutthiRequired = sutthiRequired; }

    public boolean isHeavyMetal() { return heavyMetal; }
    public void setHeavyMetal(boolean heavyMetal) { this.heavyMetal = heavyMetal; }

    public String getElementSymbol() { return elementSymbol; }
    public void setElementSymbol(String elementSymbol) { this.elementSymbol = elementSymbol; }

    public String getToxicityClass() { return toxicityClass; }
    public void setToxicityClass(String toxicityClass) { this.toxicityClass = toxicityClass; }

    public Integer getMaxDailyMg() { return maxDailyMg; }
    public void setMaxDailyMg(Integer maxDailyMg) { this.maxDailyMg = maxDailyMg; }

    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }
}
