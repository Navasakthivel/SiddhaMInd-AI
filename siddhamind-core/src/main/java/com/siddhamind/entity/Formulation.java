package com.siddhamind.entity;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;

import java.util.ArrayList;
import java.util.List;

/**
 * A formulation and everything it owns.
 *
 * <p>The three collections are real associations with cascade and orphan removal,
 * replacing the original design's bare join tables with no constraints. Deleting a
 * formulation now removes its composition, indications and contraindications in one
 * operation instead of leaving orphaned rows.
 *
 * <p>All three are LAZY: the list page reads hundreds of formulations and needs none
 * of them, while the detail page fetches them explicitly through
 * {@code FormulationRepository.findDetailById}.
 */
@Entity
@Table(name = "formulations")
public class Formulation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "form_id")
    private Long formId;

    @Column(nullable = false, unique = true, length = 100)
    private String slug;

    @Column(name = "name_tamil", length = 200)
    private String nameTamil;

    @Column(name = "name_english", length = 200)
    private String nameEnglish;

    @Column(name = "sfi_code", length = 30)
    private String sfiCode;

    @Column(name = "dosage_form", length = 50)
    private String dosageForm;

    @Column(name = "source_book", length = 200)
    private String sourceBook;

    @Column(name = "page_no")
    private Integer pageNo;

    @Column(name = "verse_no", length = 30)
    private String verseNo;

    @Column(name = "preparation_method", columnDefinition = "TEXT")
    private String preparationMethod;

    @Column(length = 200)
    private String dose;

    @Column(length = 200)
    private String anupanam;

    @Column(name = "shelf_life", length = 50)
    private String shelfLife;

    @Column(name = "contains_heavy_metal", nullable = false)
    private boolean containsHeavyMetal;

    @Column(name = "safety_class", length = 10)
    private String safetyClass;

    @OneToMany(mappedBy = "formulation", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<FormulationIngredient> ingredients = new ArrayList<>();

    @OneToMany(mappedBy = "formulation", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<FormulationDisease> indications = new ArrayList<>();

    @OneToMany(mappedBy = "formulation", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Contraindication> contraindications = new ArrayList<>();

    public Formulation() {}

    // --- association helpers keep both sides consistent ---

    public void addIngredient(Ingredient ingredient, String quantity, String sutthiNote) {
        FormulationIngredient link = new FormulationIngredient();
        link.setFormulation(this);
        link.setIngredient(ingredient);
        link.setQuantity(quantity);
        link.setSutthiNote(sutthiNote);
        ingredients.add(link);
    }

    public void addIndication(Disease disease, String evidenceNote) {
        FormulationDisease link = new FormulationDisease();
        link.setFormulation(this);
        link.setDisease(disease);
        link.setEvidenceNote(evidenceNote);
        indications.add(link);
    }

    public void addContraindication(String conditionName, String severity, String note) {
        Contraindication contra = new Contraindication();
        contra.setFormulation(this);
        contra.setConditionName(conditionName);
        contra.setSeverity(severity);
        contra.setNote(note);
        contraindications.add(contra);
    }

    public Long getFormId() { return formId; }
    public void setFormId(Long formId) { this.formId = formId; }

    public String getSlug() { return slug; }
    public void setSlug(String slug) { this.slug = slug; }

    public String getNameTamil() { return nameTamil; }
    public void setNameTamil(String nameTamil) { this.nameTamil = nameTamil; }

    public String getNameEnglish() { return nameEnglish; }
    public void setNameEnglish(String nameEnglish) { this.nameEnglish = nameEnglish; }

    public String getSfiCode() { return sfiCode; }
    public void setSfiCode(String sfiCode) { this.sfiCode = sfiCode; }

    public String getDosageForm() { return dosageForm; }
    public void setDosageForm(String dosageForm) { this.dosageForm = dosageForm; }

    public String getSourceBook() { return sourceBook; }
    public void setSourceBook(String sourceBook) { this.sourceBook = sourceBook; }

    public Integer getPageNo() { return pageNo; }
    public void setPageNo(Integer pageNo) { this.pageNo = pageNo; }

    public String getVerseNo() { return verseNo; }
    public void setVerseNo(String verseNo) { this.verseNo = verseNo; }

    public String getPreparationMethod() { return preparationMethod; }
    public void setPreparationMethod(String preparationMethod) { this.preparationMethod = preparationMethod; }

    public String getDose() { return dose; }
    public void setDose(String dose) { this.dose = dose; }

    public String getAnupanam() { return anupanam; }
    public void setAnupanam(String anupanam) { this.anupanam = anupanam; }

    public String getShelfLife() { return shelfLife; }
    public void setShelfLife(String shelfLife) { this.shelfLife = shelfLife; }

    public boolean isContainsHeavyMetal() { return containsHeavyMetal; }
    public void setContainsHeavyMetal(boolean containsHeavyMetal) { this.containsHeavyMetal = containsHeavyMetal; }

    public String getSafetyClass() { return safetyClass; }
    public void setSafetyClass(String safetyClass) { this.safetyClass = safetyClass; }

    public List<FormulationIngredient> getIngredients() { return ingredients; }
    public void setIngredients(List<FormulationIngredient> ingredients) { this.ingredients = ingredients; }

    public List<FormulationDisease> getIndications() { return indications; }
    public void setIndications(List<FormulationDisease> indications) { this.indications = indications; }

    public List<Contraindication> getContraindications() { return contraindications; }
    public void setContraindications(List<Contraindication> contraindications) { this.contraindications = contraindications; }
}
