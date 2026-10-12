package com.siddhamind.service;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Credential rules shared by {@link AuthService} (which verifies) and
 * {@link AdminService} (which issues), so the two cannot disagree on a format,
 * a length or a lifetime.
 */
public final class Credentials {

    private Credentials() {}

    public static final String ADMIN = "ADMIN";
    public static final String PRACTITIONER = "PRACTITIONER";
    public static final String STUDENT = "STUDENT";
    public static final String PATIENT = "PATIENT";

    /** Roles that sign in with an admin-issued login ID rather than an email. */
    public static final Set<String> LOGIN_ID_ROLES = Set.of(PRACTITIONER, STUDENT);

    /** Roles that sign in by email. */
    public static final Set<String> EMAIL_ROLES = Set.of(ADMIN, PATIENT);

    public static final int MIN_PASSWORD_LENGTH = 8;
    public static final Duration ACTIVATION_TTL = Duration.ofDays(7);

    /** Same shape as the CHECK constraint in V5. */
    private static final Pattern LOGIN_ID = Pattern.compile("^(DOC|STU)-[0-9]{4,}$");

    private static final SecureRandom RANDOM = new SecureRandom();

    /** Uppercased and trimmed, or null when the input is not a login ID at all. */
    public static String normaliseLoginId(String raw) {
        if (raw == null) {
            return null;
        }
        String candidate = raw.trim().toUpperCase(Locale.ROOT);
        return LOGIN_ID.matcher(candidate).matches() ? candidate : null;
    }

    public static String prefixFor(String roleName) {
        if (PRACTITIONER.equals(roleName)) return "DOC";
        if (STUDENT.equals(roleName)) return "STU";
        throw new IllegalArgumentException("No login-ID prefix for role " + roleName);
    }

    /** DOC-0007, STU-0123; widens rather than truncates past 9999 (DOC-10000). */
    public static String formatLoginId(String roleName, long number) {
        return String.format(Locale.ROOT, "%s-%04d", prefixFor(roleName), number);
    }

    /** A uniformly random six-digit code, zero-padded. */
    public static String newActivationCode() {
        return String.format(Locale.ROOT, "%06d", RANDOM.nextInt(1_000_000));
    }

    /**
     * A secret nobody holds, for the NOT NULL password_hash of an account that has
     * not chosen a password yet. Hashed like a real password, so no code path can
     * tell such an account apart by the shape of its hash - it simply never matches.
     */
    public static String unusablePassword() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    public static boolean isAcceptablePassword(String password) {
        return password != null && password.length() >= MIN_PASSWORD_LENGTH && !password.isBlank();
    }
}
