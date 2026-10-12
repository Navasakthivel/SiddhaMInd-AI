package com.siddhamind.controller.api;

import com.siddhamind.entity.ActivityLog;
import com.siddhamind.entity.SourceDocument;
import com.siddhamind.entity.User;
import com.siddhamind.repository.DiagnosisSessionRepository;
import com.siddhamind.repository.SafetyCheckRepository;
import com.siddhamind.service.AdminService;
import com.siddhamind.service.AiIngestPort;
import jakarta.servlet.http.HttpSession;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Admin surface as JSON.
 *
 * <p>Reachable only by ADMIN. That is not enforced here - {@code AuthInterceptor}
 * strips the {@code /api} prefix and matches {@code /admin/**} against its single
 * role table, so this controller carries no authorisation logic of its own and
 * cannot drift from the rule that governs it.
 *
 * <p>The mutating methods on {@link AdminService} return an error string and null
 * on success. That convention is preserved rather than wrapped in exceptions:
 * the messages are written for a human to read and are passed through verbatim.
 */
@RestController
@RequestMapping("/api/admin")
public class AdminApiController {

    private final AdminService adminService;
    private final SafetyCheckRepository safetyCheckRepository;
    private final DiagnosisSessionRepository diagnosisSessionRepository;

    public AdminApiController(AdminService adminService,
                              SafetyCheckRepository safetyCheckRepository,
                              DiagnosisSessionRepository diagnosisSessionRepository) {
        this.adminService = adminService;
        this.safetyCheckRepository = safetyCheckRepository;
        this.diagnosisSessionRepository = diagnosisSessionRepository;
    }

    /** How many rows the dashboard's two "recent" panels show. */
    private static final int RECENT = 8;

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        Map<String, Object> out = new LinkedHashMap<>(adminService.reportStats());
        List<Map<String, Object>> activity = new ArrayList<>();
        for (ActivityLog l : adminService.recentActivity()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("action", l.getAction());
            m.put("details", l.getDetails());
            m.put("createdAt", l.getCreatedAt());
            activity.add(m);
        }
        out.put("recentActivity", activity);

        // The dashboard's two recent panels. Paged at the database, not trimmed in
        // the browser: the tables grow without bound and the screen wants eight rows.
        out.put("recentChecks", safetyCheckRepository
                .findAllByOrderByCreatedAtDesc(PageRequest.of(0, RECENT))
                .stream().map(DashboardApiController::safetyCheckSummary).toList());
        out.put("recentDiagnoses", diagnosisSessionRepository
                .findAllByOrderByCreatedAtDesc(PageRequest.of(0, RECENT))
                .stream().map(DashboardApiController::diagnosisSummary).toList());
        return out;
    }

    @GetMapping("/users")
    public Map<String, Object> users() {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (User u : adminService.allUsers()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("userId", u.getUserId());
            m.put("fullName", u.getFullName());
            m.put("email", u.getEmail());
            m.put("role", u.getRoleName());
            m.put("status", u.getStatus());
            m.put("institution", u.getInstitution());
            m.put("regNumber", u.getRegNumber());
            m.put("loginId", u.getLoginId());
            // Pending = created or reset but no password chosen yet. Expired is
            // reported separately so the screen can say "issue a new code" rather
            // than "waiting" for an account whose code can no longer be used.
            m.put("activationPending", u.isMustSetPassword());
            m.put("activationExpiresAt", u.getActivationExpiresAt());
            m.put("activationExpired", u.isMustSetPassword()
                    && (u.getActivationExpiresAt() == null
                        || !Instant.now().isBefore(u.getActivationExpiresAt())));
            rows.add(m);
        }
        return Map.of(
                "users", rows,
                // The roles the create form may offer, not every role row: ADMIN
                // is seeded only and PATIENT self-registers.
                "roles", adminService.creatableRoles());
    }

    /**
     * No password field: the server issues the login ID and activation code.
     * {@code role} must be PRACTITIONER or STUDENT.
     */
    public record CreateUserRequest(String fullName, String email, String phone,
                                    String institution, String regNumber, String role) {}

    /**
     * Creates a practitioner or student. The response carries the login ID and
     * the plaintext activation code - the only time the code is ever available,
     * since only its hash is stored. The admin hands both to the user.
     */
    @PostMapping("/users")
    public ResponseEntity<?> createUser(@RequestBody CreateUserRequest body) {
        if (body == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Name and email are required."));
        }
        AdminService.Issued issued = adminService.createUser(body.fullName(), body.email(),
                body.phone(), body.institution(), body.regNumber(), body.role());
        return issued.ok()
                ? ResponseEntity.status(HttpStatus.CREATED).body(issuedBody(issued))
                : ResponseEntity.badRequest().body(Map.of("error", issued.error()));
    }

    private static Map<String, Object> issuedBody(AdminService.Issued issued) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("userId", issued.userId());
        if (issued.activationCode() != null) {
            out.put("loginId", issued.loginId());
            out.put("activationCode", issued.activationCode());
            out.put("activationExpiresAt", issued.activationExpiresAt());
        }
        return out;
    }

    public record StatusRequest(String status) {}

    @PostMapping("/users/{userId}/status")
    public ResponseEntity<?> setStatus(@PathVariable Long userId,
                                       @RequestBody StatusRequest body,
                                       HttpSession session) {
        String error = adminService.setStatus(userId,
                body == null ? null : body.status(),
                (Long) session.getAttribute("userId"));
        return error == null
                ? ResponseEntity.ok(Map.of("ok", true))
                : ResponseEntity.badRequest().body(Map.of("error", error));
    }

    public record ResetRequest(String newPassword) {}

    /**
     * Admin password reset.
     *
     * <p>For a practitioner or student, issues a new activation code (returned
     * once, with the login ID) and requires a new password on next sign-in; the
     * body may be omitted. For an admin or patient, sets {@code newPassword}. See
     * {@link com.siddhamind.service.AdminService#resetPassword}. A password sent
     * in is never echoed back.
     */
    @PostMapping("/users/{userId}/reset")
    public ResponseEntity<?> resetPassword(@PathVariable Long userId,
                                           @RequestBody(required = false) ResetRequest body) {
        AdminService.Issued issued =
                adminService.resetPassword(userId, body == null ? null : body.newPassword());
        return issued.ok()
                ? ResponseEntity.ok(issuedBody(issued))
                : ResponseEntity.badRequest().body(Map.of("error", issued.error()));
    }

    /**
     * The reporting figures and the recent activity feed.
     *
     * <p>{@code reportStats()} returns a map already; it is copied into a new
     * LinkedHashMap rather than returned directly so adding the activity feed
     * cannot mutate whatever the service handed back.
     */
    @GetMapping("/reports")
    public Map<String, Object> reports() {
        Map<String, Object> out = new LinkedHashMap<>(adminService.reportStats());
        List<Map<String, Object>> activity = new ArrayList<>();
        for (ActivityLog l : adminService.recentActivity()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("action", l.getAction());
            m.put("details", l.getDetails());
            m.put("ipAddress", l.getIpAddress());
            m.put("createdAt", l.getCreatedAt());
            // l.getUser() is a LAZY @ManyToOne and open-in-view is false, so it is
            // deliberately not dereferenced. For LOGIN rows `details` already
            // carries the email, which is what the audit table shows.
            activity.add(m);
        }
        out.put("recentActivity", activity);
        return out;
    }

    @GetMapping("/corpus")
    public Map<String, Object> corpus() {
        List<Map<String, Object>> docs = new ArrayList<>();
        for (SourceDocument d : adminService.allDocuments()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("docId", d.getDocId());
            m.put("slug", d.getSlug());
            m.put("title", d.getTitle());
            m.put("language", d.getLanguage());
            m.put("totalPages", d.getTotalPages());
            m.put("chunkCount", d.getChunkCount());
            m.put("ingestStatus", d.getIngestStatus());
            docs.add(m);
        }
        return Map.of(
                "documents", docs,
                "ingestAvailable", adminService.isIngestAvailable());
    }

    /**
     * Upload a source PDF.
     *
     * <p>Multipart, not JSON: the payload is a file. Size limits come from
     * {@code spring.servlet.multipart.*} (50MB) and a larger upload is rejected
     * by the container before this method is entered.
     */
    @PostMapping("/corpus/upload")
    public ResponseEntity<?> upload(@RequestParam("source") MultipartFile file,
                                    @RequestParam(required = false) String title,
                                    HttpSession session) {
        Object current = session.getAttribute("currentUser");
        User uploader = current instanceof User u ? u : null;
        String error = adminService.uploadDocument(file, title, uploader);
        return error == null
                ? ResponseEntity.ok(Map.of("ok", true))
                : ResponseEntity.badRequest().body(Map.of("error", error));
    }

    @PostMapping("/corpus/{docId}/ingest")
    public ResponseEntity<?> ingest(@PathVariable Long docId) {
        AiIngestPort.IngestTrigger trigger = adminService.triggerIngest(docId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("accepted", trigger.accepted());
        out.put("message", trigger.message());
        return ResponseEntity.ok(out);
    }

    /**
     * Live ingestion state, proxied from the AI service for the corpus screen
     * to poll.
     *
     * <p>Proxied rather than called from the browser because every route on
     * that service is behind the shared internal token, which cannot ship to a
     * client.
     *
     * <p>Always 200, including when the AI service is unreachable - `reachable`
     * carries that. A poll that 502s on every tick would put an error in the
     * console every few seconds and tell the screen nothing it can render.
     *
     * <p>`percent` is absent on purpose. See AiIngestPort.IngestStatus: nothing
     * in the pipeline increments while a run is in flight, so there is no
     * fraction to report and a fabricated one would be indistinguishable from
     * a real one.
     */
    @GetMapping("/corpus/{docId}/status")
    public Map<String, Object> ingestStatus(@PathVariable Long docId) {
        AiIngestPort.IngestStatus s = adminService.ingestStatus(docId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("docId", docId);
        out.put("reachable", s.reachable());
        out.put("status", s.status());
        out.put("running", s.running());
        out.put("stalled", s.isStalled());
        out.put("chunkCount", s.chunkCount());
        out.put("totalPages", s.totalPages());
        out.put("skippedPages", s.skippedPages());
        out.put("error", s.error());
        out.put("message", s.message());
        return out;
    }
}
