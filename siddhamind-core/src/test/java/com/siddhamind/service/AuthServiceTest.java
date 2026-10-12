package com.siddhamind.service;

import com.siddhamind.entity.Role;
import com.siddhamind.entity.User;
import com.siddhamind.repository.RoleRepository;
import com.siddhamind.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The login model: email for admin and patient, login ID for practitioner and
 * student, a one-time activation code on first sign-in, and a per-ID lockout.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AuthServiceTest {

    @Mock UserRepository userRepository;
    @Mock RoleRepository roleRepository;

    private AuthService service;
    private MutableClock clock;
    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    @BeforeEach
    void setUp() {
        clock = new MutableClock(Instant.parse("2026-10-05T10:00:00Z"));
        service = new AuthService(userRepository, roleRepository, new LoginAttemptLimiter(clock));
        when(userRepository.findByEmail(anyString())).thenReturn(Optional.empty());
        when(userRepository.findByLoginId(anyString())).thenReturn(Optional.empty());
        when(userRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(userRepository.consumeActivationCode(anyLong(), anyString(), any())).thenReturn(1);
        when(roleRepository.findByRoleName(anyString()))
                .thenAnswer(inv -> Optional.of(new Role(inv.getArgument(0), "")));
    }

    private static User account(long id, String role, String email, String loginId, String password) {
        User u = new User();
        u.setUserId(id);
        u.setFullName("Test " + role);
        u.setEmail(email);
        u.setLoginId(loginId);
        u.setPasswordHash(ENCODER.encode(password));
        u.setStatus("ACTIVE");
        u.setRole(new Role(role, ""));
        return u;
    }

    /** As AdminService.createUser leaves it: unusable password, flagged, code outstanding. */
    private static User pending(long id, String role, String loginId, String code, Instant expires) {
        User u = account(id, role, loginId.toLowerCase() + "@example.com", loginId,
                Credentials.unusablePassword());
        u.setMustSetPassword(true);
        u.setActivationCodeHash(ENCODER.encode(code));
        u.setActivationExpiresAt(expires);
        return u;
    }

    private User givenEmail(User u) {
        when(userRepository.findByEmail(u.getEmail())).thenReturn(Optional.of(u));
        return u;
    }

    private User givenLoginId(User u) {
        when(userRepository.findByLoginId(u.getLoginId())).thenReturn(Optional.of(u));
        when(userRepository.findById(u.getUserId())).thenReturn(Optional.of(u));
        return u;
    }

    private Instant inAWeek() { return Instant.now().plus(Duration.ofDays(7)); }

    // ==================================================================
    // registration - PATIENT only
    // ==================================================================

    @ParameterizedTest(name = "[{index}] register refuses role ''{0}''")
    @ValueSource(strings = {"PRACTITIONER", "STUDENT", "ADMIN", "admin", " Admin ", "practitioner", "SUPERUSER"})
    void registerAcceptsOnlyThePatientRole(String role) {
        assertNull(service.register("Mallory", "m@example.com", "password1", null, role));
        verify(userRepository, never()).save(any());
    }

    @Test
    void patientRegisters() {
        User created = service.register("A", "a@example.com", "password1", "9000", "PATIENT");
        assertNotNull(created);
        assertEquals("PATIENT", created.getRoleName());
        assertNull(created.getLoginId(), "patients sign in by email and get no login ID");
        assertFalse(created.isMustSetPassword());
    }

    @Test
    void aMissingRoleMeansPatient() {
        assertEquals("PATIENT", service.register("A", "a@example.com", "password1", null, "").getRoleName());
        assertEquals("PATIENT", service.register("A", "b@example.com", "password1", null, null).getRoleName());
    }

    @ParameterizedTest(name = "[{index}] ''{0}'' is too short to register with")
    @ValueSource(strings = {"", "       ", "pw", "1234567"})
    void registrationRequiresAnEightCharacterPassword(String weak) {
        assertNull(service.register("A", "a@example.com", weak, null, "PATIENT"));
        verify(userRepository, never()).save(any());
    }

    @Test
    void registrationAcceptsExactlyEightCharacters() {
        assertNotNull(service.register("A", "a@example.com", "12345678", null, "PATIENT"));
    }

    @Test
    void duplicateEmailIsRejectedByTheDatabaseConstraint() {
        when(userRepository.save(any())).thenThrow(new DataIntegrityViolationException("uq_users_email"));
        assertNull(service.register("A", "taken@example.com", "password1", null, "PATIENT"));
    }

    @Test
    void registrationNormalisesTheEmailAndStoresABcryptHash() {
        service.register("A", "  MiXeD@Example.IN ", "hunter22", null, "PATIENT");

        ArgumentCaptor<User> captor = ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(captor.capture());
        assertEquals("mixed@example.in", captor.getValue().getEmail());
        String hash = captor.getValue().getPasswordHash();
        assertTrue(hash.startsWith("$2"), "expected a BCrypt hash, got: " + hash);
        assertTrue(ENCODER.matches("hunter22", hash));
    }

    // ==================================================================
    // password sign-in - who may use which identifier
    // ==================================================================

    @Test
    void adminSignsInWithEmailAndPassword() {
        givenEmail(account(1, "ADMIN", "admin@siddhamind.in", null, "admin123"));
        assertNotNull(service.authenticate("admin@siddhamind.in", "admin123"));
        assertNotNull(service.authenticate("  ADMIN@siddhamind.in ", "admin123"), "email is case-insensitive");
    }

    @Test
    void patientSignsInWithEmailAndPassword() {
        givenEmail(account(4, "PATIENT", "patient@siddhamind.in", null, "patient123"));
        assertNotNull(service.authenticate("patient@siddhamind.in", "patient123"));
    }

    @Test
    void practitionerSignsInWithLoginIdAndPassword() {
        givenLoginId(account(2, "PRACTITIONER", "doctor@siddhamind.in", "DOC-0001", "doctor123"));
        assertNotNull(service.authenticate("DOC-0001", "doctor123"));
        assertNotNull(service.authenticate(" doc-0001 ", "doctor123"), "the ID is case-insensitive");
    }

    @Test
    void studentSignsInWithLoginIdAndPassword() {
        givenLoginId(account(3, "STUDENT", "student@siddhamind.in", "STU-0001", "student123"));
        assertNotNull(service.authenticate("STU-0001", "student123"));
    }

    @Test
    void practitionerAndStudentCannotSignInByEmail() {
        givenEmail(account(2, "PRACTITIONER", "doctor@siddhamind.in", "DOC-0001", "doctor123"));
        givenEmail(account(3, "STUDENT", "student@siddhamind.in", "STU-0001", "student123"));

        assertNull(service.authenticate("doctor@siddhamind.in", "doctor123"));
        assertNull(service.authenticate("student@siddhamind.in", "student123"));
    }

    @Test
    void wrongPasswordIsRefused() {
        givenLoginId(account(2, "PRACTITIONER", "d@x.in", "DOC-0001", "doctor123"));
        givenEmail(account(1, "ADMIN", "admin@siddhamind.in", null, "admin123"));

        assertNull(service.authenticate("DOC-0001", "wrong"));
        assertNull(service.authenticate("admin@siddhamind.in", "wrong"));
    }

    @Test
    void suspendedAccountsAreRefusedByEitherIdentifier() {
        User doc = account(2, "PRACTITIONER", "d@x.in", "DOC-0001", "doctor123");
        doc.setStatus("SUSPENDED");
        givenLoginId(doc);
        User patient = account(4, "PATIENT", "p@x.in", null, "patient123");
        patient.setStatus("SUSPENDED");
        givenEmail(patient);

        assertNull(service.authenticate("DOC-0001", "doctor123"));
        assertNull(service.authenticate("p@x.in", "patient123"));
    }

    @Test
    void unknownOrMalformedIdentifiersFailWithoutThrowing() {
        assertNull(service.authenticate("nobody@example.com", "pw"));
        assertNull(service.authenticate("DOC-9999", "pw"));
        assertNull(service.authenticate("DOC-1", "pw"), "too few digits is not an ID");
        assertNull(service.authenticate("doctor", "pw"));
        assertNull(service.authenticate(null, null));
        assertNull(service.authenticate("", "pw"));
    }

    @Test
    void anAccountAwaitingActivationCannotSignInWithAPassword() {
        // Even if its stored hash were of a password someone knew.
        User u = pending(5, "PRACTITIONER", "DOC-0002", "123456", inAWeek());
        u.setPasswordHash(ENCODER.encode("known-password"));
        givenLoginId(u);

        assertNull(service.authenticate("DOC-0002", "known-password"));
    }

    // ==================================================================
    // activation - login ID + one-time code
    // ==================================================================

    @Test
    void theCorrectCodeOpensAFlaggedSessionWithoutSpendingIt() {
        User u = givenLoginId(pending(5, "PRACTITIONER", "DOC-0002", "482913", inAWeek()));
        String storedHash = u.getActivationCodeHash();

        User activated = service.activate("doc-0002", "482913");

        assertNotNull(activated);
        assertTrue(activated.isMustSetPassword(), "the session must be confined to set-password");
        assertEquals(storedHash, activated.getActivationCodeHash(),
                "the code is spent by set-password, not by activation");
        verify(userRepository, never()).consumeActivationCode(anyLong(), anyString(), any());
    }

    @Test
    void activatingTwiceBeforeSettingAPasswordWorks() {
        // Lost the tab after activating: the same code still opens a session.
        givenLoginId(pending(5, "STUDENT", "STU-0002", "482913", inAWeek()));

        assertNotNull(service.activate("STU-0002", "482913"));
        assertNotNull(service.activate("STU-0002", "482913"));
    }

    @Test
    void aGuessedIdWithoutTheCodeFails() {
        givenLoginId(pending(5, "STUDENT", "STU-0002", "482913", inAWeek()));

        assertNull(service.activate("STU-0002", ""));
        assertNull(service.activate("STU-0002", "000000"));
        assertNull(service.activate("STU-0003", "482913"), "a code is bound to its own ID");
        assertNull(service.activate("STU-0002", null));
    }

    @Test
    void aCodeSpentBySetPasswordCannotActivateAgain() {
        User u = givenLoginId(pending(5, "STUDENT", "STU-0002", "482913", inAWeek()));
        String hash = service.activate("STU-0002", "482913").getActivationCodeHash();

        assertTrue(service.setPassword(5L, hash, "a-good-passw0rd").ok());

        assertNull(u.getActivationCodeHash());
        assertNull(service.activate("STU-0002", "482913"), "single use");
    }

    @Test
    void aSecondSetPasswordWithTheSameCodeFails() {
        // Two tabs activated with one code; the first sets a password.
        givenLoginId(pending(5, "STUDENT", "STU-0002", "482913", inAWeek()));
        String tab1 = service.activate("STU-0002", "482913").getActivationCodeHash();
        String tab2 = service.activate("STU-0002", "482913").getActivationCodeHash();

        assertTrue(service.setPassword(5L, tab1, "first-passw0rd").ok());
        AuthService.PasswordChange second = service.setPassword(5L, tab2, "second-passw0rd");

        assertFalse(second.ok());
        assertTrue(ENCODER.matches("first-passw0rd",
                userRepository.findById(5L).orElseThrow().getPasswordHash()));
    }

    @Test
    void aSetPasswordThatLosesTheConditionalUpdateFailsAndChangesNothing() {
        // The race the conditional UPDATE exists for: another request spent the
        // code between this one's checks and its UPDATE.
        User u = givenLoginId(pending(5, "STUDENT", "STU-0002", "482913", inAWeek()));
        String hash = u.getActivationCodeHash();
        String passwordBefore = u.getPasswordHash();
        when(userRepository.consumeActivationCode(anyLong(), anyString(), any())).thenReturn(0);

        AuthService.PasswordChange change = service.setPassword(5L, hash, "a-good-passw0rd");

        assertFalse(change.ok());
        assertTrue(change.error().contains("already been used or has expired"));
        assertEquals(passwordBefore, u.getPasswordHash());
        assertTrue(u.isMustSetPassword());
        verify(userRepository, never()).save(any());
    }

    @Test
    void setPasswordSpendsExactlyTheSessionsCodeAndJudgesExpiryThen() {
        User u = givenLoginId(pending(5, "STUDENT", "STU-0002", "482913", inAWeek()));
        String hash = u.getActivationCodeHash();
        Instant before = Instant.now();

        service.setPassword(5L, hash, "a-good-passw0rd");

        ArgumentCaptor<Instant> now = ArgumentCaptor.forClass(Instant.class);
        verify(userRepository).consumeActivationCode(eq(5L), eq(hash), now.capture());
        assertFalse(now.getValue().isBefore(before), "expiry is judged at set-password time");
    }

    @Test
    void setPasswordWithoutAnActivatedCodeIsRefused() {
        givenLoginId(pending(5, "STUDENT", "STU-0002", "482913", inAWeek()));

        assertFalse(service.setPassword(5L, null, "a-good-passw0rd").ok());
        verify(userRepository, never()).consumeActivationCode(anyLong(), anyString(), any());
    }

    @Test
    void anExpiredCodeFails() {
        givenLoginId(pending(5, "PRACTITIONER", "DOC-0002", "482913",
                Instant.now().minus(Duration.ofMinutes(1))));

        assertNull(service.activate("DOC-0002", "482913"));
        verify(userRepository, never()).consumeActivationCode(anyLong(), anyString(), any());
    }

    @Test
    void aSuspendedAccountCannotActivate() {
        User u = pending(5, "PRACTITIONER", "DOC-0002", "482913", inAWeek());
        u.setStatus("SUSPENDED");
        givenLoginId(u);

        assertNull(service.activate("DOC-0002", "482913"));
    }

    @Test
    void anAccountWithNoOutstandingCodeCannotActivate() {
        givenLoginId(account(2, "PRACTITIONER", "d@x.in", "DOC-0001", "doctor123"));
        assertNull(service.activate("DOC-0001", "123456"));
    }

    // ==================================================================
    // set-password
    // ==================================================================

    @ParameterizedTest(name = "[{index}] ''{0}'' is too short")
    @ValueSource(strings = {"", "       ", "1234567", "short"})
    void setPasswordRequiresEightCharacters(String weak) {
        givenLoginId(pending(5, "STUDENT", "STU-0002", "482913", inAWeek()));

        String error = service.setPassword(5L, "$2a$10$x", weak).error();

        assertNotNull(error);
        assertTrue(error.contains("8 characters"));
        verify(userRepository, never()).save(any());
    }

    @Test
    void setPasswordClearsTheFlagAndThenTheIdAndPasswordWork() {
        User u = givenLoginId(pending(5, "STUDENT", "STU-0002", "482913", inAWeek()));
        String hash = service.activate("STU-0002", "482913").getActivationCodeHash();
        int versionBefore = u.getSessionVersion();

        AuthService.PasswordChange change = service.setPassword(5L, hash, "a-good-passw0rd");

        assertTrue(change.ok());
        assertEquals(versionBefore + 1, change.sessionVersion(), "other sessions of the user end");
        assertEquals(change.sessionVersion(), u.getSessionVersion());
        assertFalse(u.isMustSetPassword());
        assertTrue(ENCODER.matches("a-good-passw0rd", u.getPasswordHash()));
        assertNotNull(service.authenticate("STU-0002", "a-good-passw0rd"));
        assertNull(service.activate("STU-0002", "482913"), "the code is gone for good");
    }

    @Test
    void setPasswordIsRefusedForAnAccountNotAwaitingOne() {
        // It asks for no current password, so it must not be a general
        // "change password" for any signed-in session.
        givenLoginId(account(2, "PRACTITIONER", "d@x.in", "DOC-0001", "doctor123"));

        assertFalse(service.setPassword(2L, "$2a$10$x", "a-new-password").ok());
        assertFalse(service.setPassword(null, "$2a$10$x", "a-new-password").ok());
        verify(userRepository, never()).save(any());
    }

    // ==================================================================
    // rate limiting - 5 failures lock the ID for 15 minutes
    // ==================================================================

    private void failTimes(int n, String id) {
        for (int i = 0; i < n; i++) {
            assertNull(service.authenticate(id, "wrong-" + i));
        }
    }

    @Test
    void fiveFailuresLockTheIdEvenAgainstTheRightPassword() {
        givenLoginId(account(2, "PRACTITIONER", "d@x.in", "DOC-0001", "doctor123"));

        failTimes(5, "DOC-0001");

        assertThrows(SignInLockedException.class, () -> service.authenticate("DOC-0001", "doctor123"));
    }

    @Test
    void anUnknownIdLocksExactlyLikeARealOne() {
        // 429 for a real ID and not for an unknown one would reveal which exist.
        givenLoginId(account(2, "PRACTITIONER", "d@x.in", "DOC-0001", "doctor123"));
        failTimes(5, "DOC-0001");
        failTimes(5, "DOC-9999");

        assertThrows(SignInLockedException.class, () -> service.authenticate("DOC-0001", "x"));
        assertThrows(SignInLockedException.class, () -> service.authenticate("DOC-9999", "x"));
        assertThrows(SignInLockedException.class, () -> service.activate("DOC-9999", "123456"));
    }

    @Test
    void fourFailuresDoNotLock() {
        givenLoginId(account(2, "PRACTITIONER", "d@x.in", "DOC-0001", "doctor123"));
        failTimes(4, "DOC-0001");
        assertNotNull(service.authenticate("DOC-0001", "doctor123"));
    }

    @Test
    void theLockLiftsAfterFifteenMinutes() {
        givenLoginId(account(2, "PRACTITIONER", "d@x.in", "DOC-0001", "doctor123"));
        failTimes(5, "DOC-0001");

        clock.advance(Duration.ofMinutes(14));
        assertThrows(SignInLockedException.class, () -> service.authenticate("DOC-0001", "doctor123"));
        clock.advance(Duration.ofMinutes(2));
        assertNotNull(service.authenticate("DOC-0001", "doctor123"));
    }

    @Test
    void aSuccessResetsTheCount() {
        givenLoginId(account(2, "PRACTITIONER", "d@x.in", "DOC-0001", "doctor123"));
        failTimes(4, "DOC-0001");
        assertNotNull(service.authenticate("DOC-0001", "doctor123"));
        failTimes(4, "DOC-0001");
        assertNotNull(service.authenticate("DOC-0001", "doctor123"));
    }

    @Test
    void theLockIsPerIdAndIgnoresCase() {
        givenLoginId(account(2, "PRACTITIONER", "d@x.in", "DOC-0001", "doctor123"));
        givenLoginId(account(3, "STUDENT", "s@x.in", "STU-0001", "student123"));

        failTimes(5, "doc-0001");

        assertThrows(SignInLockedException.class, () -> service.authenticate("DOC-0001", "doctor123"),
                "same ID, different case");
        assertNotNull(service.authenticate("STU-0001", "student123"), "another ID is unaffected");
    }

    @Test
    void emailSignInIsRateLimitedToo() {
        givenEmail(account(1, "ADMIN", "admin@siddhamind.in", null, "admin123"));
        failTimes(5, "admin@siddhamind.in");
        assertThrows(SignInLockedException.class, () -> service.authenticate("admin@siddhamind.in", "admin123"));
    }

    @Test
    void fiveBadCodesLockActivationAgainstTheRightCode() {
        givenLoginId(pending(5, "STUDENT", "STU-0002", "482913", inAWeek()));

        for (int i = 0; i < 5; i++) {
            assertNull(service.activate("STU-0002", String.format("%06d", i)));
        }

        assertThrows(SignInLockedException.class, () -> service.activate("STU-0002", "482913"));
    }

    // ==================================================================
    // session hygiene
    // ==================================================================

    @Test
    void sessionViewCarriesTheLoginIdAndFlagButNoSecrets() {
        User u = pending(5, "PRACTITIONER", "DOC-0002", "482913", inAWeek());

        User view = service.sessionView(u);

        assertNull(view.getPasswordHash());
        assertNull(view.getActivationCodeHash());
        assertEquals("DOC-0002", view.getLoginId());
        assertTrue(view.isMustSetPassword());
        assertEquals("PRACTITIONER", view.getRoleName());
        assertNotNull(u.getPasswordHash(), "the original must not be mutated");
    }
}
