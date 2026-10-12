package com.siddhamind.seed;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.io.InputStream;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Verifies the seed file parses and is internally consistent, without a database.
 * The row counts are asserted against the original data.sql so the port cannot
 * quietly lose rows across two database migrations.
 */
class SeedDataTest {

    private static SeedData data;

    @BeforeAll
    static void load() throws Exception {
        try (InputStream in = new ClassPathResource("seed/seed-data.json").getInputStream()) {
            data = new ObjectMapper().readValue(in, SeedData.class);
        }
    }

    @Test
    void parsesEveryCollection() {
        assertNotNull(data.roles());
        assertNotNull(data.users());
        assertNotNull(data.ingredients());
        assertNotNull(data.diseases());
        assertNotNull(data.allopathicDrugs());
        assertNotNull(data.formulations());
        assertNotNull(data.interactions());
        assertNotNull(data.sourceDocuments());
        assertNotNull(data.notifications());
    }

    /** Row counts from the original data.sql. */
    @Test
    void matchesTheRowCountsOfTheOriginalDataSql() {
        assertEquals(4, data.roles().size(), "roles");
        assertEquals(4, data.users().size(), "users");
        assertEquals(20, data.ingredients().size(), "ingredients");
        assertEquals(13, data.diseases().size(), "diseases");
        assertEquals(12, data.allopathicDrugs().size(), "allopathic_drugs");
        assertEquals(10, data.formulations().size(), "formulations");
        assertEquals(18, data.interactions().size(), "interactions");
        assertEquals(3, data.notifications().size(), "notifications");

        // Counted excluding the synthetic fixture, so this assertion keeps
        // meaning what its name says - parity with the original data.sql - rather
        // than drifting upward every time a test document is added.
        assertEquals(6, data.sourceDocuments().stream()
                .filter(d -> !"test-sample".equals(d.id())).count(), "source_documents");

        assertEquals(15, data.formulations().stream()
                .mapToInt(f -> f.ingredients().size()).sum(), "formulation_ingredients");
        assertEquals(14, data.formulations().stream()
                .mapToInt(f -> f.indicatedDiseases().size()).sum(), "formulation_diseases");
        assertEquals(12, data.formulations().stream()
                .mapToInt(f -> f.contraindications().size()).sum(), "contraindications");
    }

    @Test
    void hasNoDanglingReferences() {
        assertDoesNotThrow(() -> DatabaseSeeder.validate(data));
    }

    /**
     * The synthetic smoke-test fixture, which is generated rather than sourced.
     * Asserted separately from the corpus documents because the PDF is committed:
     * renaming it here without moving the file would leave the ingest endpoint
     * returning 400 with nothing explaining why.
     */
    @Test
    void carriesTheSyntheticTestFixture() {
        SeedData.SourceDocumentSeed fixture = data.sourceDocuments().stream()
                .filter(d -> "test-sample".equals(d.id()))
                .findFirst()
                .orElseThrow(() -> new AssertionError(
                        "seed-data.json has no 'test-sample' source document - "
                                + "regenerate it with scripts/make_test_pdf.py"));

        assertEquals("Synthetic Test Document", fixture.title());
        assertEquals("mixed", fixture.language());
        assertEquals("corpus/test-sample.pdf", fixture.filePath());
        assertEquals(4, fixture.totalPages(), "the fixture is four pages by design");
        assertEquals("admin", fixture.uploadedBy());
    }

    /** Mirrors the uq_interactions_pair constraint. */
    @Test
    void everyInteractionPairIsUnique() {
        Set<String> pairs = new HashSet<>();
        for (SeedData.InteractionSeed ix : data.interactions()) {
            String key = ix.ingredientId() + "/" + ix.drugId();
            assertTrue(pairs.add(key), "duplicate interaction pair: " + key);
        }
    }

    /** Mirrors the uq_contra_form_condition constraint. */
    @Test
    void contraindicationConditionsAreUniqueWithinAFormulation() {
        for (SeedData.FormulationSeed f : data.formulations()) {
            Set<String> names = new HashSet<>();
            for (SeedData.ContraindicationSeed c : f.contraindications()) {
                assertTrue(names.add(c.conditionName()),
                        "formulation '" + f.id() + "' repeats condition " + c.conditionName());
            }
        }
    }

    /** Mirrors the uq_fi_form_ingredient constraint. */
    @Test
    void ingredientsAreUniqueWithinAFormulation() {
        for (SeedData.FormulationSeed f : data.formulations()) {
            Set<String> ids = new HashSet<>();
            for (SeedData.FormulationIngredientSeed fi : f.ingredients()) {
                assertTrue(ids.add(fi.ingredientId()),
                        "formulation '" + f.id() + "' repeats ingredient " + fi.ingredientId());
            }
        }
    }

    @Test
    void heavyMetalFlagsAgreeBetweenIngredientsAndFormulations() {
        Set<String> heavyMetalIngredients = new HashSet<>();
        for (SeedData.IngredientSeed i : data.ingredients()) {
            if (Boolean.TRUE.equals(i.heavyMetal())) {
                heavyMetalIngredients.add(i.id());
            }
        }
        for (SeedData.FormulationSeed f : data.formulations()) {
            boolean anyHeavyMetal = f.ingredients().stream()
                    .anyMatch(fi -> heavyMetalIngredients.contains(fi.ingredientId()));
            assertEquals(anyHeavyMetal, Boolean.TRUE.equals(f.containsHeavyMetal()),
                    "formulation '" + f.id() + "' containsHeavyMetal disagrees with its ingredients");
        }
    }

    /** Mirrors the ck_interactions_severity and ck_contra_severity CHECK constraints. */
    @Test
    void severitiesAreWithinTheAllowedSet() {
        Set<String> allowed = Set.of("MAJOR", "MODERATE", "MINOR");
        for (SeedData.InteractionSeed ix : data.interactions()) {
            assertTrue(allowed.contains(ix.severity()), "bad interaction severity: " + ix.severity());
        }
        for (SeedData.FormulationSeed f : data.formulations()) {
            for (SeedData.ContraindicationSeed c : f.contraindications()) {
                assertTrue(allowed.contains(c.severity()), "bad contraindication severity: " + c.severity());
            }
        }
    }

    @Test
    void userPasswordsArePlaintextForTheSeederToHash() {
        for (SeedData.UserSeed u : data.users()) {
            assertNotNull(u.password(), "user " + u.id() + " has no password");
            assertTrue(u.password().length() < 60,
                    "user " + u.id() + " looks like it already holds a hash");
        }
    }
}
