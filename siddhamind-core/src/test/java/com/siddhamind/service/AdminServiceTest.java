package com.siddhamind.service;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
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
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The two paths in {@link AdminService} where a mistake is expensive.
 *
 * <p><b>Upload.</b> The legacy code took the browser-supplied filename, joined it
 * to the corpus directory and wrote it - no extension allowlist, no containment
 * check. A multipart filename is attacker-controlled input like any other, and
 * the browser is not the only thing that can send one.
 *
 * <p><b>Credentials.</b> A password that reaches a log file has leaked to
 * everyone with log access, permanently, and no amount of hashing at rest
 * undoes it.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AdminServiceTest {

    @Mock UserRepository userRepository;
    @Mock RoleRepository roleRepository;
    @Mock SourceDocumentRepository documentRepository;
    @Mock FormulationRepository formulationRepository;
    @Mock IngredientRepository ingredientRepository;
    @Mock DiseaseRepository diseaseRepository;
    @Mock AllopathicDrugRepository drugRepository;
    @Mock ActivityLogRepository activityLogRepository;
    @Mock AiIngestPort ingestPort;

    @TempDir Path sandbox;

    private Path corpusDir;
    private AdminService service;
    private ListAppender<ILoggingEvent> logs;
    private ch.qos.logback.classic.Logger serviceLogger;

    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    @BeforeEach
    void setUp() throws IOException {
        // corpus/ sits inside the sandbox, so "outside the corpus" is a real,
        // observable place on disk rather than a claim about a string.
        corpusDir = sandbox.resolve("corpus");
        Files.createDirectories(corpusDir);

        service = new AdminService(userRepository, roleRepository, documentRepository,
                formulationRepository, ingredientRepository, diseaseRepository,
                drugRepository, activityLogRepository, ingestPort,
                corpusDir.toString());

        when(documentRepository.findBySlug(any())).thenReturn(Optional.empty());
        when(documentRepository.save(any(SourceDocument.class)))
                .thenAnswer(inv -> inv.getArgument(0));

        serviceLogger = (ch.qos.logback.classic.Logger)
                LoggerFactory.getLogger(AdminService.class);
        logs = new ListAppender<>();
        logs.start();
        serviceLogger.addAppender(logs);
    }

    @AfterEach
    void tearDown() {
        serviceLogger.detachAppender(logs);
    }

    private String logText() {
        return logs.list.stream()
                .map(ILoggingEvent::getFormattedMessage)
                .reduce("", (a, b) -> a + "\n" + b);
    }

    private static MockMultipartFile pdf(String filename) {
        return new MockMultipartFile("file", filename, "application/pdf",
                "%PDF-1.4 test".getBytes());
    }

    /** Every regular file anywhere under the sandbox, corpus included. */
    private List<Path> filesInSandbox() throws IOException {
        try (Stream<Path> walk = Files.walk(sandbox)) {
            return walk.filter(Files::isRegularFile).toList();
        }
    }

    private static User user(long id, String roleName) {
        Role role = new Role();
        role.setRoleName(roleName);
        User u = new User();
        u.setUserId(id);
        u.setFullName("Test User");
        u.setEmail("test@siddhamind.in");
        u.setRole(role);
        u.setStatus(AdminService.STATUS_ACTIVE);
        u.setPasswordHash(ENCODER.encode("original-password"));
        return u;
    }

    // ==================================================================
    // 1. upload - filename sanitisation and path containment
    // ==================================================================

    @Test
    void aNormalPdfLandsInsideTheCorpusDirectory() throws IOException {
        assertNull(service.uploadDocument(pdf("Siddha Formulary.pdf"), "Formulary", null));

        Path expected = corpusDir.resolve("Siddha Formulary.pdf");
        assertTrue(Files.exists(expected), "the file should be written into corpus/");
        assertEquals(1, filesInSandbox().size(), "exactly one file, and it is that one");
    }

    /**
     * The core containment property: whatever the browser sends, nothing is
     * written outside the corpus directory.
     *
     * <p>Both separator styles are covered deliberately. Spring's
     * {@code StringUtils.getFilename} splits on {@code /} only, so on Windows a
     * backslash form survives the basename reduction untouched and reaches
     * {@code Path.resolve}, where the OS <em>does</em> treat it as a separator.
     * The forward-slash cases are neutralised by the basename reduction; the
     * backslash and drive-letter cases are stopped by the containment check, and
     * only the containment check.
     */
    @ParameterizedTest(name = "[{index}] {0} cannot escape corpus/")
    @ValueSource(strings = {
            "../escaped.pdf",
            "../../escaped.pdf",
            "../../../../../../etc/passwd.pdf",
            "..\\escaped.pdf",
            "..\\..\\escaped.pdf",
            "/etc/passwd.pdf",
            "C:\\Windows\\Temp\\escaped.pdf",
            "corpus/../../escaped.pdf",
            "./../escaped.pdf",
            "....//escaped.pdf",
    })
    void noUploadCanWriteOutsideTheCorpusDirectory(String hostileName) throws IOException {
        service.uploadDocument(pdf(hostileName), null, null);

        for (Path written : filesInSandbox()) {
            assertTrue(written.toAbsolutePath().normalize()
                            .startsWith(corpusDir.toAbsolutePath().normalize()),
                    "a file escaped the corpus directory: " + written);
        }
        assertFalse(Files.exists(sandbox.resolve("escaped.pdf")),
                "a file was written to the sandbox root");
        assertFalse(Files.exists(sandbox.getParent().resolve("escaped.pdf")),
                "a file was written above the sandbox entirely");
    }

    /**
     * Records <em>how</em> each hostile name is neutralised, not merely that it
     * is. The two mechanisms have different blast radii and different ways of
     * regressing, so collapsing them into one "nothing escaped" assertion would
     * hide a change from one to the other.
     *
     * <ul>
     *   <li><b>Sanitised</b> - {@code getFilename()} discards the directory
     *       portion, so the upload succeeds under a safe base name. Only works
     *       for {@code /}, which is the only separator Spring splits on.</li>
     *   <li><b>Rejected</b> - the name survives basename reduction and would
     *       resolve outside the corpus, so the containment check refuses it.
     *       This is the only thing standing between a Windows deployment and an
     *       arbitrary write, because {@code ..\..\x.pdf} contains no {@code /}
     *       at all.</li>
     * </ul>
     */
    @Test
    void hostileNamesAreEitherSanitisedOrRejectedNeverWrittenAsGiven() throws IOException {
        record Case(String input, boolean expectedAccepted, String landsAs) {}

        List<Case> cases = List.of(
                // Forward slashes: basename reduction handles these, upload proceeds.
                new Case("../escaped.pdf", true, "escaped.pdf"),
                new Case("../../escaped.pdf", true, "escaped.pdf"),
                new Case("/etc/passwd.pdf", true, "passwd.pdf"),
                new Case("corpus/../../escaped.pdf", true, "escaped.pdf"),
                // Backslashes and drive letters: survive basename reduction, so
                // only the containment check stops them.
                new Case("..\\escaped.pdf", false, null),
                new Case("..\\..\\escaped.pdf", false, null),
                new Case("C:\\Windows\\Temp\\escaped.pdf", false, null));

        for (Case c : cases) {
            // Fresh corpus per case so one outcome cannot mask the next.
            for (Path p : filesInSandbox()) {
                Files.deleteIfExists(p);
            }
            String error = service.uploadDocument(pdf(c.input()), null, null);

            if (c.expectedAccepted()) {
                assertNull(error, c.input() + " should have been sanitised and accepted");
                assertTrue(Files.exists(corpusDir.resolve(c.landsAs())),
                        c.input() + " should land as " + c.landsAs());
            } else {
                assertNotNull(error, c.input() + " should have been REJECTED, not written");
                assertTrue(error.contains("not allowed"),
                        c.input() + " gave the wrong error: " + error);
            }

            for (Path written : filesInSandbox()) {
                assertTrue(written.toAbsolutePath().normalize()
                                .startsWith(corpusDir.toAbsolutePath().normalize()),
                        c.input() + " escaped to " + written);
            }
        }
    }

    @Test
    void aForwardSlashPathIsReducedToItsBaseNameAndKept() throws IOException {
        // getFilename() strips the directory portion, so this is a legitimate
        // upload named passwd.pdf - not a traversal. It must still be contained.
        assertNull(service.uploadDocument(pdf("/etc/passwd.pdf"), null, null));

        assertTrue(Files.exists(corpusDir.resolve("passwd.pdf")));
        assertEquals(1, filesInSandbox().size());
    }

    @Test
    void theStoredFilePathNeverContainsATraversalSequence() {
        // file_path is handed to the Python service, which resolves it against
        // its own corpus root. A stored "../" would push the traversal across the
        // service boundary, where a second guard has to catch it.
        service.uploadDocument(pdf("../../escaped.pdf"), null, null);

        var captor = org.mockito.ArgumentCaptor.forClass(SourceDocument.class);
        verify(documentRepository, org.mockito.Mockito.atMost(1)).save(captor.capture());
        for (SourceDocument saved : captor.getAllValues()) {
            assertFalse(saved.getFilePath().contains(".."),
                    "stored file_path contains a traversal: " + saved.getFilePath());
            assertFalse(saved.getFilePath().contains("\\"),
                    "stored file_path contains a backslash: " + saved.getFilePath());
        }
    }

    @ParameterizedTest(name = "[{index}] {0} is rejected as not a PDF")
    @ValueSource(strings = {
            "notes.txt", "shell.sh", "config.properties", "archive.zip",
            "payload.pdf.exe", "image.png", "noextension",
    })
    void onlyPdfsAreAccepted(String filename) throws IOException {
        String error = service.uploadDocument(pdf(filename), null, null);

        assertNotNull(error, filename + " should have been rejected");
        assertTrue(error.contains("PDF"));
        assertEquals(0, filesInSandbox().size(), "nothing should have been written");
        verify(documentRepository, never()).save(any());
    }

    @Test
    void anUppercaseExtensionIsStillAPdf() throws IOException {
        assertNull(service.uploadDocument(pdf("BOOK.PDF"), null, null));
        assertTrue(Files.exists(corpusDir.resolve("BOOK.PDF")));
    }

    @Test
    void anEmptyUploadIsRejectedBeforeAnythingIsWritten() throws IOException {
        MockMultipartFile empty = new MockMultipartFile(
                "file", "book.pdf", "application/pdf", new byte[0]);

        assertNotNull(service.uploadDocument(empty, null, null));
        assertEquals(0, filesInSandbox().size());
        verify(documentRepository, never()).save(any());
    }

    @Test
    void aNullFileIsRejected() {
        assertNotNull(service.uploadDocument(null, "title", null));
        verify(documentRepository, never()).save(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "/", "///"})
    void aFilenameThatReducesToNothingIsRejected(String filename) throws IOException {
        assertNotNull(service.uploadDocument(pdf(filename), null, null));
        assertEquals(0, filesInSandbox().size());
    }

    @Test
    void reUploadingTheSameNameReplacesRatherThanDuplicating() throws IOException {
        service.uploadDocument(pdf("book.pdf"), "Book", null);
        service.uploadDocument(pdf("book.pdf"), "Book", null);

        assertEquals(1, filesInSandbox().size(), "the file should be replaced, not duplicated");
    }

    @Test
    void aNewDocumentStartsPending() {
        var captor = org.mockito.ArgumentCaptor.forClass(SourceDocument.class);
        service.uploadDocument(pdf("book.pdf"), "Book", null);

        verify(documentRepository).save(captor.capture());
        SourceDocument saved = captor.getValue();
        assertEquals("PENDING", saved.getIngestStatus());
        assertFalse(saved.isIndexed());
        assertEquals(0, saved.getChunkCount());
    }

    // ==================================================================
    // 2. setStatus - rejected at the service layer, not only by the interceptor
    // ==================================================================

    @ParameterizedTest(name = "[{index}] status ''{0}'' is rejected")
    @ValueSource(strings = {"DELETED", "active", "Active", "", "ADMIN", "'; DROP TABLE users--"})
    void anUnknownStatusIsRejectedByTheServiceItself(String status) {
        // The controller only checks the caller's role; the set of permissible
        // statuses is this method's business, and the CHECK constraint's.
        String error = service.setStatus(5L, status, 1L);

        assertNotNull(error, "status " + status + " should have been refused");
        assertTrue(error.contains("Unknown status"));
        verify(userRepository, never()).save(any());
    }

    @Test
    void anAdminCannotSuspendTheirOwnAccount() {
        // Suspending yourself logs you out of the account needed to undo it.
        String error = service.setStatus(1L, AdminService.STATUS_SUSPENDED, 1L);

        assertNotNull(error);
        assertTrue(error.contains("your own account"));
        verify(userRepository, never()).save(any());
    }

    @Test
    void anAdminMayReActivateTheirOwnAccount() {
        // Not a lockout risk, so not blocked - the guard is about suspension
        // specifically, not about self-modification in general.
        User self = user(1L, "ADMIN");
        self.setStatus(AdminService.STATUS_SUSPENDED);
        when(userRepository.findById(1L)).thenReturn(Optional.of(self));

        assertNull(service.setStatus(1L, AdminService.STATUS_ACTIVE, 1L));
        assertEquals(AdminService.STATUS_ACTIVE, self.getStatus());
    }

    @Test
    void suspendingAnotherUserWorks() {
        User other = user(5L, "PRACTITIONER");
        when(userRepository.findById(5L)).thenReturn(Optional.of(other));

        assertNull(service.setStatus(5L, AdminService.STATUS_SUSPENDED, 1L));
        assertEquals(AdminService.STATUS_SUSPENDED, other.getStatus());
        verify(userRepository).save(other);
    }

    @Test
    void anUnknownUserIsReportedNotSilentlyIgnored() {
        when(userRepository.findById(999L)).thenReturn(Optional.empty());

        String error = service.setStatus(999L, AdminService.STATUS_SUSPENDED, 1L);

        assertNotNull(error);
        assertTrue(error.contains("999"));
        verify(userRepository, never()).save(any());
    }


    // ==================================================================
    // 2b. resetPassword (admin / patient) - hashed, never written in the clear
    // ==================================================================

    private static final String SECRET = "Correct-Horse-Battery-Staple-42";

    @Test
    void resetPasswordStoresABcryptHashNotThePlaintext() {
        User target = user(5L, "PATIENT");
        when(userRepository.findById(5L)).thenReturn(Optional.of(target));

        assertTrue(service.resetPassword(5L, SECRET).ok());

        String stored = target.getPasswordHash();
        assertNotEquals(SECRET, stored, "the plaintext must never be the stored value");
        assertFalse(stored.contains(SECRET), "the hash must not embed the plaintext");
        assertTrue(stored.startsWith("$2a$") || stored.startsWith("$2b$")
                || stored.startsWith("$2y$"), "expected a BCrypt hash, got: " + stored);
        assertTrue(ENCODER.matches(SECRET, stored), "the hash must verify the new password");
    }

    @Test
    void resetPasswordNeverPutsThePasswordInALogLine() {
        User target = user(5L, "PATIENT");
        when(userRepository.findById(5L)).thenReturn(Optional.of(target));

        service.resetPassword(5L, SECRET);

        assertFalse(logText().contains(SECRET),
                "the new password appeared in a log line: " + logText());
        assertTrue(logText().contains("5"), "the user id should still be logged for audit");
    }

    @Test
    void resetPasswordNeverReturnsThePasswordInItsMessage() {
        User target = user(5L, "PATIENT");
        when(userRepository.findById(5L)).thenReturn(Optional.of(target));

        AdminService.Issued ok = service.resetPassword(5L, SECRET);
        assertTrue(ok.ok());
        assertFalse(String.valueOf(ok).contains(SECRET));

        String tooShort = service.resetPassword(5L, "abc").error();
        assertNotNull(tooShort);
        assertFalse(tooShort.contains("abc"),
                "the rejected password was echoed back: " + tooShort);
    }

    @Test
    void adminServiceWritesNothingToTheActivityLog() {
        // No activity_logs write on these paths, so there is no details field for
        // a password or activation code to reach.
        when(userRepository.findById(5L)).thenReturn(Optional.of(user(5L, "STUDENT")));
        when(userRepository.findById(6L)).thenReturn(Optional.of(user(6L, "PATIENT")));
        when(userRepository.nextStudentLoginNumber()).thenReturn(9L);

        service.resetPassword(5L, null);
        service.resetPassword(6L, SECRET);
        service.setStatus(5L, AdminService.STATUS_SUSPENDED, 1L);
        service.uploadDocument(pdf("book.pdf"), "Book", null);

        verifyNoInteractions(activityLogRepository);
    }

    @ParameterizedTest(name = "[{index}] a {0}-character password is rejected")
    @ValueSource(strings = {"", " ", "a", "abc", "12345", "1234567"})
    void tooShortAPasswordIsRejectedBeforeTheUserIsSaved(String weak) {
        when(userRepository.findById(5L)).thenReturn(Optional.of(user(5L, "PATIENT")));

        String error = service.resetPassword(5L, weak).error();

        assertNotNull(error);
        assertTrue(error.contains("8 characters"));
        verify(userRepository, never()).save(any());
    }

    @Test
    void resettingAnUnknownUserIsReported() {
        when(userRepository.findById(999L)).thenReturn(Optional.empty());

        String error = service.resetPassword(999L, SECRET).error();

        assertNotNull(error);
        assertTrue(error.contains("999"));
        verify(userRepository, never()).save(any());
    }

    // ==================================================================
    // 2c. resetPassword (practitioner / student) - a new activation code
    // ==================================================================

    @ParameterizedTest
    @ValueSource(strings = {"PRACTITIONER", "STUDENT"})
    void resettingAPractitionerOrStudentIssuesANewCodeAndRequiresANewPassword(String role) {
        User target = user(5L, role);
        target.setLoginId(role.equals("PRACTITIONER") ? "DOC-0007" : "STU-0007");
        String oldHash = target.getPasswordHash();
        when(userRepository.findById(5L)).thenReturn(Optional.of(target));

        AdminService.Issued issued = service.resetPassword(5L, "ignored-password");

        assertTrue(issued.ok());
        assertEquals(target.getLoginId(), issued.loginId());
        assertTrue(issued.activationCode().matches("\\d{6}"), issued.activationCode());
        assertTrue(target.isMustSetPassword());
        assertTrue(ENCODER.matches(issued.activationCode(), target.getActivationCodeHash()));
        assertNotEquals(oldHash, target.getPasswordHash(), "the old password must stop working");
        assertFalse(ENCODER.matches("original-password", target.getPasswordHash()));
        assertFalse(ENCODER.matches("ignored-password", target.getPasswordHash()),
                "an admin-chosen password is not applied to an ID-login account");
        assertFalse(logText().contains(issued.activationCode()), "the code reached a log line");
    }

    @Test
    void aSecondResetInvalidatesTheFirstCode() {
        User target = user(5L, "STUDENT");
        target.setLoginId("STU-0007");
        when(userRepository.findById(5L)).thenReturn(Optional.of(target));

        String first = service.resetPassword(5L, null).activationCode();
        String second = service.resetPassword(5L, null).activationCode();

        assertTrue(ENCODER.matches(second, target.getActivationCodeHash()));
        if (!first.equals(second)) { // a one-in-a-million repeat would make this vacuous
            assertFalse(ENCODER.matches(first, target.getActivationCodeHash()));
        }
    }

    // ==================================================================
    // createUser - practitioners and students, with an issued ID and code
    // ==================================================================

    private void givenRole(String name) {
        Role role = new Role();
        role.setRoleName(name);
        when(roleRepository.findByRoleName(name)).thenReturn(Optional.of(role));
    }

    private User capturedSave() {
        ArgumentCaptor<User> captor = ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(captor.capture());
        return captor.getValue();
    }

    @Test
    void creatingAPractitionerIssuesTheNextDocIdAndASixDigitCode() {
        givenRole("PRACTITIONER");
        when(userRepository.nextPractitionerLoginNumber()).thenReturn(2L);
        when(userRepository.save(any(User.class))).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            u.setUserId(42L);
            return u;
        });

        AdminService.Issued issued = service.createUser("Dr. New", "New@Example.COM ", "9000",
                "GSMC", "TN-1", "PRACTITIONER");

        assertTrue(issued.ok(), issued.error());
        assertEquals(42L, issued.userId());
        assertEquals("DOC-0002", issued.loginId());
        assertTrue(issued.activationCode().matches("\\d{6}"), issued.activationCode());

        User saved = capturedSave();
        assertEquals("DOC-0002", saved.getLoginId());
        assertEquals("new@example.com", saved.getEmail(), "email is normalised");
        assertEquals("9000", saved.getPhone());
        assertEquals("GSMC", saved.getInstitution());
        assertEquals("TN-1", saved.getRegNumber());
        assertTrue(saved.isMustSetPassword());
    }

    @Test
    void creatingAStudentUsesTheStudentSequence() {
        givenRole("STUDENT");
        when(userRepository.nextStudentLoginNumber()).thenReturn(13L);
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        assertEquals("STU-0013", service.createUser("S", "s@x.in", null, null, null, "student").loginId());
        verify(userRepository, never()).nextPractitionerLoginNumber();
    }

    @Test
    void onlyTheCodesHashIsStoredAndItExpiresInSevenDays() {
        givenRole("STUDENT");
        when(userRepository.nextStudentLoginNumber()).thenReturn(2L);
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        AdminService.Issued issued = service.createUser("S", "s@x.in", null, null, null, "STUDENT");
        User saved = capturedSave();

        assertNotEquals(issued.activationCode(), saved.getActivationCodeHash());
        assertFalse(saved.getActivationCodeHash().contains(issued.activationCode()));
        assertTrue(ENCODER.matches(issued.activationCode(), saved.getActivationCodeHash()));
        Duration ttl = Duration.between(Instant.now(), saved.getActivationExpiresAt());
        assertTrue(ttl.compareTo(Duration.ofDays(7).minusMinutes(1)) > 0
                && ttl.compareTo(Duration.ofDays(7)) <= 0, "ttl was " + ttl);
        assertFalse(logText().contains(issued.activationCode()), "the code reached a log line");
    }

    @Test
    void aNewAccountHasNoUsablePassword() {
        givenRole("STUDENT");
        when(userRepository.nextStudentLoginNumber()).thenReturn(2L);
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        AdminService.Issued issued = service.createUser("S", "s@x.in", null, null, null, "STUDENT");
        User saved = capturedSave();

        assertNotNull(saved.getPasswordHash(), "password_hash is NOT NULL");
        assertFalse(ENCODER.matches(issued.activationCode(), saved.getPasswordHash()),
                "the code must not double as the password");
        assertFalse(ENCODER.matches("", saved.getPasswordHash()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"ADMIN", "PATIENT", "SUPERUSER", ""})
    void adminCanCreateOnlyPractitionersAndStudents(String role) {
        givenRole(role);

        AdminService.Issued issued = service.createUser("X", "x@example.com", null, null, null, role);

        assertNotNull(issued.error());
        verify(userRepository, never()).save(any());
        verify(userRepository, never()).nextPractitionerLoginNumber();
        verify(userRepository, never()).nextStudentLoginNumber();
    }

    @Test
    void createUserRequiresNameAndEmail() {
        givenRole("STUDENT");
        assertNotNull(service.createUser("", "a@b.com", null, null, null, "STUDENT").error());
        assertNotNull(service.createUser("Name", "", null, null, null, "STUDENT").error());
        assertNotNull(service.createUser(null, null, null, null, null, "STUDENT").error());
        verify(userRepository, never()).save(any());
    }

    @Test
    void aTakenEmailIsReportedWithoutSpendingAnId() {
        givenRole("STUDENT");
        when(userRepository.existsByEmail("taken@example.com")).thenReturn(true);

        String error = service.createUser("Name", "taken@example.com", null, null, null, "STUDENT").error();

        assertNotNull(error);
        assertTrue(error.contains("already exists"));
        verify(userRepository, never()).nextStudentLoginNumber();
    }

    @Test
    void aConstraintViolationIsReportedNotThrown() {
        givenRole("STUDENT");
        when(userRepository.nextStudentLoginNumber()).thenReturn(2L);
        when(userRepository.save(any(User.class)))
                .thenThrow(new DataIntegrityViolationException("uq_users_email"));

        AdminService.Issued issued = service.createUser("Name", "race@example.com", null, null, null, "STUDENT");

        assertNotNull(issued.error());
        assertNull(issued.activationCode(), "no code for an account that does not exist");
    }

    @Test
    void consecutiveAccountsGetDistinctIds() {
        givenRole("PRACTITIONER");
        when(userRepository.nextPractitionerLoginNumber()).thenReturn(2L, 3L, 4L);
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        Set<String> ids = new HashSet<>();
        for (int i = 0; i < 3; i++) {
            ids.add(service.createUser("D" + i, "d" + i + "@x.in", null, null, null, "PRACTITIONER").loginId());
        }

        assertEquals(Set.of("DOC-0002", "DOC-0003", "DOC-0004"), ids);
    }

    @Test
    void anIdAlreadyTakenIsSkippedNotReused() {
        // e.g. a row inserted by hand ahead of the sequence.
        givenRole("PRACTITIONER");
        when(userRepository.nextPractitionerLoginNumber()).thenReturn(5L, 6L);
        when(userRepository.existsByLoginId("DOC-0005")).thenReturn(true);
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        assertEquals("DOC-0006",
                service.createUser("D", "d@x.in", null, null, null, "PRACTITIONER").loginId());
    }

    @Test
    void idsWidenPastFourDigitsRatherThanWrapping() {
        assertEquals("DOC-10000", Credentials.formatLoginId("PRACTITIONER", 10_000));
        assertEquals("STU-0001", Credentials.formatLoginId("STUDENT", 1));
    }

    // ==================================================================
    // 2d. suspend and reset end the user's existing sessions
    // ==================================================================

    @Test
    void suspendingAUserRevokesTheirSessions() {
        User target = user(5L, "PRACTITIONER");
        target.setSessionVersion(2);
        when(userRepository.findById(5L)).thenReturn(Optional.of(target));

        assertNull(service.setStatus(5L, AdminService.STATUS_SUSPENDED, 1L));

        assertEquals(3, target.getSessionVersion());
    }

    @Test
    void reSavingTheSameStatusDoesNotSignTheUserOut() {
        User target = user(5L, "PRACTITIONER");
        target.setSessionVersion(2);
        when(userRepository.findById(5L)).thenReturn(Optional.of(target));

        service.setStatus(5L, AdminService.STATUS_ACTIVE, 1L);

        assertEquals(2, target.getSessionVersion());
    }

    @ParameterizedTest
    @ValueSource(strings = {"PRACTITIONER", "STUDENT", "PATIENT", "ADMIN"})
    void anyResetRevokesTheUsersSessions(String role) {
        User target = user(5L, role);
        target.setLoginId(role.equals("PRACTITIONER") ? "DOC-0007" : role.equals("STUDENT") ? "STU-0007" : null);
        target.setSessionVersion(7);
        when(userRepository.findById(5L)).thenReturn(Optional.of(target));

        assertTrue(service.resetPassword(5L, SECRET).ok());

        assertEquals(8, target.getSessionVersion());
    }

    @Test
    void aRefusedResetLeavesSessionsAlone() {
        User target = user(5L, "PATIENT");
        target.setSessionVersion(7);
        when(userRepository.findById(5L)).thenReturn(Optional.of(target));

        assertNotNull(service.resetPassword(5L, "short").error());

        assertEquals(7, target.getSessionVersion());
    }
}
