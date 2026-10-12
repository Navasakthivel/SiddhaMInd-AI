package com.siddhamind.controller.api;

import com.siddhamind.dto.DiagnosisResult;
import com.siddhamind.entity.DiagnosisSession;
import com.siddhamind.entity.Disease;
import com.siddhamind.entity.DiagnosisSession;
import com.siddhamind.entity.Formulation;
import com.siddhamind.repository.DiagnosisSessionRepository;
import com.siddhamind.service.DiagnosisService;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Envagai Thervu - the eight-fold examination - over JSON.
 *
 * <p>The three percentages come back as final integers from the same rule engine
 * the engine produces. They are a deterministic weighting of the eight
 * findings with no model involvement, and a client must render them as settled
 * values: a percentage that counts up is, for the moment it is counting, a
 * different reading of the patient than the one the engine produced.
 */
@RestController
@RequestMapping("/api/diagnosis")
public class DiagnosisApiController {

    private final DiagnosisService diagnosisService;
    private final DiagnosisSessionRepository sessionRepository;

    public DiagnosisApiController(DiagnosisService diagnosisService,
                                  DiagnosisSessionRepository sessionRepository) {
        this.diagnosisService = diagnosisService;
        this.sessionRepository = sessionRepository;
    }

    /**
     * The caller's own diagnosis sessions; every session for an ADMIN.
     *
     * <p>Scoped by the session's user id, not by a request parameter. A
     * {@code ?practitionerId=} would let any practitioner read another's patient
     * names and complaints, which is the whole of what this table holds.
     *
     * <p>ADMIN sees all of them because the admin dashboard already reports the
     * same rows; withholding them here would be a difference without a boundary.
     */
    @GetMapping("/history")
    public ResponseEntity<?> history(HttpSession session) {
        Long userId = (Long) session.getAttribute("userId");
        if (userId == null) {
            return ResponseEntity.status(401).body(Map.of("error", "Not signed in."));
        }
        boolean isAdmin = "ADMIN".equals(session.getAttribute("role"));

        List<DiagnosisSession> rows = isAdmin
                ? sessionRepository.findAllByOrderByCreatedAtDesc()
                : sessionRepository.findByPractitioner_UserIdOrderByCreatedAtDesc(userId);

        return ResponseEntity.ok(Map.of(
                "scope", isAdmin ? "all" : "mine",
                "total", rows.size(),
                "sessions", rows.stream().map(DashboardApiController::diagnosisSummary).toList()));
    }

    /** The permitted value of each of the eight examination fields. */
    @GetMapping("/options")
    public Map<String, List<String>> options() {
        return diagnosisService.getOptions();
    }

    public record ComputeRequest(
            String patientName, Integer age, String gender, String complaint,
            String naadi, String naa, String niram, String mozhi,
            String vizhi, String sparisam, String malam, String moothiram) {}

    @PostMapping("/compute")
    public ResponseEntity<?> compute(@RequestBody ComputeRequest body, HttpSession session) {
        if (body == null || body.patientName() == null || body.patientName().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "patientName is required."));
        }
        List<String> missing = new ArrayList<>();
        Map<String, String> eight = new LinkedHashMap<>();
        eight.put("naadi", body.naadi());
        eight.put("naa", body.naa());
        eight.put("niram", body.niram());
        eight.put("mozhi", body.mozhi());
        eight.put("vizhi", body.vizhi());
        eight.put("sparisam", body.sparisam());
        eight.put("malam", body.malam());
        eight.put("moothiram", body.moothiram());
        eight.forEach((k, v) -> {
            if (v == null || v.isBlank()) {
                missing.add(k);
            }
        });
        if (!missing.isEmpty()) {
            // All eight are required by the rule engine's weighting; a partial
            // examination would produce a reading that looks complete.
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "The examination is incomplete.",
                    "missing", missing));
        }

        DiagnosisSession record = new DiagnosisSession();
        record.setPatientName(body.patientName());
        record.setAge(body.age());
        record.setGender(body.gender());
        record.setComplaint(body.complaint());
        record.setNaadi(body.naadi());
        record.setNaa(body.naa());
        record.setNiram(body.niram());
        record.setMozhi(body.mozhi());
        record.setVizhi(body.vizhi());
        record.setSparisam(body.sparisam());
        record.setMalam(body.malam());
        record.setMoothiram(body.moothiram());

        DiagnosisResult result =
                diagnosisService.assess(record, (Long) session.getAttribute("userId"));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sessionId", result.getSessionId());
        out.put("vatham", result.getVathaPercent());
        out.put("pitham", result.getPithaPercent());
        out.put("kabam", result.getKabamPercent());
        out.put("vathaScore", result.getVathaScore());
        out.put("pithaScore", result.getPithaScore());
        out.put("kabamScore", result.getKabamScore());
        out.put("dominantKutram", result.getDominantKutram());
        out.put("predictedDisease", result.getPredictedDisease());
        // Null when the AI was unreachable. The reading above is unaffected and
        // must still render - losing the assessment because the explainer was
        // down is the failure this separation exists to prevent.
        out.put("aiSummary", result.getAiSummary());

        List<Map<String, Object>> diseases = new ArrayList<>();
        for (Disease d : result.getCandidateDiseases()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("diseaseId", d.getDiseaseId());
            m.put("noiTamil", d.getNoiTamil());
            m.put("noiEnglish", d.getNoiEnglish());
            m.put("modernEquivalent", d.getModernEquivalent());
            m.put("mukkutramType", d.getMukkutramType());
            diseases.add(m);
        }
        out.put("candidateDiseases", diseases);

        List<Map<String, Object>> forms = new ArrayList<>();
        for (Formulation f : result.getSuggestedFormulations()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("formId", f.getFormId());
            m.put("nameEnglish", f.getNameEnglish());
            m.put("nameTamil", f.getNameTamil());
            m.put("safetyClass", f.getSafetyClass());
            m.put("containsHeavyMetal", f.isContainsHeavyMetal());
            forms.add(m);
        }
        out.put("suggestedFormulations", forms);

        return ResponseEntity.ok(out);
    }
}
