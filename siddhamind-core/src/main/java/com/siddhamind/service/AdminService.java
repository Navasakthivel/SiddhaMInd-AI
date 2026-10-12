package com.siddhamind.service;

import com.siddhamind.entity.Role;
import com.siddhamind.entity.SourceDocument;
import com.siddhamind.entity.User;
import com.siddhamind.repository.ActivityLogRepository;
import com.siddhamind.repository.AllopathicDrugRepository;
import com.siddhamind.repository.DiseaseRepository;
import com.siddhamind.repository.FormulationRepository;
import com.siddhamind.repository.IngredientRepository;
import com.siddhamind.repository.RoleRepository;
import com.siddhamind.repository.SourceDocumentRepository;
import com.siddhamind.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Administration: users, corpus, reports.
 *
 * <p>Mirrors {@link SafetyService} and {@link AssistantService} - the controller
 * routes, this holds the work.
 */
@Service
public class AdminService {

    private static final Logger log = LoggerFactory.getLogger(AdminService.class);

    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_SUSPENDED = "SUSPENDED";

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final SourceDocumentRepository documentRepository;
    private final FormulationRepository formulationRepository;
    private final IngredientRepository ingredientRepository;
    private final DiseaseRepository diseaseRepository;
    private final AllopathicDrugRepository drugRepository;
    private final ActivityLogRepository activityLogRepository;
    private final AiIngestPort ingestPort;

    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
    private final Path corpusDir;

    public AdminService(UserRepository userRepository,
                        RoleRepository roleRepository,
                        SourceDocumentRepository documentRepository,
                        FormulationRepository formulationRepository,
                        IngredientRepository ingredientRepository,
                        DiseaseRepository diseaseRepository,
                        AllopathicDrugRepository drugRepository,
                        ActivityLogRepository activityLogRepository,
                        AiIngestPort ingestPort,
                        @org.springframework.beans.factory.annotation.Value("${siddhamind.corpus.dir:../corpus}")
                        String corpusDir) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.documentRepository = documentRepository;
        this.formulationRepository = formulationRepository;
        this.ingredientRepository = ingredientRepository;
        this.diseaseRepository = diseaseRepository;
        this.drugRepository = drugRepository;
        this.activityLogRepository = activityLogRepository;
        this.ingestPort = ingestPort;
        this.corpusDir = Path.of(corpusDir);
    }

    // ------------------------------------------------------------------
    // users
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<User> allUsers() {
        // Ordered, not findAll(): see UserRepository.findAllByOrderByUserIdAsc.
        return userRepository.findAllByOrderByUserIdAsc();
    }

    @Transactional(readOnly = true)
    public List<Role> allRoles() {
        return roleRepository.findAll();
    }

    /** What the create-user form may offer. See {@link #createUser}. */
    public List<String> creatableRoles() {
        return List.of(Credentials.PRACTITIONER, Credentials.STUDENT);
    }

    /**
     * Result of creating a practitioner/student or resetting a credential.
     *
     * <p>{@code activationCode} is the only copy of the plaintext code anywhere: the
     * database holds its BCrypt hash. The controller returns it once and it cannot
     * be recovered afterwards - a lost code means issuing a new one.
     */
    public record Issued(String error, Long userId, String loginId,
                         String activationCode, Instant activationExpiresAt) {
        static Issued failure(String error) { return new Issued(error, null, null, null, null); }
        public boolean ok() { return error == null; }
    }

    /** Max sequence draws before giving up on a free login ID. See allocateLoginId. */
    private static final int LOGIN_ID_ATTEMPTS = 20;

    /**
     * Creates a practitioner or student with a server-generated login ID and a
     * one-time activation code.
     *
     * <p>Only those two roles. ADMIN is seeded and never created through the API;
     * PATIENT self-registers. The account gets a random unusable password and
     * {@code mustSetPassword}, so the only way in is login ID + activation code,
     * after which the user must choose a password before anything else.
     */
    @Transactional
    public Issued createUser(String fullName, String email, String phone,
                             String institution, String regNumber, String roleName) {
        if (!StringUtils.hasText(fullName) || !StringUtils.hasText(email)) {
            return Issued.failure("Name and email are required.");
        }
        String requested = roleName == null ? "" : roleName.trim().toUpperCase(Locale.ROOT);
        if (!Credentials.LOGIN_ID_ROLES.contains(requested)) {
            return Issued.failure("Admins can create PRACTITIONER or STUDENT accounts only.");
        }
        Role role = roleRepository.findByRoleName(requested).orElse(null);
        if (role == null) {
            return Issued.failure("Unknown role: " + requested);
        }
        String normalisedEmail = email.trim().toLowerCase(Locale.ROOT);
        // Checked first only for a readable message. Postgres aborts the whole
        // transaction on a constraint violation, so nothing could be queried after
        // one to explain it; the constraint below remains the real guard.
        if (userRepository.existsByEmail(normalisedEmail)) {
            return Issued.failure("An account already exists for " + normalisedEmail + ".");
        }

        String loginId = allocateLoginId(requested);
        String code = Credentials.newActivationCode();
        Instant expires = Instant.now().plus(Credentials.ACTIVATION_TTL);

        User user = new User();
        user.setFullName(fullName.trim());
        user.setEmail(normalisedEmail);
        user.setPhone(StringUtils.hasText(phone) ? phone.trim() : null);
        user.setInstitution(StringUtils.hasText(institution) ? institution.trim() : null);
        user.setRegNumber(StringUtils.hasText(regNumber) ? regNumber.trim() : null);
        user.setRole(role);
        user.setStatus(STATUS_ACTIVE);
        user.setLoginId(loginId);
        user.setPasswordHash(encoder.encode(Credentials.unusablePassword()));
        user.setMustSetPassword(true);
        user.setActivationCodeHash(encoder.encode(code));
        user.setActivationExpiresAt(expires);

        User saved;
        try {
            saved = userRepository.save(user);
        } catch (DataIntegrityViolationException e) {
            // uq_users_email lost to a concurrent insert, or uq_users_login_id to a
            // hand-inserted row - either way nothing was created.
            return Issued.failure("Could not create the account for " + normalisedEmail
                    + " - the email or login ID is already in use.");
        }
        // The login ID is not secret; the code never reaches a log line.
        log.info("Admin created {} {} as {}", requested, normalisedEmail, loginId);
        return new Issued(null, saved.getUserId(), loginId, code, expires);
    }

    /**
     * Draws from the role's sequence until it yields an unused ID.
     *
     * <p>nextval() already guarantees distinct numbers, so the existence check
     * only matters if someone inserted a login ID by hand ahead of the sequence.
     * Skipped numbers are fine - IDs are unique, not contiguous.
     */
    private String allocateLoginId(String roleName) {
        for (int i = 0; i < LOGIN_ID_ATTEMPTS; i++) {
            long n = Credentials.PRACTITIONER.equals(roleName)
                    ? userRepository.nextPractitionerLoginNumber()
                    : userRepository.nextStudentLoginNumber();
            String candidate = Credentials.formatLoginId(roleName, n);
            if (!userRepository.existsByLoginId(candidate)) {
                return candidate;
            }
            log.warn("Login ID {} is already taken - drawing the next one", candidate);
        }
        throw new IllegalStateException("No free " + roleName + " login ID after "
                + LOGIN_ID_ATTEMPTS + " attempts; check the login-ID sequences against users.login_id");
    }

    /**
     * @return an error message, or null on success
     */
    @Transactional
    public String setStatus(Long userId, String status, Long actingAdminId) {
        if (!STATUS_ACTIVE.equals(status) && !STATUS_SUSPENDED.equals(status)) {
            return "Unknown status: " + status;
        }
        if (userId != null && userId.equals(actingAdminId) && STATUS_SUSPENDED.equals(status)) {
            // Suspending yourself logs you out of the only account that can undo
            // it. Cheap to prevent, tedious to recover from.
            return "You cannot suspend your own account.";
        }
        // Not Optional.map(): a mapper returning null produces Optional.empty(),
        // so orElse fired on the SUCCESS path and reported "No user with id N"
        // after having already saved the change.
        User user = userRepository.findById(userId).orElse(null);
        if (user == null) {
            return "No user with id " + userId + ".";
        }
        if (!status.equals(user.getStatus())) {
            // A suspended user must not keep a session opened before the
            // suspension; AuthInterceptor refuses any session whose recorded
            // version is now stale.
            user.revokeSessions();
        }
        user.setStatus(status);
        userRepository.save(user);
        log.info("Admin {} set user {} to {}", actingAdminId, userId, status);
        return null;
    }

    /**
     * Admin "Reset password".
     *
     * <p>For a practitioner or student this issues a fresh activation code
     * ({@code newPassword} is ignored): the old password and any outstanding code
     * stop working immediately, and the next sign-in is login ID + new code
     * followed by choosing a password. The admin never learns the user's password.
     *
     * <p>For an admin or patient - who have no login ID - it sets
     * {@code newPassword} directly, as before.
     */
    @Transactional
    public Issued resetPassword(Long userId, String newPassword) {
        // See setStatus: Optional.map() with a null-returning mapper collapses to
        // empty, which turned every successful reset into a reported failure.
        User user = userId == null ? null : userRepository.findById(userId).orElse(null);
        if (user == null) {
            return Issued.failure("No user with id " + userId + ".");
        }

        if (Credentials.LOGIN_ID_ROLES.contains(user.getRoleName())) {
            if (user.getLoginId() == null) {
                user.setLoginId(allocateLoginId(user.getRoleName()));
            }
            String code = Credentials.newActivationCode();
            Instant expires = Instant.now().plus(Credentials.ACTIVATION_TTL);
            user.setPasswordHash(encoder.encode(Credentials.unusablePassword()));
            user.setMustSetPassword(true);
            user.setActivationCodeHash(encoder.encode(code));
            user.setActivationExpiresAt(expires);
            user.revokeSessions();
            userRepository.save(user);
            log.info("Admin issued a new activation code for user {} ({})", userId, user.getLoginId());
            return new Issued(null, userId, user.getLoginId(), code, expires);
        }

        if (!Credentials.isAcceptablePassword(newPassword)) {
            return Issued.failure("The new password must be at least "
                    + Credentials.MIN_PASSWORD_LENGTH + " characters.");
        }
        user.setPasswordHash(encoder.encode(newPassword));
        user.revokeSessions();
        userRepository.save(user);
        // The user id only. The password must not reach a log file, where it
        // would be readable by everyone with log access, permanently.
        log.info("Admin reset the password for user {}", userId);
        return new Issued(null, userId, null, null, null);
    }

    // ------------------------------------------------------------------
    // corpus
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<SourceDocument> allDocuments() {
        return documentRepository.findAllByOrderByUploadedAtDesc();
    }

    public boolean isIngestAvailable() {
        return ingestPort.isAvailable();
    }

    /**
     * Stores an uploaded PDF in the corpus directory and registers it.
     *
     * <p>The filename is reduced to its base name before use. A browser is free
     * to send {@code ../../application.properties} in a multipart filename, and
     * resolving that against the corpus directory would write outside it - the
     * Python side guards reads for the same reason.
     */
    @Transactional
    public String uploadDocument(MultipartFile file, String title, User uploader) {
        if (file == null || file.isEmpty()) {
            return "Choose a PDF to upload.";
        }
        String original = StringUtils.getFilename(file.getOriginalFilename());
        if (original == null || original.isBlank()) {
            return "That file has no usable name.";
        }
        if (!original.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
            return "Only PDF files can be ingested.";
        }

        try {
            Files.createDirectories(corpusDir);
            Path target = corpusDir.resolve(original).normalize();
            if (!target.startsWith(corpusDir.toAbsolutePath().normalize())
                    && !target.normalize().startsWith(corpusDir.normalize())) {
                return "That filename is not allowed.";
            }
            try (var in = file.getInputStream()) {
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }

            String slug = com.siddhamind.util.Slugs.of(
                    StringUtils.hasText(title) ? title : original.replaceAll("(?i)\\.pdf$", ""));

            SourceDocument doc = documentRepository.findBySlug(slug).orElseGet(SourceDocument::new);
            doc.setSlug(slug);
            doc.setTitle(StringUtils.hasText(title) ? title.trim()
                    : original.replaceAll("(?i)\\.pdf$", ""));
            doc.setFilePath("corpus/" + original);
            // Never attach the caller's own User instance. The API path passes the
            // session copy from AuthService.sessionView(), whose passwordHash is
            // deliberately null; if a MERGE cascade were ever added to
            // SourceDocument.uploadedBy, saving this document would flush that null
            // back over the real users row and lock the admin out. Re-reading by id
            // hands the association a reference the persistence context owns, which
            // is correct regardless of what cascades exist now or are added later.
            doc.setUploadedBy(uploader == null || uploader.getUserId() == null
                    ? null
                    : userRepository.getReferenceById(uploader.getUserId()));
            if (doc.getDocId() == null) {
                doc.setIndexed(false);
                doc.setChunkCount(0);
                doc.setIngestStatus("PENDING");
            }
            documentRepository.save(doc);
            log.info("Admin uploaded {} as document slug {}", original, slug);
            return null;

        } catch (IOException e) {
            log.warn("Upload of {} failed: {}", original, e.toString());
            return "Could not save the file: " + e.getMessage();
        }
    }

    /** Asks siddhamind-ai to ingest a document. Never throws. */
    public AiIngestPort.IngestTrigger triggerIngest(Long docId) {
        return ingestPort.trigger(docId);
    }

    /** Live state of one ingestion, for the corpus screen to poll. Never throws. */
    public AiIngestPort.IngestStatus ingestStatus(Long docId) {
        return ingestPort.status(docId);
    }

    // ------------------------------------------------------------------
    // reports
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public Map<String, Object> reportStats() {
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("adminCount", userRepository.countByRole_RoleName("ADMIN"));
        stats.put("practitionerCount", userRepository.countByRole_RoleName("PRACTITIONER"));
        stats.put("studentCount", userRepository.countByRole_RoleName("STUDENT"));
        stats.put("patientCount", userRepository.countByRole_RoleName("PATIENT"));
        stats.put("userCount", userRepository.count());
        stats.put("formulationCount", formulationRepository.count());
        stats.put("ingredientCount", ingredientRepository.count());
        stats.put("diseaseCount", diseaseRepository.count());
        stats.put("drugCount", drugRepository.count());
        stats.put("heavyMetalCount", ingredientRepository.countByHeavyMetalTrue());
        stats.put("documentCount", documentRepository.count());
        stats.put("indexedDocs", documentRepository.countByIndexedTrue());
        stats.put("chunkCount", documentRepository.sumChunkCount());
        return stats;
    }

    @Transactional(readOnly = true)
    public List<com.siddhamind.entity.ActivityLog> recentActivity() {
        // Paged rather than unbounded: activity_logs grows without limit and a
        // findAll() here would eventually load the whole audit trail to render
        // the top of one page.
        return activityLogRepository.findAllByOrderByCreatedAtDesc(
                org.springframework.data.domain.PageRequest.of(0, 50));
    }
}
