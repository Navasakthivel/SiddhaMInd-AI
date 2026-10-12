package com.siddhamind.controller.api;

import com.siddhamind.dto.SafetyReport;
import com.siddhamind.entity.Formulation;
import com.siddhamind.repository.ContraindicationRepository;
import com.siddhamind.repository.FormulationRepository;
import com.siddhamind.service.SafetyService;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * The rule engine over JSON.
 *
 * <p>Delegates to {@link SafetyService#check}. The verdict is computed there, not
 * here, and the audit trail is written by the service rather than the controller,
 * so a check can never be run without being recorded.
 *
 * <p>The response carries {@code heavyMetalDailyLimitMg} as a CEILING. It is the
 * sum of the maximum permitted daily dose of each heavy-metal ingredient, not a
 * measured content and not what a patient receives; elemental yield after sutthi
 * and pudam is not derivable from free-text formulary quantities. Any client
 * rendering it as a dose-against-limit meter is inventing the numerator.
 */
@RestController
@RequestMapping("/api/safety")
public class SafetyApiController {

    private final SafetyService safetyService;
    private final FormulationRepository formulationRepository;
    private final ContraindicationRepository contraindicationRepository;

    public SafetyApiController(SafetyService safetyService,
                               FormulationRepository formulationRepository,
                               ContraindicationRepository contraindicationRepository) {
        this.safetyService = safetyService;
        this.formulationRepository = formulationRepository;
        this.contraindicationRepository = contraindicationRepository;
    }

    /** Everything the check form needs to render its selects. */
    @GetMapping("/options")
    public Map<String, Object> options() {
        List<Map<String, Object>> formulations =
                formulationRepository.findAllByOrderByNameEnglishAsc().stream()
                        .map(SafetyApiController::brief)
                        .toList();
        return Map.of(
                "formulations", formulations,
                "conditions", contraindicationRepository.findDistinctConditionNames());
    }

    /**
     * @param formId     the preparation being screened
     * @param drugs      comma-separated allopathic medicines, free text
     * @param conditions comma-separated patient conditions, free text
     */
    public record CheckRequest(Long formId, String drugs, String conditions) {}

    @PostMapping("/check")
    public ResponseEntity<?> check(@RequestBody CheckRequest body, HttpSession session) {
        if (body == null || body.formId() == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "formId is required."));
        }
        Long userId = (Long) session.getAttribute("userId");
        SafetyReport report = safetyService.check(body.formId(), body.drugs(),
                body.conditions(), userId);
        if (report == null) {
            return ResponseEntity.status(404)
                    .body(Map.of("error", "No such preparation."));
        }
        return ResponseEntity.ok(report);
    }

    private static Map<String, Object> brief(Formulation f) {
        return Map.of(
                "formId", f.getFormId(),
                "nameEnglish", f.getNameEnglish() == null ? "" : f.getNameEnglish(),
                "nameTamil", f.getNameTamil() == null ? "" : f.getNameTamil(),
                "safetyClass", f.getSafetyClass() == null ? "" : f.getSafetyClass(),
                "containsHeavyMetal", f.isContainsHeavyMetal());
    }
}
