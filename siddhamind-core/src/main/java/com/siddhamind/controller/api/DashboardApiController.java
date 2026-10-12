package com.siddhamind.controller.api;

import com.siddhamind.entity.ChatSession;
import com.siddhamind.entity.DiagnosisSession;
import com.siddhamind.entity.Ingredient;
import com.siddhamind.entity.Notification;
import com.siddhamind.entity.SafetyCheck;
import com.siddhamind.entity.User;
import com.siddhamind.repository.ChatSessionRepository;
import com.siddhamind.repository.DiagnosisSessionRepository;
import com.siddhamind.repository.DiseaseRepository;
import com.siddhamind.repository.FormulationRepository;
import com.siddhamind.repository.IngredientRepository;
import com.siddhamind.repository.NotificationRepository;
import com.siddhamind.repository.SafetyCheckRepository;
import com.siddhamind.service.AiExplanationPort;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Profile and the three role dashboards, as JSON.
 *
 * <p>Every figure here comes from the repositories directly, so a count shown on
 * a dashboard and the same count shown anywhere else are one query rather than
 * two that can drift.
 *
 * <p><b>No role checks live here.</b> {@code AuthInterceptor} strips the
 * {@code /api} prefix and matches what remains against the table the pages already
 * use, so {@code /api/practitioner/dashboard} is checked as {@code /practitioner}
 * and is reachable by PRACTITIONER and ADMIN. Repeating that table in this class
 * would be a second copy of an authorisation decision, and the copy that disagrees
 * quietly is the dangerous one.
 *
 * <p>Every response is a hand-built map. Serialising the entities directly would
 * walk lazy associations after the transaction has closed - {@code
 * spring.jpa.open-in-view} is false - and would publish column names as API shape.
 * The list endpoints below therefore expose scalar fields only; nothing here
 * dereferences {@code getCandidates()}, {@code getFindings()} or
 * {@code getMessages()}.
 */
@RestController
public class DashboardApiController {

    private final UserScopedData data;

    public DashboardApiController(NotificationRepository notificationRepository,
                                  DiagnosisSessionRepository diagnosisSessionRepository,
                                  SafetyCheckRepository safetyCheckRepository,
                                  ChatSessionRepository chatSessionRepository,
                                  FormulationRepository formulationRepository,
                                  IngredientRepository ingredientRepository,
                                  DiseaseRepository diseaseRepository,
                                  AiExplanationPort ai) {
        this.data = new UserScopedData(notificationRepository, diagnosisSessionRepository,
                safetyCheckRepository, chatSessionRepository, formulationRepository,
                ingredientRepository, diseaseRepository, ai);
    }

    /** Groups the collaborators so the constructor above stays readable. */
    private record UserScopedData(NotificationRepository notifications,
                                  DiagnosisSessionRepository diagnoses,
                                  SafetyCheckRepository checks,
                                  ChatSessionRepository chats,
                                  FormulationRepository formulations,
                                  IngredientRepository ingredients,
                                  DiseaseRepository diseases,
                                  AiExplanationPort ai) {}

    // ------------------------------------------------------------------
    // profile
    // ------------------------------------------------------------------

    /**
     * The signed-in user and their notifications.
     *
     * <p>The user comes from the session copy that {@code AuthService.sessionView}
     * put there, which already has the password hash stripped. It is still
     * serialised field by field: returning the object would make every column added
     * to User in future automatically public.
     */
    @GetMapping("/api/profile")
    public ResponseEntity<?> profile(HttpSession session) {
        Long userId = (Long) session.getAttribute("userId");
        Object current = session.getAttribute("currentUser");
        if (userId == null || !(current instanceof User user)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Not signed in."));
        }

        Map<String, Object> profile = new LinkedHashMap<>();
        profile.put("userId", user.getUserId());
        profile.put("name", user.getFullName());
        profile.put("email", user.getEmail());
        profile.put("role", user.getRoleName());
        profile.put("phone", user.getPhone());
        profile.put("regNumber", user.getRegNumber());
        profile.put("institution", user.getInstitution());
        profile.put("status", user.getStatus());
        profile.put("createdAt", user.getCreatedAt());
        profile.put("lastLogin", user.getLastLogin());

        List<Map<String, Object>> notes = new ArrayList<>();
        for (Notification n : data.notifications().findByUser_UserIdOrderByCreatedAtDesc(userId)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("notifId", n.getNotifId());
            m.put("title", n.getTitle());
            m.put("message", n.getMessage());
            m.put("read", n.isRead());
            m.put("createdAt", n.getCreatedAt());
            notes.add(m);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("profile", profile);
        out.put("notifications", notes);
        return ResponseEntity.ok(out);
    }

    // ------------------------------------------------------------------
    // role dashboards
    // ------------------------------------------------------------------

    /** PRACTITIONER, ADMIN - enforced by AuthInterceptor against {@code /practitioner}. */
    @GetMapping("/api/practitioner/dashboard")
    public ResponseEntity<?> practitioner(HttpSession session) {
        Long userId = (Long) session.getAttribute("userId");
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Not signed in."));
        }

        List<Map<String, Object>> diagnoses = new ArrayList<>();
        for (DiagnosisSession d : data.diagnoses().findByPractitioner_UserIdOrderByCreatedAtDesc(userId)) {
            diagnoses.add(diagnosisSummary(d));
        }

        List<Map<String, Object>> checks = new ArrayList<>();
        for (SafetyCheck c : data.checks().findByUser_UserIdOrderByCreatedAtDesc(userId)) {
            checks.add(safetyCheckSummary(c));
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("myDiagnoses", diagnoses);
        out.put("myChecks", checks);
        out.put("formulationCount", data.formulations().count());
        out.put("aiReady", data.ai().isAvailable());
        return ResponseEntity.ok(out);
    }

    /** STUDENT, ADMIN - enforced against {@code /student}. */
    @GetMapping("/api/student/dashboard")
    public ResponseEntity<?> student(HttpSession session) {
        Long userId = (Long) session.getAttribute("userId");
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Not signed in."));
        }

        List<Map<String, Object>> chats = new ArrayList<>();
        for (ChatSession c : data.chats().findByUser_UserIdOrderByCreatedAtDesc(userId)) {
            chats.add(chatSummary(c));
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("formulationCount", data.formulations().count());
        out.put("ingredientCount", data.ingredients().count());
        out.put("diseaseCount", data.diseases().count());
        out.put("myChats", chats);
        out.put("aiReady", data.ai().isAvailable());
        return ResponseEntity.ok(out);
    }

    /**
     * PATIENT, ADMIN - enforced against {@code /patient}.
     *
     * <p>Heavy-metal ingredients with their ceilings. {@code maxDailyMg} is the
     * maximum permitted daily dose of that ingredient, not an amount anyone is
     * taking; a client that renders it as a dose is inventing the numerator.
     */
    @GetMapping("/api/patient/dashboard")
    public ResponseEntity<?> patient() {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Ingredient i : data.ingredients().findByHeavyMetalTrueOrderByNameEnglishAsc()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("ingredientId", i.getIngredientId());
            m.put("nameEnglish", i.getNameEnglish());
            m.put("nameTamil", i.getNameTamil());
            m.put("elementSymbol", i.getElementSymbol());
            m.put("toxicityClass", i.getToxicityClass());
            m.put("maxDailyMg", i.getMaxDailyMg());
            m.put("sutthiRequired", i.isSutthiRequired());
            rows.add(m);
        }
        return ResponseEntity.ok(Map.of("heavyMetalIngredients", rows));
    }

    // ------------------------------------------------------------------
    // shared summaries, reused by DiagnosisApiController's history endpoint
    // ------------------------------------------------------------------

    /** Scalar fields only: candidates and suggestions are lazy and not fetched here. */
    static Map<String, Object> diagnosisSummary(DiagnosisSession d) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("sessionId", d.getSessionId());
        m.put("patientName", d.getPatientName());
        m.put("age", d.getAge());
        m.put("gender", d.getGender());
        m.put("complaint", d.getComplaint());
        m.put("vathaScore", d.getVathaScore());
        m.put("pithaScore", d.getPithaScore());
        m.put("kabamScore", d.getKabamScore());
        m.put("dominantKutram", d.getDominantKutram());
        m.put("predictedDisease", d.getPredictedDisease());
        m.put("createdAt", d.getCreatedAt());
        return m;
    }

    /** Scalar fields only: findings are lazy and not fetched here. */
    static Map<String, Object> safetyCheckSummary(SafetyCheck c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("checkId", c.getCheckId());
        m.put("formulationName", c.getFormulationName());
        m.put("riskLevel", c.getRiskLevel());
        m.put("majorCount", c.getMajorCount());
        m.put("moderateCount", c.getModerateCount());
        m.put("minorCount", c.getMinorCount());
        m.put("heavyMetalDailyLimitMg", c.getHeavyMetalDailyLimitMg());
        m.put("drugsEntered", c.getDrugsEntered());
        m.put("conditionsEntered", c.getConditionsEntered());
        m.put("createdAt", c.getCreatedAt());
        return m;
    }

    /** Scalar fields only: messages are lazy and not fetched here. */
    static Map<String, Object> chatSummary(ChatSession c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("chatId", c.getChatId());
        m.put("title", c.getTitle());
        m.put("messageCount", c.getMessageCount());
        m.put("createdAt", c.getCreatedAt());
        m.put("lastMessageAt", c.getLastMessageAt());
        return m;
    }
}
