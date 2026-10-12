package com.siddhamind.service;

import com.siddhamind.dto.DiagnosisResult;
import com.siddhamind.dto.DiagnosisScores;
import com.siddhamind.entity.DiagnosisSession;
import com.siddhamind.entity.Disease;
import com.siddhamind.entity.Formulation;
import com.siddhamind.repository.DiagnosisSessionRepository;
import com.siddhamind.repository.DiseaseRepository;
import com.siddhamind.repository.FormulationRepository;
import com.siddhamind.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Envagai Thervu (eight-fold examination) scoring.
 *
 * <p>Same structure as {@link SafetyService}: {@link #score} is deterministic and
 * AI-free, {@link #assess} persists the result and only then asks
 * {@link AiExplanationPort} for a note.
 */
@Service
public class DiagnosisService {

    private static final Logger log = LoggerFactory.getLogger(DiagnosisService.class);

    /**
     * Examination finding to {vatham, pitham, kabam} points. Transcribed unchanged
     * from the original - this is clinical content, not an implementation detail, and
     * the option strings are also what the form renders and what is stored on the row.
     *
     * <p>Naadi carries weight 3, the other seven carry 2, so pulse diagnosis
     * outweighs any single other sign.
     */
    private static final Map<String, Map<String, int[]>> SCORING = new LinkedHashMap<>();

    static {
        Map<String, int[]> naadi = new LinkedHashMap<>();
        naadi.put("Vatham (வாதம்) – Snake movement", new int[]{3, 0, 0});
        naadi.put("Pitham (பித்தம்) – Frog movement", new int[]{0, 3, 0});
        naadi.put("Kabam (கபம்) – Swan movement", new int[]{0, 0, 3});
        naadi.put("Vatha-Pitham", new int[]{2, 1, 0});
        naadi.put("Pitha-Vatham", new int[]{1, 2, 0});
        naadi.put("Pitha-Kabam", new int[]{0, 2, 1});
        naadi.put("Kaba-Pitham", new int[]{0, 1, 2});
        naadi.put("Vatha-Kabam", new int[]{2, 0, 1});
        naadi.put("Kaba-Vatham", new int[]{1, 0, 2});
        SCORING.put("naadi", naadi);

        Map<String, int[]> naa = new LinkedHashMap<>();
        naa.put("Dry, rough, fissured", new int[]{2, 0, 0});
        naa.put("Red, yellowish", new int[]{0, 2, 0});
        naa.put("Pale, coated, moist", new int[]{0, 0, 2});
        naa.put("Normal", new int[]{0, 0, 0});
        SCORING.put("naa", naa);

        Map<String, int[]> niram = new LinkedHashMap<>();
        niram.put("Dark / dusky", new int[]{2, 0, 0});
        niram.put("Yellow / flushed", new int[]{0, 2, 0});
        niram.put("Pale / white", new int[]{0, 0, 2});
        niram.put("Normal", new int[]{0, 0, 0});
        SCORING.put("niram", niram);

        Map<String, int[]> mozhi = new LinkedHashMap<>();
        mozhi.put("High-pitched / rapid", new int[]{2, 0, 0});
        mozhi.put("Sharp / loud", new int[]{0, 2, 0});
        mozhi.put("Low / slow / nasal", new int[]{0, 0, 2});
        mozhi.put("Normal", new int[]{0, 0, 0});
        SCORING.put("mozhi", mozhi);

        Map<String, int[]> vizhi = new LinkedHashMap<>();
        vizhi.put("Dry / sunken", new int[]{2, 0, 0});
        vizhi.put("Red / burning", new int[]{0, 2, 0});
        vizhi.put("Watery / swollen lids", new int[]{0, 0, 2});
        vizhi.put("Normal", new int[]{0, 0, 0});
        SCORING.put("vizhi", vizhi);

        Map<String, int[]> sparisam = new LinkedHashMap<>();
        sparisam.put("Cold / rough / dry", new int[]{2, 0, 0});
        sparisam.put("Warm / sweaty", new int[]{0, 2, 0});
        sparisam.put("Cool / clammy / oedematous", new int[]{0, 0, 2});
        sparisam.put("Normal", new int[]{0, 0, 0});
        SCORING.put("sparisam", sparisam);

        Map<String, int[]> malam = new LinkedHashMap<>();
        malam.put("Hard / dry / constipated", new int[]{2, 0, 0});
        malam.put("Loose / burning / yellowish", new int[]{0, 2, 0});
        malam.put("Mucoid / sticky / pale", new int[]{0, 0, 2});
        malam.put("Normal", new int[]{0, 0, 0});
        SCORING.put("malam", malam);

        Map<String, int[]> moothiram = new LinkedHashMap<>();
        moothiram.put("Scanty / clear", new int[]{2, 0, 0});
        moothiram.put("Dark yellow / burning", new int[]{0, 2, 0});
        moothiram.put("Frequent / turbid", new int[]{0, 0, 2});
        moothiram.put("Normal", new int[]{0, 0, 0});
        SCORING.put("moothiram", moothiram);
    }

    private final DiagnosisSessionRepository sessionRepository;
    private final DiseaseRepository diseaseRepository;
    private final FormulationRepository formulationRepository;
    private final UserRepository userRepository;
    private final AiExplanationPort ai;

    public DiagnosisService(DiagnosisSessionRepository sessionRepository,
                            DiseaseRepository diseaseRepository,
                            FormulationRepository formulationRepository,
                            UserRepository userRepository,
                            AiExplanationPort ai) {
        this.sessionRepository = sessionRepository;
        this.diseaseRepository = diseaseRepository;
        this.formulationRepository = formulationRepository;
        this.userRepository = userRepository;
        this.ai = ai;
    }

    /** Form options, in declaration order. */
    public Map<String, List<String>> getOptions() {
        Map<String, List<String>> options = new LinkedHashMap<>();
        SCORING.forEach((key, values) -> options.put(key, new ArrayList<>(values.keySet())));
        return options;
    }

    /** Full flow: score, persist, then optionally phrase. */
    @Transactional
    public DiagnosisResult assess(DiagnosisSession session, Long practitionerId) {
        DiagnosisScores scores = score(session);
        DiagnosisResult result = new DiagnosisResult(scores);

        if (practitionerId != null) {
            userRepository.findById(practitionerId).ifPresent(session::setPractitioner);
        }
        applyTo(session, scores);

        String context = describePatient(session);
        // Phrased before the write so the note lands in the same row rather than
        // needing a second update; the scores are already fixed at this point.
        ai.explainDiagnosis(scores, context).ifPresent(note -> {
            result.setAiSummary(note);
            session.setAiSummary(note);
        });

        try {
            result.setSessionId(sessionRepository.save(session).getSessionId());
        } catch (Exception e) {
            log.error("Could not persist diagnosis session: {}", e.getMessage());
        }
        return result;
    }

    /** The scoring engine proper. Deterministic and AI-free. */
    @Transactional(readOnly = true)
    public DiagnosisScores score(DiagnosisSession session) {
        Map<String, String> answers = new LinkedHashMap<>();
        answers.put("naadi", session.getNaadi());
        answers.put("naa", session.getNaa());
        answers.put("niram", session.getNiram());
        answers.put("mozhi", session.getMozhi());
        answers.put("vizhi", session.getVizhi());
        answers.put("sparisam", session.getSparisam());
        answers.put("malam", session.getMalam());
        answers.put("moothiram", session.getMoothiram());

        int vatham = 0, pitham = 0, kabam = 0;
        for (Map.Entry<String, String> answer : answers.entrySet()) {
            Map<String, int[]> options = SCORING.get(answer.getKey());
            if (options == null || answer.getValue() == null) {
                continue;
            }
            int[] points = options.get(answer.getValue());
            if (points == null) {
                // Scores zero rather than failing the assessment, but it means the
                // form and this table have drifted apart.
                log.warn("Unrecognised {} value '{}' - scored as zero", answer.getKey(), answer.getValue());
                continue;
            }
            vatham += points[0];
            pitham += points[1];
            kabam += points[2];
        }

        // Ties resolve vatham > pitham > kabam, matching the original.
        String dominant = (vatham >= pitham && vatham >= kabam) ? "VATHAM"
                : (pitham >= kabam ? "PITHAM" : "KABAM");

        // Every finding normal: reporting a dominant kutram would be an artefact of
        // the tie-break, not a clinical reading.
        if (vatham == 0 && pitham == 0 && kabam == 0) {
            return new DiagnosisScores(0, 0, 0, dominant, "Inconclusive - no abnormal findings",
                    List.of(), List.of());
        }

        // Ordered in SQL - exact kutram matches before MIXED, then alphabetically.
        // The original took whatever row the database returned first, which made the
        // headline prediction vary between identical assessments.
        List<Disease> candidates = diseaseRepository.findCandidatesFor(dominant);
        String predicted = candidates.isEmpty() ? "No match" : candidates.get(0).getNoiEnglish();

        List<Formulation> suggested = candidates.isEmpty()
                ? List.of()
                : formulationRepository.findByDiseaseIds(
                        candidates.stream().map(Disease::getDiseaseId).toList());

        return new DiagnosisScores(vatham, pitham, kabam, dominant, predicted, candidates, suggested);
    }

    private void applyTo(DiagnosisSession session, DiagnosisScores scores) {
        session.setVathaScore(scores.vathaScore());
        session.setPithaScore(scores.pithaScore());
        session.setKabamScore(scores.kabamScore());
        session.setDominantKutram(scores.dominantKutram());
        session.setPredictedDisease(scores.predictedDisease());

        session.getCandidates().clear();
        scores.candidateDiseases().forEach(session::addCandidate);

        session.getSuggestions().clear();
        scores.suggestedFormulations().forEach(session::addSuggestion);
    }

    private String describePatient(DiagnosisSession session) {
        StringBuilder sb = new StringBuilder();
        sb.append(session.getPatientName() == null ? "Patient" : session.getPatientName());
        if (session.getAge() != null) {
            sb.append(", ").append(session.getAge()).append(" years");
        }
        if (session.getGender() != null && !session.getGender().isBlank()) {
            sb.append(", ").append(session.getGender());
        }
        if (session.getComplaint() != null && !session.getComplaint().isBlank()) {
            sb.append(". Complaint: ").append(session.getComplaint());
        }
        return sb.toString();
    }
}
