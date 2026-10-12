package com.siddhamind.service;

import com.siddhamind.dto.Finding;
import com.siddhamind.dto.SafetyReport;
import com.siddhamind.dto.SafetyVerdict;
import com.siddhamind.entity.AllopathicDrug;
import com.siddhamind.entity.Contraindication;
import com.siddhamind.entity.Formulation;
import com.siddhamind.entity.FormulationIngredient;
import com.siddhamind.entity.Ingredient;
import com.siddhamind.entity.Interaction;
import com.siddhamind.repository.AllopathicDrugRepository;
import com.siddhamind.repository.ContraindicationRepository;
import com.siddhamind.repository.FormulationRepository;
import com.siddhamind.repository.InteractionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * The deterministic drug-safety rule engine.
 *
 * <p>Order of operations is the point of this class:
 *
 * <ol>
 *   <li>{@link #evaluate} applies the rules and returns an immutable
 *       {@link SafetyVerdict}. No AI involvement.</li>
 *   <li>{@link #check} persists that verdict as an audit record.</li>
 *   <li>Only then is {@link AiExplanationPort} asked for prose, and only the
 *       explanation field of the report is filled in.</li>
 * </ol>
 *
 * <p>The verdict is a record and the AI port returns a {@code String}, so step 3
 * cannot alter what step 1 decided even if the model tries.
 */
@Service
public class SafetyService {

    private final FormulationRepository formulationRepository;
    private final AllopathicDrugRepository drugRepository;
    private final InteractionRepository interactionRepository;
    private final ContraindicationRepository contraindicationRepository;
    private final SafetyAuditWriter auditWriter;
    private final AiExplanationPort ai;

    public SafetyService(FormulationRepository formulationRepository,
                         AllopathicDrugRepository drugRepository,
                         InteractionRepository interactionRepository,
                         ContraindicationRepository contraindicationRepository,
                         SafetyAuditWriter auditWriter,
                         AiExplanationPort ai) {
        this.formulationRepository = formulationRepository;
        this.drugRepository = drugRepository;
        this.interactionRepository = interactionRepository;
        this.contraindicationRepository = contraindicationRepository;
        this.auditWriter = auditWriter;
        this.ai = ai;
    }

    /** Full flow: evaluate, persist, then optionally phrase. */
    public SafetyReport check(Long formId, String drugsText, String conditionsText, Long userId) {
        SafetyVerdict verdict = evaluate(formId, drugsText, conditionsText);
        SafetyReport report = new SafetyReport(verdict);

        report.setCheckId(auditWriter.write(verdict, formId, drugsText, conditionsText, userId));

        if (verdict.hasFindings()) {
            ai.explainSafety(verdict).ifPresent(report::setAiExplanation);
        }
        return report;
    }

    /**
     * The rule engine proper. Pure with respect to the AI service - it is not
     * referenced here at all.
     */
    @Transactional(readOnly = true)
    public SafetyVerdict evaluate(Long formId, String drugsText, String conditionsText) {
        Formulation formulation = formulationRepository.findDetailById(formId).orElse(null);
        if (formulation == null) {
            return new SafetyVerdict("Unknown formulation", "LOW", List.of(), List.of(), 0, 0, 0, 0);
        }

        String name = formulation.getNameEnglish() + " / " + formulation.getNameTamil();
        List<Finding> findings = new ArrayList<>();

        // The FK on formulation_ingredients.ingredient_id is ON DELETE RESTRICT, so
        // unlike the Firestore version this list cannot contain a dangling reference.
        // The database enforces what the old code had to detect and report.
        List<Ingredient> ingredients = formulation.getIngredients().stream()
                .map(FormulationIngredient::getIngredient)
                .toList();

        double heavyMetalDailyLimitMg = collectHeavyMetalFindings(ingredients, findings);
        List<String> unmatchedDrugs = collectInteractionFindings(ingredients, drugsText, findings);
        collectContraindicationFindings(formId, conditionsText, findings);

        int major = 0, moderate = 0, minor = 0;
        for (Finding f : findings) {
            switch (f.severity()) {
                case "MAJOR" -> major++;
                case "MODERATE" -> moderate++;
                default -> minor++;
            }
        }
        String riskLevel = major > 0 ? "HIGH" : (moderate > 0 ? "MODERATE" : "LOW");

        return new SafetyVerdict(name, riskLevel, findings, unmatchedDrugs,
                major, moderate, minor, heavyMetalDailyLimitMg);
    }

    /**
     * @return the summed maximum permitted daily dose of the heavy-metal ingredients.
     *         See {@link SafetyVerdict#heavyMetalDailyLimitMg()} - a ceiling, not a
     *         measured content.
     */
    private double collectHeavyMetalFindings(List<Ingredient> ingredients, List<Finding> findings) {
        double limitMg = 0;
        for (Ingredient ing : ingredients) {
            if (!ing.isHeavyMetal()) {
                continue;
            }
            if (ing.getMaxDailyMg() != null) {
                limitMg += ing.getMaxDailyMg();
            }
            // The original called .equals on a possibly-null toxicityClass, which
            // threw for any heavy metal missing that field.
            String severity = "HIGH".equals(ing.getToxicityClass()) ? "MAJOR" : "MODERATE";
            String detail = "Contains " + orUnknown(ing.getElementSymbol())
                    + (ing.getNotes() == null ? "" : " - " + ing.getNotes());
            String advice = ing.getMaxDailyMg() == null
                    ? "Ensure sutthi is complete; no daily ceiling is recorded for this ingredient."
                    : "Ensure sutthi is complete; stay within " + ing.getMaxDailyMg()
                            + " mg/day and monitor serum levels if prolonged use.";
            findings.add(new Finding(
                    ing.getNameEnglish() + " (" + orUnknown(ing.getElementSymbol()) + ")",
                    "Heavy metal", severity, detail, advice));
        }
        return limitMg;
    }

    /** @return entered drug names that matched no record. */
    private List<String> collectInteractionFindings(List<Ingredient> ingredients, String drugsText,
                                                    List<Finding> findings) {
        List<String> unmatched = new ArrayList<>();
        if (drugsText == null || drugsText.isBlank() || ingredients.isEmpty()) {
            return unmatched;
        }

        // Deduplicated so "Warfarin, warfarin" does not count twice toward the risk level.
        Set<String> entered = new LinkedHashSet<>();
        for (String raw : drugsText.split(",")) {
            String trimmed = raw.trim();
            if (!trimmed.isEmpty()) {
                entered.add(trimmed.toLowerCase(Locale.ROOT));
            }
        }

        List<AllopathicDrug> matched = new ArrayList<>();
        for (String drugName : entered) {
            Optional<AllopathicDrug> found = drugRepository.findByDrugNameLower(drugName);
            if (found.isPresent()) {
                matched.add(found.get());
            } else {
                unmatched.add(drugName);
            }
        }
        if (matched.isEmpty()) {
            return unmatched;
        }

        // One join instead of the N*M point reads the Firestore composite-key design
        // required. The unique constraint on (ingredient_id, drug_id) still guarantees
        // at most one row per pair, so no de-duplication is needed here.
        List<Long> ingredientIds = ingredients.stream().map(Ingredient::getIngredientId).toList();
        List<Long> drugIds = matched.stream().map(AllopathicDrug::getDrugId).toList();

        for (Interaction ix : interactionRepository.findByIngredientsAndDrugs(ingredientIds, drugIds)) {
            findings.add(new Finding(
                    ix.getIngredient().getNameEnglish() + " x " + ix.getDrug().getDrugName(),
                    "Interaction", ix.getSeverity(), ix.getMechanism(), ix.getAdvice()));
        }
        return unmatched;
    }

    private void collectContraindicationFindings(Long formId, String conditionsText,
                                                 List<Finding> findings) {
        if (conditionsText == null || conditionsText.isBlank()) {
            return;
        }
        List<Contraindication> contraindications =
                contraindicationRepository.findByFormulation_FormId(formId);
        if (contraindications.isEmpty()) {
            return;
        }

        // One finding per contraindication even if several entered conditions match it.
        Set<String> alreadyFlagged = new LinkedHashSet<>();
        for (String raw : conditionsText.split(",")) {
            String condition = raw.trim().toLowerCase(Locale.ROOT);
            if (condition.isEmpty()) {
                continue;
            }
            for (Contraindication c : contraindications) {
                String recorded = c.getConditionName().toLowerCase(Locale.ROOT);
                if (recorded.contains(condition) && alreadyFlagged.add(c.getConditionName())) {
                    findings.add(new Finding(
                            c.getConditionName(), "Contraindication", c.getSeverity(), c.getNote(),
                            "Do not use this preparation in this condition, "
                                    + "or seek specialist advice."));
                }
            }
        }
    }

    private static String orUnknown(String value) {
        return value == null || value.isBlank() ? "unspecified metal" : value;
    }
}
