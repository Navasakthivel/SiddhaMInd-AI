package com.siddhamind.controller.api;

import com.siddhamind.entity.Contraindication;
import com.siddhamind.entity.Disease;
import com.siddhamind.entity.Ingredient;
import com.siddhamind.entity.Formulation;
import com.siddhamind.entity.FormulationIngredient;
import com.siddhamind.repository.ContraindicationRepository;
import com.siddhamind.repository.DiseaseRepository;
import com.siddhamind.repository.FormulationRepository;
import com.siddhamind.repository.IngredientRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Formulary browse and detail as JSON.
 *
 * <p>Hand-built maps rather than serialising the entities directly. Formulation
 * carries lazy associations in both directions (ingredients, contraindications,
 * indicated diseases), and handing Jackson the entity graph either walks into a
 * cycle or triggers a lazy load after the transaction has closed. Naming the
 * fields here also means a column rename cannot silently change the wire shape.
 */
@RestController
@RequestMapping("/api/formulary")
public class FormularyApiController {

    private final FormulationRepository formulationRepository;
    private final ContraindicationRepository contraindicationRepository;
    private final IngredientRepository ingredientRepository;
    private final DiseaseRepository diseaseRepository;

    public FormularyApiController(FormulationRepository formulationRepository,
                                  ContraindicationRepository contraindicationRepository,
                                  IngredientRepository ingredientRepository,
                                  DiseaseRepository diseaseRepository) {
        this.formulationRepository = formulationRepository;
        this.contraindicationRepository = contraindicationRepository;
        this.ingredientRepository = ingredientRepository;
        this.diseaseRepository = diseaseRepository;
    }

    /**
     * Every ingredient.
     *
     * <p>Declared before {@code @GetMapping("/{id}")} for readability only - Spring
     * MVC scores a literal path segment above a templated one regardless of
     * declaration order, so "/ingredients" cannot be swallowed by "/{id}". Without
     * this mapping the request did reach "/{id}", failed to parse "ingredients" as
     * a Long, and answered 400.
     */
    @GetMapping("/ingredients")
    public Map<String, Object> ingredients() {
        List<Map<String, Object>> rows = ingredientRepository.findAllByOrderByNameEnglishAsc()
                .stream().map(FormularyApiController::ingredient).toList();
        return Map.of("total", rows.size(), "ingredients", rows);
    }

    /**
     * Every disease, each with how many preparations are indicated for it.
     *
     * <p>Two queries in total, not one per card: the counts come back grouped
     * from countFormulationsPerDisease() and are joined in memory. A disease
     * absent from that result has no indicated preparation, which reads as 0.
     */
    @GetMapping("/diseases")
    public Map<String, Object> diseases() {
        Map<Long, Long> counts = new LinkedHashMap<>();
        for (Object[] row : diseaseRepository.countFormulationsPerDisease()) {
            counts.put(((Number) row[0]).longValue(), ((Number) row[1]).longValue());
        }

        List<Map<String, Object>> rows = diseaseRepository.findAllByOrderByNoiEnglishAsc()
                .stream()
                .map(d -> {
                    Map<String, Object> m = disease(d);
                    m.put("preparationCount", counts.getOrDefault(d.getDiseaseId(), 0L));
                    return m;
                })
                .toList();
        return Map.of("total", rows.size(), "diseases", rows);
    }

    /** One disease and the preparations indicated for it. */
    @GetMapping("/diseases/{id}")
    public ResponseEntity<?> disease(@PathVariable Long id) {
        Disease d = diseaseRepository.findById(id).orElse(null);
        if (d == null) {
            return ResponseEntity.status(404).body(Map.of("error", "No such disease."));
        }
        Map<String, Object> out = new LinkedHashMap<>(disease(d));
        out.put("description", d.getDescription());
        // indicatedSummary, not summary: the detail screen prints a source
        // citation under each preparation, and sourceBook/pageNo are not on the
        // list shape used elsewhere.
        out.put("formulations", formulationRepository.findByDiseaseId(id)
                .stream().map(FormularyApiController::indicatedSummary).toList());
        return ResponseEntity.ok(out);
    }

    private static Map<String, Object> ingredient(Ingredient i) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ingredientId", i.getIngredientId());
        m.put("slug", i.getSlug());
        m.put("nameEnglish", i.getNameEnglish());
        m.put("nameTamil", i.getNameTamil());
        m.put("scientificName", i.getScientificName());
        m.put("sourceType", i.getSourceType());
        m.put("partUsed", i.getPartUsed());
        m.put("sutthiRequired", i.isSutthiRequired());
        m.put("heavyMetal", i.isHeavyMetal());
        m.put("elementSymbol", i.getElementSymbol());
        m.put("toxicityClass", i.getToxicityClass());
        m.put("maxDailyMg", i.getMaxDailyMg());
        return m;
    }

    /**
     * A formulation as the disease-detail screen needs it: the list fields plus
     * the source citation, so the page can print "book - p. N" without a second
     * request per row.
     */
    private static Map<String, Object> indicatedSummary(Formulation f) {
        Map<String, Object> m = new LinkedHashMap<>(summary(f));
        m.put("sourceBook", f.getSourceBook());
        m.put("pageNo", f.getPageNo());
        m.put("verseNo", f.getVerseNo());
        return m;
    }

    private static Map<String, Object> disease(Disease d) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("diseaseId", d.getDiseaseId());
        m.put("slug", d.getSlug());
        m.put("noiEnglish", d.getNoiEnglish());
        m.put("noiTamil", d.getNoiTamil());
        m.put("modernEquivalent", d.getModernEquivalent());
        m.put("mukkutramType", d.getMukkutramType());
        return m;
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String q) {
        List<Formulation> rows = (q == null || q.isBlank())
                ? formulationRepository.findAllByOrderByNameEnglishAsc()
                : formulationRepository.search(q.trim());
        // The number of rows actually returned for this query, not the size of the
        // whole table. The client renders this as "<n> preparations" beside the
        // list it just received, so an unfiltered count contradicts what is on
        // screen the moment a search narrows the results.
        return Map.of(
                "query", q == null ? "" : q,
                "total", rows.size(),
                "results", rows.stream().map(FormularyApiController::summary).toList());
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> detail(@PathVariable Long id) {
        Formulation f = formulationRepository.findDetailById(id).orElse(null);
        if (f == null) {
            return ResponseEntity.status(404).body(Map.of("error", "No such preparation."));
        }

        Map<String, Object> out = new LinkedHashMap<>(summary(f));
        out.put("preparationMethod", f.getPreparationMethod());
        out.put("dose", f.getDose());
        out.put("anupanam", f.getAnupanam());
        out.put("shelfLife", f.getShelfLife());
        out.put("sourceBook", f.getSourceBook());
        out.put("pageNo", f.getPageNo());
        out.put("verseNo", f.getVerseNo());

        List<Map<String, Object>> ingredients = new ArrayList<>();
        for (FormulationIngredient fi : f.getIngredients()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("nameEnglish", fi.getIngredient().getNameEnglish());
            m.put("nameTamil", fi.getIngredient().getNameTamil());
            m.put("quantity", fi.getQuantity());
            m.put("sutthiNote", fi.getSutthiNote());
            m.put("heavyMetal", fi.getIngredient().isHeavyMetal());
            m.put("elementSymbol", fi.getIngredient().getElementSymbol());
            m.put("maxDailyMg", fi.getIngredient().getMaxDailyMg());
            m.put("toxicityClass", fi.getIngredient().getToxicityClass());
            ingredients.add(m);
        }
        out.put("ingredients", ingredients);

        List<Map<String, Object>> contras = new ArrayList<>();
        for (Contraindication c : contraindicationRepository.findByFormulation_FormId(id)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("conditionName", c.getConditionName());
            m.put("severity", c.getSeverity());
            m.put("note", c.getNote());
            contras.add(m);
        }
        out.put("contraindications", contras);

        // Indicated diseases, fetched by their own query. Formulation.indications is
        // LAZY and open-in-view is false, so walking it here would throw.
        out.put("indications", diseaseRepository.findIndicatedFor(id)
                .stream().map(FormularyApiController::disease).toList());

        return ResponseEntity.ok(out);
    }

    private static Map<String, Object> summary(Formulation f) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("formId", f.getFormId());
        m.put("slug", f.getSlug());
        m.put("nameEnglish", f.getNameEnglish());
        m.put("nameTamil", f.getNameTamil());
        m.put("sfiCode", f.getSfiCode());
        m.put("dosageForm", f.getDosageForm());
        m.put("safetyClass", f.getSafetyClass());
        m.put("containsHeavyMetal", f.isContainsHeavyMetal());
        return m;
    }
}
