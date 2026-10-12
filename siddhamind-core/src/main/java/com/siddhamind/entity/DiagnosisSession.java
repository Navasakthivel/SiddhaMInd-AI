package com.siddhamind.entity;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.ForeignKey;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * One Envagai Thervu session: the eight examination inputs, the deterministic scores
 * derived from them, and the AI note.
 *
 * <p>Holds patient name and complaint, so reads must stay scoped to the recording
 * practitioner - see DiagnosisApiController.
 */
@Entity
@Table(name = "diagnosis_sessions")
public class DiagnosisSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "session_id")
    private Long sessionId;

    /** SET NULL on delete: the clinical record outlives the practitioner account. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "practitioner_id", foreignKey = @ForeignKey(name = "fk_dx_practitioner"))
    private User practitioner;

    @Column(name = "patient_name", length = 150)
    private String patientName;

    private Integer age;

    @Column(length = 20)
    private String gender;

    @Column(columnDefinition = "TEXT")
    private String complaint;

    // --- the eight-fold examination ---
    @Column(length = 100) private String naadi;
    @Column(length = 100) private String naa;
    @Column(length = 100) private String niram;
    @Column(length = 100) private String mozhi;
    @Column(length = 100) private String vizhi;
    @Column(length = 100) private String sparisam;
    @Column(length = 100) private String malam;
    @Column(length = 100) private String moothiram;

    // --- deterministic output ---
    @Column(name = "vatha_score", nullable = false) private int vathaScore;
    @Column(name = "pitha_score", nullable = false) private int pithaScore;
    @Column(name = "kabam_score", nullable = false) private int kabamScore;

    @Column(name = "dominant_kutram", length = 20)
    private String dominantKutram;

    @Column(name = "predicted_disease", length = 200)
    private String predictedDisease;

    @Column(name = "ai_summary", columnDefinition = "TEXT")
    private String aiSummary;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @OneToMany(mappedBy = "session", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("ordinal ASC")
    private List<DiagnosisCandidate> candidates = new ArrayList<>();

    @OneToMany(mappedBy = "session", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("ordinal ASC")
    private List<DiagnosisSuggestion> suggestions = new ArrayList<>();

    public DiagnosisSession() {}

    public void addCandidate(Disease disease) {
        DiagnosisCandidate c = new DiagnosisCandidate();
        c.setSession(this);
        c.setDisease(disease);
        c.setOrdinal(candidates.size());
        candidates.add(c);
    }

    public void addSuggestion(Formulation formulation) {
        DiagnosisSuggestion s = new DiagnosisSuggestion();
        s.setSession(this);
        s.setFormulation(formulation);
        s.setOrdinal(suggestions.size());
        suggestions.add(s);
    }

    public Long getSessionId() { return sessionId; }
    public void setSessionId(Long sessionId) { this.sessionId = sessionId; }

    public User getPractitioner() { return practitioner; }
    public void setPractitioner(User practitioner) { this.practitioner = practitioner; }

    public String getPatientName() { return patientName; }
    public void setPatientName(String patientName) { this.patientName = patientName; }

    public Integer getAge() { return age; }
    public void setAge(Integer age) { this.age = age; }

    public String getGender() { return gender; }
    public void setGender(String gender) { this.gender = gender; }

    public String getComplaint() { return complaint; }
    public void setComplaint(String complaint) { this.complaint = complaint; }

    public String getNaadi() { return naadi; }
    public void setNaadi(String naadi) { this.naadi = naadi; }

    public String getNaa() { return naa; }
    public void setNaa(String naa) { this.naa = naa; }

    public String getNiram() { return niram; }
    public void setNiram(String niram) { this.niram = niram; }

    public String getMozhi() { return mozhi; }
    public void setMozhi(String mozhi) { this.mozhi = mozhi; }

    public String getVizhi() { return vizhi; }
    public void setVizhi(String vizhi) { this.vizhi = vizhi; }

    public String getSparisam() { return sparisam; }
    public void setSparisam(String sparisam) { this.sparisam = sparisam; }

    public String getMalam() { return malam; }
    public void setMalam(String malam) { this.malam = malam; }

    public String getMoothiram() { return moothiram; }
    public void setMoothiram(String moothiram) { this.moothiram = moothiram; }

    public int getVathaScore() { return vathaScore; }
    public void setVathaScore(int vathaScore) { this.vathaScore = vathaScore; }

    public int getPithaScore() { return pithaScore; }
    public void setPithaScore(int pithaScore) { this.pithaScore = pithaScore; }

    public int getKabamScore() { return kabamScore; }
    public void setKabamScore(int kabamScore) { this.kabamScore = kabamScore; }

    public String getDominantKutram() { return dominantKutram; }
    public void setDominantKutram(String dominantKutram) { this.dominantKutram = dominantKutram; }

    public String getPredictedDisease() { return predictedDisease; }
    public void setPredictedDisease(String predictedDisease) { this.predictedDisease = predictedDisease; }

    public String getAiSummary() { return aiSummary; }
    public void setAiSummary(String aiSummary) { this.aiSummary = aiSummary; }

    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }

    public List<DiagnosisCandidate> getCandidates() { return candidates; }
    public void setCandidates(List<DiagnosisCandidate> candidates) { this.candidates = candidates; }

    public List<DiagnosisSuggestion> getSuggestions() { return suggestions; }
    public void setSuggestions(List<DiagnosisSuggestion> suggestions) { this.suggestions = suggestions; }
}
