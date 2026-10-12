package com.siddhamind.service;

import com.siddhamind.entity.Role;
import com.siddhamind.entity.User;
import com.siddhamind.repository.RoleRepository;
import com.siddhamind.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Locale;
import java.util.Optional;

/**
 * Sign-in, activation and patient self-registration.
 *
 * <p>Who signs in how:
 * <ul>
 *   <li>ADMIN and PATIENT - email + password.</li>
 *   <li>PRACTITIONER and STUDENT - an admin-issued login ID (DOC-0001, STU-0001).
 *       The first sign-in is login ID + one-time activation code, which yields a
 *       session that may do nothing but set a password; after that, login ID +
 *       password.</li>
 * </ul>
 *
 * <p>Every failure in {@link #authenticate} and {@link #activate} returns null and
 * nothing else, so a caller has nothing to distinguish "no such account" from
 * "wrong secret" from "locked" with. Each also counts against
 * {@link LoginAttemptLimiter} for the identifier typed.
 */
@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    /** BCrypt hash of a value nobody holds, used to equalise timing. */
    private static final String DUMMY_HASH =
            "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final LoginAttemptLimiter limiter;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public AuthService(UserRepository userRepository, RoleRepository roleRepository,
                       LoginAttemptLimiter limiter) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.limiter = limiter;
    }

    /**
     * Password sign-in by email (admin, patient) or login ID (practitioner, student).
     *
     * <p>An account still waiting to set its password cannot sign in here: its
     * stored hash is of a random secret, and it is refused before that is even
     * checked. It must use {@link #activate}.
     *
     * @return the authenticated user, or null for any failure other than a lockout
     * @throws SignInLockedException when the identifier is locked - real or not
     */
    @Transactional
    public User authenticate(String identifier, String password) {
        if (identifier == null || identifier.isBlank() || password == null) {
            return null;
        }
        if (limiter.isLocked(identifier)) {
            throw new SignInLockedException();
        }

        User user = lookUp(identifier).orElse(null);
        // Always exactly one BCrypt compare, against a dummy hash when there is no
        // account, so a missing account does not answer measurably faster than a
        // wrong password - which would let an attacker enumerate.
        boolean passwordMatches = encoder.matches(password,
                user == null ? DUMMY_HASH : user.getPasswordHash());
        boolean ok = user != null
                && passwordMatches
                && "ACTIVE".equals(user.getStatus())
                && !user.isMustSetPassword();
        if (!ok) {
            limiter.recordFailure(identifier);
            return null;
        }

        limiter.recordSuccess(identifier);
        user.setLastLogin(Instant.now());
        return userRepository.save(user);
    }

    /**
     * Email for admin/patient, login ID for practitioner/student - and never the
     * other way round. A practitioner typing their email gets the same generic
     * failure as a wrong password, so the email form cannot be used to probe
     * which addresses belong to staff.
     */
    private Optional<User> lookUp(String identifier) {
        String loginId = Credentials.normaliseLoginId(identifier);
        if (loginId != null) {
            return userRepository.findByLoginId(loginId)
                    .filter(u -> Credentials.LOGIN_ID_ROLES.contains(u.getRoleName()));
        }
        if (identifier.contains("@")) {
            return userRepository.findByEmail(identifier.toLowerCase(Locale.ROOT).trim())
                    .filter(u -> Credentials.EMAIL_ROLES.contains(u.getRoleName()));
        }
        return Optional.empty();
    }

    /**
     * First sign-in (or the first after an admin reset): login ID + activation code.
     *
     * <p>Verifies the code but does not spend it. It is spent by a successful
     * {@link #setPassword}, so someone who activates and then loses the tab can
     * activate again with the same code until it expires. The returned user still
     * carries {@code activationCodeHash}; the caller keeps it in the session, and
     * set-password spends exactly that code and no other.
     *
     * @return the user, flagged mustSetPassword, or null for any failure other
     *         than a lockout
     * @throws SignInLockedException when the login ID is locked - real or not
     */
    @Transactional
    public User activate(String rawLoginId, String code) {
        if (rawLoginId == null || rawLoginId.isBlank() || code == null) {
            return null;
        }
        if (limiter.isLocked(rawLoginId)) {
            throw new SignInLockedException();
        }

        String loginId = Credentials.normaliseLoginId(rawLoginId);
        User user = loginId == null ? null : userRepository.findByLoginId(loginId)
                .filter(u -> Credentials.LOGIN_ID_ROLES.contains(u.getRoleName()))
                .orElse(null);
        String storedHash = user == null ? null : user.getActivationCodeHash();

        boolean codeMatches = encoder.matches(code, storedHash == null ? DUMMY_HASH : storedHash);
        boolean ok = storedHash != null
                && codeMatches
                && user.isMustSetPassword()
                && "ACTIVE".equals(user.getStatus())
                && user.getActivationExpiresAt() != null
                && Instant.now().isBefore(user.getActivationExpiresAt());
        if (!ok) {
            limiter.recordFailure(rawLoginId);
            return null;
        }

        limiter.recordSuccess(rawLoginId);
        user.setLastLogin(Instant.now());
        log.info("User {} activated with a one-time code", user.getUserId());
        return userRepository.save(user);
    }

    /** Outcome of {@link #setPassword}: an error, or the user's new session version. */
    public record PasswordChange(String error, int sessionVersion) {
        static PasswordChange failure(String error) { return new PasswordChange(error, -1); }
        public boolean ok() { return error == null; }
    }

    /**
     * Sets the password of an account that is required to choose one, spending the
     * activation code the session was opened with.
     *
     * <p>The code is spent by a conditional UPDATE that matches only while the
     * stored hash is still {@code activationCodeHash} and unexpired. A second
     * set-password with the same code - a replay, or a second tab activated with
     * it - matches no row and fails, and so does one after an admin re-issued the
     * code.
     *
     * <p>Refused for an account that is not flagged. This endpoint asks for no
     * current password - the activation code was the proof - so letting any
     * session use it would let a stolen session cookie take over the account.
     *
     * <p>Increments the session version, ending every other session of the user
     * (any second activated tab included); the caller records the new value in
     * the session it keeps.
     */
    @Transactional
    public PasswordChange setPassword(Long userId, String activationCodeHash, String newPassword) {
        if (!Credentials.isAcceptablePassword(newPassword)) {
            return PasswordChange.failure("The new password must be at least "
                    + Credentials.MIN_PASSWORD_LENGTH + " characters.");
        }
        User user = userId == null ? null : userRepository.findById(userId).orElse(null);
        if (user == null || !user.isMustSetPassword() || !"ACTIVE".equals(user.getStatus())
                || activationCodeHash == null) {
            return PasswordChange.failure("This account is not waiting for a new password.");
        }
        if (userRepository.consumeActivationCode(userId, activationCodeHash, Instant.now()) != 1) {
            return PasswordChange.failure("This activation code has already been used or has expired. "
                    + "Ask an administrator for a new one.");
        }
        user.setPasswordHash(encoder.encode(newPassword));
        user.setMustSetPassword(false);
        user.setActivationCodeHash(null);
        user.setActivationExpiresAt(null);
        user.revokeSessions();
        userRepository.save(user);
        log.info("User {} set a new password", userId);
        return new PasswordChange(null, user.getSessionVersion());
    }

    /**
     * Patient self-registration. The only role this unauthenticated endpoint grants.
     *
     * <p>{@code roleName} is accepted for compatibility with clients that still send
     * it, but anything other than blank or PATIENT is refused outright - not
     * silently downgraded, so a client asking for PRACTITIONER learns it must go
     * through an admin instead of ending up with a patient account it did not want.
     * Practitioners and students are created by an admin (see
     * {@link AdminService#createUser}); ADMIN is seeded and never created here.
     *
     * @return the created user, or null when the email is taken, the role is refused
     *         or the password is shorter than {@link Credentials#MIN_PASSWORD_LENGTH}
     */
    @Transactional
    public User register(String fullName, String email, String password, String phone,
                         String roleName) {
        if (email == null || email.isBlank() || !Credentials.isAcceptablePassword(password)) {
            return null;
        }
        String normalisedEmail = email.toLowerCase(Locale.ROOT).trim();

        String requested = roleName == null ? "" : roleName.toUpperCase(Locale.ROOT).trim();
        if (!requested.isEmpty() && !Credentials.PATIENT.equals(requested)) {
            log.warn("Rejected registration for {} requesting role '{}' - only PATIENT may self-register",
                    normalisedEmail, requested);
            return null;
        }

        Optional<Role> role = roleRepository.findByRoleName(Credentials.PATIENT);
        if (role.isEmpty()) {
            log.error("Role PATIENT is missing - has the seeder been run?");
            return null;
        }

        User user = new User();
        user.setFullName(fullName);
        user.setEmail(normalisedEmail);
        user.setPasswordHash(encoder.encode(password));
        user.setPhone(phone);
        user.setRole(role.get());
        user.setStatus("ACTIVE");
        user.setCreatedAt(Instant.now());

        try {
            return userRepository.save(user);
        } catch (DataIntegrityViolationException e) {
            // The unique index on users.email is the real guard; check-then-insert
            // would lose a concurrent signup.
            log.warn("Registration rejected for {} - email already registered", normalisedEmail);
            return null;
        }
    }

    /**
     * Copy of a user with every secret removed, for storing in the HTTP session.
     *
     * <p>A plain detached copy with no proxy behind it, so nothing reading the
     * session can trip a lazy-loading exception outside a transaction, and neither
     * the password hash nor the activation-code hash rides along.
     */
    public User sessionView(User user) {
        User view = new User();
        view.setUserId(user.getUserId());
        view.setFullName(user.getFullName());
        view.setEmail(user.getEmail());
        view.setPhone(user.getPhone());
        Role source = user.getRole();
        if (source != null) {
            Role roleCopy = new Role(source.getRoleName(), source.getDescription());
            roleCopy.setRoleId(source.getRoleId());
            view.setRole(roleCopy);
        }
        view.setRegNumber(user.getRegNumber());
        view.setInstitution(user.getInstitution());
        view.setStatus(user.getStatus());
        view.setCreatedAt(user.getCreatedAt());
        view.setLastLogin(user.getLastLogin());
        view.setLoginId(user.getLoginId());
        view.setMustSetPassword(user.isMustSetPassword());
        view.setPasswordHash(null);
        view.setActivationCodeHash(null);
        view.setActivationExpiresAt(null);
        return view;
    }
}
