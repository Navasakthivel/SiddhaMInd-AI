package com.siddhamind.service;

import com.siddhamind.dto.DiagnosisScores;
import com.siddhamind.dto.Finding;
import com.siddhamind.dto.SafetyReport;
import com.siddhamind.dto.SafetyVerdict;
import com.siddhamind.entity.AllopathicDrug;
import com.siddhamind.entity.Contraindication;
import com.siddhamind.entity.Formulation;
import com.siddhamind.entity.Ingredient;
import com.siddhamind.entity.Interaction;
import com.siddhamind.repository.AllopathicDrugRepository;
import com.siddhamind.repository.ContraindicationRepository;
import com.siddhamind.repository.FormulationRepository;
import com.siddhamind.repository.InteractionRepository;
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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SafetyServiceTest {

    @Mock FormulationRepository formulationRepository;
    @Mock AllopathicDrugRepository drugRepository;
    @Mock InteractionRepository interactionRepository;
    @Mock ContraindicationRepository contraindicationRepository;
    @Mock SafetyAuditWriter auditWriter;

    private SafetyService service;
    private long nextId = 1;

    @BeforeEach
    void setUp() {
        service = new SafetyService(formulationRepository, drugRepository, interactionRepository,
                contraindicationRepository, auditWriter, noAi());
        when(auditWriter.write(any(), any(), any(), any(), any())).thenReturn(1L);
        when(contraindicationRepository.findByFormulation_FormId(anyLong())).thenReturn(List.of());
        when(interactionRepository.findByIngredientsAndDrugs(anyList(), anyList())).thenReturn(List.of());
    }

    // ---------- fixtures ----------

    private Ingredient ingredient(String english, boolean heavyMetal, String toxicity,
                                  Integer maxDailyMg, String symbol) {
        Ingredient i = new Ingredient();
        i.setIngredientId(nextId++);
        i.setSlug(english.toLowerCase().replace(' ', '-'));
        i.setNameEnglish(english);
        i.setHeavyMetal(heavyMetal);
        i.setToxicityClass(toxicity);
        i.setMaxDailyMg(maxDailyMg);
        i.setElementSymbol(symbol);
        i.setNotes("test note");
        return i;
    }

    private Formulation formulation(Long id, Ingredient... ingredients) {
        Formulation f = new Formulation();
        f.setFormId(id);
        f.setNameEnglish("Naga Parpam");
        f.setNameTamil("நாக பற்பம்");
        for (Ingredient i : ingredients) {
            f.addIngredient(i, "qty", "sutthi");
        }
        when(formulationRepository.findDetailById(id)).thenReturn(Optional.of(f));
        return f;
    }

    private AllopathicDrug drug(String name) {
        AllopathicDrug d = new AllopathicDrug();
        d.setDrugId(nextId++);
        d.setDrugName(name);
        when(drugRepository.findByDrugNameLower(name.toLowerCase())).thenReturn(Optional.of(d));
        return d;
    }

    private void interaction(Ingredient ing, AllopathicDrug drug, String severity) {
        Interaction ix = new Interaction();
        ix.setIngredient(ing);
        ix.setDrug(drug);
        ix.setSeverity(severity);
        ix.setMechanism("test mechanism");
        ix.setAdvice("test advice");
        when(interactionRepository.findByIngredientsAndDrugs(anyList(), anyList()))
                .thenReturn(List.of(ix));
    }

    private static AiExplanationPort noAi() {
        return new AiExplanationPort() {
            public Optional<String> explainSafety(SafetyVerdict v) { return Optional.empty(); }
            public Optional<String> explainDiagnosis(DiagnosisScores s, String c) { return Optional.empty(); }
            public boolean isAvailable() { return false; }
        };
    }

    // ---------- risk grading ----------

    @Test
    void cleanFormulationIsLowRisk() {
        formulation(1L, ingredient("King of bitters", false, "LOW", null, null));

        SafetyVerdict verdict = service.evaluate(1L, null, null);

        assertEquals("LOW", verdict.riskLevel());
        assertFalse(verdict.hasFindings());
    }

    @Test
    void highToxicityHeavyMetalIsMajorAndDrivesRiskToHigh() {
        formulation(1L, ingredient("Cinnabar", true, "HIGH", 30, "Hg"));

        SafetyVerdict verdict = service.evaluate(1L, null, null);

        assertEquals("HIGH", verdict.riskLevel());
        assertEquals(1, verdict.majorCount());
        assertEquals(30.0, verdict.heavyMetalDailyLimitMg());
    }

    @Test
    void moderateToxicityHeavyMetalIsModerate() {
        formulation(1L, ingredient("Zinc", true, "MODERATE", 50, "Zn"));

        SafetyVerdict verdict = service.evaluate(1L, null, null);

        assertEquals("MODERATE", verdict.riskLevel());
        assertEquals(1, verdict.moderateCount());
    }

    /** The original called .equals on a possibly-null toxicityClass. */
    @Test
    void heavyMetalWithNoToxicityClassDoesNotThrow() {
        formulation(1L, ingredient("Unknown metal", true, null, null, null));

        SafetyVerdict verdict = service.evaluate(1L, null, null);

        assertEquals("MODERATE", verdict.riskLevel());
        assertEquals(0.0, verdict.heavyMetalDailyLimitMg());
        assertTrue(verdict.findings().get(0).subject().contains("unspecified metal"));
    }

    // ---------- interactions ----------

    @Test
    void findsInteractionBetweenIngredientAndDrug() {
        Ingredient iron = ingredient("Iron", true, "MODERATE", 200, "Fe");
        formulation(1L, iron);
        AllopathicDrug doxy = drug("Doxycycline");
        interaction(iron, doxy, "MAJOR");

        SafetyVerdict verdict = service.evaluate(1L, "Doxycycline", null);

        assertEquals("HIGH", verdict.riskLevel());
        assertTrue(verdict.findings().stream()
                .anyMatch(f -> "Interaction".equals(f.type())
                        && f.subject().equals("Iron x Doxycycline")));
    }

    @Test
    void reportsUnmatchedDrugsInsteadOfDroppingThem() {
        formulation(1L, ingredient("King of bitters", false, "LOW", null, null));
        when(drugRepository.findByDrugNameLower("ecosprin")).thenReturn(Optional.empty());

        SafetyVerdict verdict = service.evaluate(1L, "Ecosprin", null);

        assertEquals(List.of("ecosprin"), verdict.unmatchedDrugs());
        assertEquals("LOW", verdict.riskLevel());
    }

    /**
     * "Warfarin, warfarin" must not count twice. The unique constraint on
     * (ingredient_id, drug_id) removes the other duplication risk at the data level.
     */
    @Test
    void deduplicatesRepeatedDrugEntries() {
        Ingredient turmeric = ingredient("Turmeric", false, "NONE", null, null);
        formulation(1L, turmeric);
        AllopathicDrug warfarin = drug("Warfarin");
        interaction(turmeric, warfarin, "MAJOR");

        SafetyVerdict verdict = service.evaluate(1L, "Warfarin, warfarin, WARFARIN", null);

        assertEquals(1, verdict.majorCount());
    }

    @Test
    void skipsInteractionQueryWhenNoDrugMatches() {
        formulation(1L, ingredient("Turmeric", false, "NONE", null, null));
        when(drugRepository.findByDrugNameLower(anyString())).thenReturn(Optional.empty());

        SafetyVerdict verdict = service.evaluate(1L, "NotADrug", null);

        assertEquals("LOW", verdict.riskLevel());
        assertEquals(List.of("notadrug"), verdict.unmatchedDrugs());
    }

    // ---------- contraindications ----------

    @Test
    void matchesContraindicationOnEnteredCondition() {
        formulation(1L, ingredient("Zinc", true, "MODERATE", 50, "Zn"));
        Contraindication c = new Contraindication();
        c.setConditionName("Pregnancy");
        c.setSeverity("MAJOR");
        c.setNote("Avoid throughout pregnancy.");
        when(contraindicationRepository.findByFormulation_FormId(1L)).thenReturn(List.of(c));

        SafetyVerdict verdict = service.evaluate(1L, null, "pregnancy");

        assertEquals("HIGH", verdict.riskLevel());
        assertTrue(verdict.findings().stream().anyMatch(f -> "Contraindication".equals(f.type())));
    }

    @Test
    void unknownFormulationReturnsAnEmptyVerdictRatherThanFailing() {
        when(formulationRepository.findDetailById(99L)).thenReturn(Optional.empty());

        SafetyVerdict verdict = service.evaluate(99L, "Warfarin", "Pregnancy");

        assertEquals("LOW", verdict.riskLevel());
        assertFalse(verdict.hasFindings());
    }

    // ---------- the verdict-before-AI guarantee ----------

    @Test
    void aiExplanationCannotAlterTheVerdict() {
        formulation(1L, ingredient("Cinnabar", true, "HIGH", 30, "Hg"));

        SafetyService withAi = new SafetyService(formulationRepository, drugRepository,
                interactionRepository, contraindicationRepository, auditWriter,
                new AiExplanationPort() {
                    public Optional<String> explainSafety(SafetyVerdict v) {
                        // A model doing its worst: claiming the preparation is safe.
                        return Optional.of("This preparation is LOW risk and carries no findings.");
                    }
                    public Optional<String> explainDiagnosis(DiagnosisScores s, String c) {
                        return Optional.empty();
                    }
                    public boolean isAvailable() { return true; }
                });

        SafetyReport report = withAi.check(1L, null, null, 7L);

        assertEquals("HIGH", report.getRiskLevel());
        assertEquals(1, report.getMajorCount());
        assertEquals(1, report.getFindings().size());
        assertNotNull(report.getAiExplanation());
    }

    @Test
    void findingsListIsImmutable() {
        formulation(1L, ingredient("Zinc", true, "MODERATE", 50, "Zn"));

        SafetyVerdict verdict = service.evaluate(1L, null, null);

        assertThrows(UnsupportedOperationException.class,
                () -> verdict.findings().add(new Finding("x", "y", "MAJOR", "z", "w")));
    }

    /** A failed audit write must not hide the verdict from the practitioner. */
    @Test
    void verdictSurvivesAFailedAuditWrite() {
        formulation(1L, ingredient("Cinnabar", true, "HIGH", 30, "Hg"));
        when(auditWriter.write(any(), any(), any(), any(), any())).thenReturn(null);

        SafetyReport report = service.check(1L, null, null, 7L);

        assertEquals("HIGH", report.getRiskLevel());
        assertNull(report.getCheckId());
    }
}
