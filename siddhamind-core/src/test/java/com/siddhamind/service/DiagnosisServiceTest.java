package com.siddhamind.service;

import com.siddhamind.dto.DiagnosisResult;
import com.siddhamind.dto.DiagnosisScores;
import com.siddhamind.dto.SafetyVerdict;
import com.siddhamind.entity.DiagnosisSession;
import com.siddhamind.entity.Disease;
import com.siddhamind.repository.DiagnosisSessionRepository;
import com.siddhamind.repository.DiseaseRepository;
import com.siddhamind.repository.FormulationRepository;
import com.siddhamind.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DiagnosisServiceTest {

    @Mock DiagnosisSessionRepository sessionRepository;
    @Mock DiseaseRepository diseaseRepository;
    @Mock FormulationRepository formulationRepository;
    @Mock UserRepository userRepository;

    private DiagnosisService service;

    @BeforeEach
    void setUp() {
        service = new DiagnosisService(sessionRepository, diseaseRepository,
                formulationRepository, userRepository, noAi());
        when(diseaseRepository.findCandidatesFor(anyString())).thenReturn(List.of());
        when(formulationRepository.findByDiseaseIds(anyList())).thenReturn(List.of());
        when(userRepository.findById(anyLong())).thenReturn(Optional.empty());
        when(sessionRepository.save(any())).thenAnswer(inv -> {
            DiagnosisSession s = inv.getArgument(0);
            s.setSessionId(42L);
            return s;
        });
    }

    private static AiExplanationPort noAi() {
        return new AiExplanationPort() {
            public Optional<String> explainSafety(SafetyVerdict v) { return Optional.empty(); }
            public Optional<String> explainDiagnosis(DiagnosisScores s, String c) { return Optional.empty(); }
            public boolean isAvailable() { return false; }
        };
    }

    private static Disease disease(long id, String english, String kutram) {
        Disease d = new Disease();
        d.setDiseaseId(id);
        d.setSlug(english.toLowerCase().replace(' ', '-'));
        d.setNoiEnglish(english);
        d.setMukkutramType(kutram);
        return d;
    }

    private DiagnosisSession pureVatham() {
        DiagnosisSession s = new DiagnosisSession();
        s.setNaadi("Vatham (வாதம்) – Snake movement");
        s.setNaa("Dry, rough, fissured");
        s.setNiram("Dark / dusky");
        s.setMozhi("High-pitched / rapid");
        s.setVizhi("Dry / sunken");
        s.setSparisam("Cold / rough / dry");
        s.setMalam("Hard / dry / constipated");
        s.setMoothiram("Scanty / clear");
        return s;
    }

    // ---------- scoring ----------

    /** naadi weighs 3, the other seven weigh 2 each: 3 + (7 x 2) = 17. */
    @Test
    void scoresPureVathamCorrectly() {
        DiagnosisScores scores = service.score(pureVatham());

        assertEquals(17, scores.vathaScore());
        assertEquals(0, scores.pithaScore());
        assertEquals(0, scores.kabamScore());
        assertEquals("VATHAM", scores.dominantKutram());
        assertEquals(100, scores.vathaPercent());
    }

    @Test
    void splitNaadiDistributesPointsAcrossTwoKutrams() {
        DiagnosisSession s = new DiagnosisSession();
        s.setNaadi("Vatha-Pitham");          // 2 vatham, 1 pitham
        s.setNaa("Red, yellowish");          // 2 pitham
        s.setNiram("Normal");
        s.setMozhi("Normal");
        s.setVizhi("Normal");
        s.setSparisam("Normal");
        s.setMalam("Normal");
        s.setMoothiram("Normal");

        DiagnosisScores scores = service.score(s);

        assertEquals(2, scores.vathaScore());
        assertEquals(3, scores.pithaScore());
        assertEquals("PITHAM", scores.dominantKutram());
    }

    @Test
    void percentagesSumSensibly() {
        DiagnosisScores scores = service.score(pureVatham());
        assertEquals(100, scores.vathaPercent() + scores.pithaPercent() + scores.kabamPercent());
    }

    @Test
    void tieResolvesToVatham() {
        DiagnosisSession s = new DiagnosisSession();
        s.setNaadi("Vatha-Kabam");
        s.setNaa("Pale, coated, moist");
        s.setNiram("Dark / dusky");
        s.setMozhi("Low / slow / nasal");
        s.setVizhi("Dry / sunken");
        s.setSparisam("Normal");
        s.setMalam("Normal");
        s.setMoothiram("Frequent / turbid");
        assertEquals("KABAM", service.score(s).dominantKutram());

        s.setMoothiram("Normal");
        assertEquals("VATHAM", service.score(s).dominantKutram());
    }

    @Test
    void allNormalFindingsAreInconclusive() {
        DiagnosisSession s = new DiagnosisSession();
        s.setNaa("Normal");
        s.setNiram("Normal");
        s.setMozhi("Normal");
        s.setVizhi("Normal");
        s.setSparisam("Normal");
        s.setMalam("Normal");
        s.setMoothiram("Normal");

        DiagnosisScores scores = service.score(s);

        assertTrue(scores.isInconclusive());
        assertEquals("Inconclusive - no abnormal findings", scores.predictedDisease());
        assertTrue(scores.candidateDiseases().isEmpty());
        assertEquals(0, scores.vathaPercent());
    }

    @Test
    void unrecognisedOptionScoresZeroWithoutThrowing() {
        DiagnosisSession s = pureVatham();
        s.setNaa("Something the form never offered");

        assertEquals(15, service.score(s).vathaScore());
    }

    @Test
    void nullAnswersAreSkipped() {
        DiagnosisSession s = new DiagnosisSession();
        s.setNaadi("Kabam (கபம்) – Swan movement");
        DiagnosisScores scores = service.score(s);
        assertEquals(3, scores.kabamScore());
        assertEquals("KABAM", scores.dominantKutram());
    }

    // ---------- candidate ranking ----------

    /**
     * Ordering now comes from the SQL query, not an in-memory sort. The original took
     * whatever row the database returned first, which made the headline prediction
     * vary between identical assessments.
     */
    @Test
    void usesTheDatabaseOrderingForThePrediction() {
        when(diseaseRepository.findCandidatesFor("VATHAM")).thenReturn(List.of(
                disease(1, "Kalladaippu", "VATHAM"),
                disease(2, "Vatha Noi", "VATHAM"),
                disease(3, "Suram", "MIXED")));

        DiagnosisScores scores = service.score(pureVatham());

        assertEquals("Kalladaippu", scores.predictedDisease());
        assertEquals(3, scores.candidateDiseases().size());
    }

    @Test
    void rankingIsStableAcrossRepeatedRuns() {
        when(diseaseRepository.findCandidatesFor("VATHAM")).thenReturn(List.of(
                disease(1, "Malachikkal", "VATHAM"),
                disease(2, "Vatha Noi", "VATHAM")));

        String first = service.score(pureVatham()).predictedDisease();
        for (int i = 0; i < 5; i++) {
            assertEquals(first, service.score(pureVatham()).predictedDisease());
        }
        assertEquals("Malachikkal", first);
    }

    @Test
    void noCandidatesYieldsNoMatch() {
        assertEquals("No match", service.score(pureVatham()).predictedDisease());
    }

    // ---------- the scores-before-AI guarantee ----------

    @Test
    void aiNoteCannotAlterTheScores() {
        when(diseaseRepository.findCandidatesFor("VATHAM"))
                .thenReturn(List.of(disease(1, "Vatha Noi", "VATHAM")));

        DiagnosisService withAi = new DiagnosisService(sessionRepository, diseaseRepository,
                formulationRepository, userRepository, new AiExplanationPort() {
            public Optional<String> explainSafety(SafetyVerdict v) { return Optional.empty(); }
            public Optional<String> explainDiagnosis(DiagnosisScores s, String c) {
                return Optional.of("The dominant kutram is KABAM and the scores are zero.");
            }
            public boolean isAvailable() { return true; }
        });

        DiagnosisResult result = withAi.assess(pureVatham(), 7L);

        assertEquals("VATHAM", result.getDominantKutram());
        assertEquals(17, result.getVathaScore());
        assertEquals("Vatha Noi", result.getPredictedDisease());
        assertFalse(result.getAiSummary().isBlank());
    }

    @Test
    void kutramSummaryIsAlwaysPopulated() {
        DiagnosisResult result = service.assess(pureVatham(), 7L);
        assertTrue(result.getKutramSummary().contains("vatham"));
        assertNull(result.getAiSummary());
    }

    @Test
    void assessPersistsTheSessionWithComputedFields() {
        when(diseaseRepository.findCandidatesFor("VATHAM"))
                .thenReturn(List.of(disease(1, "Vatha Noi", "VATHAM")));

        DiagnosisSession session = pureVatham();
        DiagnosisResult result = service.assess(session, 7L);

        assertEquals(42L, result.getSessionId());
        assertEquals(17, session.getVathaScore());
        assertEquals("VATHAM", session.getDominantKutram());
        assertEquals(1, session.getCandidates().size());
        assertEquals("Vatha Noi", session.getCandidates().get(0).getDisease().getNoiEnglish());
    }
}
