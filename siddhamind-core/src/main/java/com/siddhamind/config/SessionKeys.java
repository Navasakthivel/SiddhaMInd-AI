package com.siddhamind.config;

/**
 * HttpSession attribute names written by AuthApiController and read by
 * {@link AuthInterceptor}. One definition, so the writer and the reader cannot
 * drift apart on a spelling.
 */
public final class SessionKeys {

    private SessionKeys() {}

    public static final String USER_ID = "userId";
    public static final String ROLE = "role";
    public static final String CURRENT_USER = "currentUser";

    /** Present and TRUE while the session may do nothing but set a password. */
    public static final String MUST_SET_PASSWORD = "mustSetPassword";

    /** users.session_version at sign-in; a mismatch means the session was revoked. */
    public static final String SESSION_VERSION = "sessionVersion";

    /**
     * Hash of the activation code this session was opened with, so set-password
     * spends exactly that code. Server-side only; never serialised to the client.
     */
    public static final String ACTIVATION_CODE_HASH = "activationCodeHash";
}
