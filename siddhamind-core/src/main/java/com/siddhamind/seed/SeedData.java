package com.siddhamind.seed;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/**
 * Typed view of {@code seed/seed-data.json}.
 *
 * <p>Records deserialize by component name; Spring Boot compiles with
 * {@code -parameters}, so no {@code @JsonProperty} is needed.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record SeedData(
        List<RoleSeed> roles,
        List<UserSeed> users,
        List<IngredientSeed> ingredients,
        List<DiseaseSeed> diseases,
        List<DrugSeed> allopathicDrugs,
        List<FormulationSeed> formulations,
        List<InteractionSeed> interactions,
        List<SourceDocumentSeed> sourceDocuments,
        List<NotificationSeed> notifications) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RoleSeed(String id, String roleName, String description) {}

    /**
     * {@code password} is plaintext in the file and BCrypt-hashed before writing.
     * {@code loginId} is set for the demo practitioner and student only.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UserSeed(String id, String fullName, String email, String password, String phone,
                           String roleId, String loginId, String regNumber, String institution,
                           String status) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record IngredientSeed(String id, String nameTamil, String nameEnglish, String scientificName,
                                 String sourceType, String partUsed, Boolean sutthiRequired,
                                 Boolean heavyMetal, String elementSymbol, String toxicityClass,
                                 Integer maxDailyMg, String notes) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record DiseaseSeed(String id, String noiTamil, String noiEnglish, String modernEquivalent,
                              String mukkutramType, String description) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record DrugSeed(String id, String drugName, String drugClass, String commonBrand, String notes) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record FormulationSeed(String id, String nameTamil, String nameEnglish, String sfiCode,
                                  String dosageForm, String sourceBook, Integer pageNo, String verseNo,
                                  String preparationMethod, String dose, String anupanam, String shelfLife,
                                  Boolean containsHeavyMetal, String safetyClass,
                                  List<FormulationIngredientSeed> ingredients,
                                  List<IndicatedDiseaseSeed> indicatedDiseases,
                                  List<ContraindicationSeed> contraindications) {}

    /** Carries only the reference and the preparation detail - display names are resolved at seed time. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record FormulationIngredientSeed(String ingredientId, String quantity, String sutthiNote) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record IndicatedDiseaseSeed(String diseaseId, String evidenceNote) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ContraindicationSeed(String conditionName, String severity, String note) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record InteractionSeed(String ingredientId, String drugId, String severity,
                                  String mechanism, String advice) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SourceDocumentSeed(String id, String title, String author, String bookCode,
                                     String language, Integer totalPages, String filePath,
                                     String uploadedBy) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record NotificationSeed(String userId, String title, String message) {}
}
