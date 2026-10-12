package com.siddhamind.controller.api;

import com.siddhamind.entity.User;
import com.siddhamind.config.SessionKeys;
import com.siddhamind.service.AuthService;
import com.siddhamind.service.Credentials;
import com.siddhamind.service.SignInLockedException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * JSON sign-in for the React client.
 *
 * <p>Session-based, not token-based. It calls {@link AuthService#authenticate},
 * writes the three session attributes, and is therefore governed by the same
 * {@code AuthInterceptor} role table as every other route. A JWT was the
 * alternative and was rejected: two mechanisms deciding who is signed in is two
 * answers to that question, and the session already existed.
 *
 * <p>The client sends {@code credentials: "include"} and the browser carries
 * JSESSIONID from here on.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthApiController {

    private final AuthService authService;

    public AuthApiController(AuthService authService) {
        this.authService = authService;
    }

    /**
     * The one message for every sign-in or activation failure: unknown account,
     * wrong password, wrong/used/expired code, suspended, or an email typed for an
     * account that signs in by login ID. Distinguishing any of them would let a
     * caller enumerate accounts.
     */
    static final String SIGN_IN_FAILED = "Invalid sign-in details.";

    /**
     * The lockout answer, with 429. Not an enumeration oracle: the lock is keyed on
     * the identifier typed, so an ID that does not exist locks after the same five
     * failures and gets this same message.
     */
    static final String LOCKED_OUT = "Too many attempts. Try again in 15 minutes.";

    /** Session attribute AuthInterceptor reads to confine a session to set-password. */
    public static final String MUST_SET_PASSWORD = SessionKeys.MUST_SET_PASSWORD;

    /**
     * {@code identifier} is an email (admin, patient) or a login ID such as
     * DOC-0001 (practitioner, student). {@code email} is accepted as an alias so
     * clients written against the previous {email, password} shape keep working.
     */
    public record LoginRequest(String identifier, String email, String password) {
        String id() { return identifier != null ? identifier : email; }
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest body, HttpServletRequest req) {
        if (body == null || isBlank(body.id()) || body.password() == null) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "identifier and password are required."));
        }

        User user;
        try {
            user = authService.authenticate(body.id(), body.password());
        } catch (SignInLockedException e) {
            return lockedOut();
        }
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", SIGN_IN_FAILED));
        }
        startSession(req, user);
        return ResponseEntity.ok(withFlag(user));
    }

    public record ActivateRequest(String loginId, String activationCode) {}

    /**
     * First sign-in for a practitioner or student: login ID + one-time code.
     *
     * <p>Establishes a real session, but one flagged {@code mustSetPassword}:
     * AuthInterceptor lets it reach only set-password, /me and logout until the
     * flag is cleared. The code is not spent here but by a successful
     * set-password, so activating again after losing the tab still works.
     */
    @PostMapping("/activate")
    public ResponseEntity<?> activate(@RequestBody ActivateRequest body, HttpServletRequest req) {
        if (body == null || isBlank(body.loginId()) || isBlank(body.activationCode())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "loginId and activationCode are required."));
        }
        User user;
        try {
            user = authService.activate(body.loginId(), body.activationCode());
        } catch (SignInLockedException e) {
            return lockedOut();
        }
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", SIGN_IN_FAILED));
        }
        startSession(req, user);
        // Read before sessionView strips it: set-password must spend this exact code.
        req.getSession(false).setAttribute(SessionKeys.ACTIVATION_CODE_HASH, user.getActivationCodeHash());
        return ResponseEntity.ok(withFlag(user));
    }

    private static ResponseEntity<Map<String, String>> lockedOut() {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(Map.of("error", LOCKED_OUT));
    }

    public record SetPasswordRequest(String newPassword) {}

    /**
     * Sets the password of a session flagged {@code mustSetPassword}, spends the
     * activation code the session was opened with, and clears the flag. Not
     * public - it needs the session {@link #activate} created.
     */
    @PostMapping("/set-password")
    public ResponseEntity<?> setPassword(@RequestBody SetPasswordRequest body,
                                         HttpServletRequest req) {
        HttpSession session = req.getSession(false);
        Long userId = session == null ? null : (Long) session.getAttribute(SessionKeys.USER_ID);
        String codeHash = session == null ? null
                : (String) session.getAttribute(SessionKeys.ACTIVATION_CODE_HASH);
        AuthService.PasswordChange change = authService.setPassword(
                userId, codeHash, body == null ? null : body.newPassword());
        if (!change.ok()) {
            return ResponseEntity.badRequest().body(Map.of("error", change.error()));
        }

        // The session's privileges just widened, so give it a new id: a session id
        // captured while it was confined must not inherit the full account.
        req.changeSessionId();
        session.removeAttribute(MUST_SET_PASSWORD);
        session.removeAttribute(SessionKeys.ACTIVATION_CODE_HASH);
        // setPassword revoked every session of this user; this one carries on at
        // the new version, every other one is answered 401 on its next request.
        session.setAttribute(SessionKeys.SESSION_VERSION, change.sessionVersion());
        if (session.getAttribute(SessionKeys.CURRENT_USER) instanceof User view) {
            view.setMustSetPassword(false);
            // Re-set rather than relying on the in-place mutation, so a persistent
            // or replicated session store sees the change.
            session.setAttribute(SessionKeys.CURRENT_USER, view);
            return ResponseEntity.ok(withFlag(view));
        }
        return ResponseEntity.ok(Map.of("ok", true, "mustSetPassword", false));
    }

    /**
     * Same session-fixation defence as before: drop any session the caller
     * arrived with before establishing the authenticated one.
     */
    private void startSession(HttpServletRequest req, User user) {
        HttpSession existing = req.getSession(false);
        if (existing != null) {
            existing.invalidate();
        }
        HttpSession session = req.getSession(true);
        session.setAttribute(SessionKeys.USER_ID, user.getUserId());
        session.setAttribute(SessionKeys.CURRENT_USER, authService.sessionView(user));
        session.setAttribute(SessionKeys.ROLE, user.getRoleName());
        session.setAttribute(SessionKeys.SESSION_VERSION, user.getSessionVersion());
        if (user.isMustSetPassword()) {
            session.setAttribute(MUST_SET_PASSWORD, Boolean.TRUE);
        }
    }

    /**
     * {@code roleName} and the practitioner fields are tolerated so older clients
     * still deserialise, but only PATIENT (or no role) is accepted - see
     * {@link AuthService#register}.
     */
    public record RegisterRequest(String fullName, String email, String password,
                                 String phone, String roleName,
                                 String regNumber, String institution) {}

    /**
     * Patient self-registration - the only account type this unauthenticated
     * endpoint creates. Practitioners and students are created by an admin and
     * receive a login ID; the admin account is seeded.
     *
     * <p>One message covers both failure causes. The service distinguishes "email
     * already registered" from "role refused" in its log, but saying which to the
     * caller would let anyone probe for registered addresses.
     */
    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody RegisterRequest body) {
        if (body == null || isBlank(body.fullName()) || isBlank(body.email()) || isBlank(body.password())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "fullName, email and password are required."));
        }
        // Said specifically: it reveals nothing about which emails are registered.
        if (!Credentials.isAcceptablePassword(body.password())) {
            return ResponseEntity.badRequest().body(Map.of("error",
                    "The password must be at least " + Credentials.MIN_PASSWORD_LENGTH + " characters."));
        }

        User created = authService.register(body.fullName(), body.email(), body.password(),
                body.phone(), body.roleName());

        if (created == null) {
            return ResponseEntity.badRequest().body(Map.of("error",
                    "Could not create the account. The email may already be registered. "
                            + "Only patients can self-register; practitioner and student "
                            + "accounts are created by an administrator."));
        }

        // Deliberately does NOT sign the new account in. Registration and
        // authentication are separate steps here exactly as they are on the
        // registration flow: no session is created, so the client sends them
        // to /login next.
        return ResponseEntity.status(HttpStatus.CREATED).body(describe(created));
    }

    private static boolean isBlank(String v) { return v == null || v.isBlank(); }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest req) {
        HttpSession session = req.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        return ResponseEntity.noContent().build();
    }

    /**
     * The signed-in user, for restoring client state on a page refresh.
     *
     * <p>Reached only with a live session - the interceptor answers 401 otherwise -
     * so there is no unauthenticated branch to handle here.
     */
    @GetMapping("/me")
    public ResponseEntity<?> me(HttpSession session) {
        Object current = session.getAttribute("currentUser");
        if (!(current instanceof User user)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Not signed in."));
        }
        // Serialised field by field rather than by handing Jackson the entity.
        // AuthService.sessionView already nulls the password hash, so nothing
        // secret leaked either way - but returning the entity publishes the
        // column names (passwordHash among them) as part of the API's shape and
        // makes any future field automatically public. The wire contract is
        // stated here instead.
        Map<String, Object> out = new java.util.LinkedHashMap<>(withFlag(user));
        out.put("phone", user.getPhone());
        out.put("regNumber", user.getRegNumber());
        out.put("institution", user.getInstitution());
        out.put("status", user.getStatus());
        return ResponseEntity.ok(out);
    }

    private static Map<String, Object> describe(User user) {
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("userId", user.getUserId());
        out.put("name", user.getFullName() == null ? "" : user.getFullName());
        out.put("email", user.getEmail() == null ? "" : user.getEmail());
        out.put("role", user.getRoleName() == null ? "" : user.getRoleName());
        return out;
    }

    /** {@link #describe} plus the login ID and whether a password must be set first. */
    private static Map<String, Object> withFlag(User user) {
        Map<String, Object> out = describe(user);
        out.put("loginId", user.getLoginId());
        out.put("mustSetPassword", user.isMustSetPassword());
        return out;
    }
}
