package com.siddhamind.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.util.Locale;

@Entity
@Table(name = "allopathic_drugs")
public class AllopathicDrug {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "drug_id")
    private Long drugId;

    @Column(nullable = false, unique = true, length = 100)
    private String slug;

    @Column(name = "drug_name", nullable = false, length = 100)
    private String drugName;

    /** Kept in sync by {@link #setDrugName}; backs the case-insensitive lookup. */
    @Column(name = "drug_name_lower", nullable = false, length = 100)
    private String drugNameLower;

    @Column(name = "drug_class", length = 100)
    private String drugClass;

    @Column(name = "common_brand", length = 100)
    private String commonBrand;

    @Column(columnDefinition = "TEXT")
    private String notes;

    public AllopathicDrug() {}

    public Long getDrugId() { return drugId; }
    public void setDrugId(Long drugId) { this.drugId = drugId; }

    public String getSlug() { return slug; }
    public void setSlug(String slug) { this.slug = slug; }

    public String getDrugName() { return drugName; }

    public void setDrugName(String drugName) {
        this.drugName = drugName;
        this.drugNameLower = drugName == null ? null : drugName.toLowerCase(Locale.ROOT).trim();
    }

    public String getDrugNameLower() { return drugNameLower; }
    public void setDrugNameLower(String drugNameLower) { this.drugNameLower = drugNameLower; }

    public String getDrugClass() { return drugClass; }
    public void setDrugClass(String drugClass) { this.drugClass = drugClass; }

    public String getCommonBrand() { return commonBrand; }
    public void setCommonBrand(String commonBrand) { this.commonBrand = commonBrand; }

    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }
}
