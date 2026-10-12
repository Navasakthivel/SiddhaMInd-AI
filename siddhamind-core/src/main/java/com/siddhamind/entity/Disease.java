package com.siddhamind.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "diseases")
public class Disease {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "disease_id")
    private Long diseaseId;

    @Column(nullable = false, unique = true, length = 100)
    private String slug;

    @Column(name = "noi_tamil", length = 100)
    private String noiTamil;

    @Column(name = "noi_english", length = 100)
    private String noiEnglish;

    @Column(name = "modern_equivalent", length = 200)
    private String modernEquivalent;

    /** VATHAM | PITHAM | KABAM | MIXED - drives candidate selection in the diagnosis engine. */
    @Column(name = "mukkutram_type", length = 20)
    private String mukkutramType;

    @Column(columnDefinition = "TEXT")
    private String description;

    public Disease() {}

    public Long getDiseaseId() { return diseaseId; }
    public void setDiseaseId(Long diseaseId) { this.diseaseId = diseaseId; }

    public String getSlug() { return slug; }
    public void setSlug(String slug) { this.slug = slug; }

    public String getNoiTamil() { return noiTamil; }
    public void setNoiTamil(String noiTamil) { this.noiTamil = noiTamil; }

    public String getNoiEnglish() { return noiEnglish; }
    public void setNoiEnglish(String noiEnglish) { this.noiEnglish = noiEnglish; }

    public String getModernEquivalent() { return modernEquivalent; }
    public void setModernEquivalent(String modernEquivalent) { this.modernEquivalent = modernEquivalent; }

    public String getMukkutramType() { return mukkutramType; }
    public void setMukkutramType(String mukkutramType) { this.mukkutramType = mukkutramType; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
}
