package com.siddhamind.config;

import com.siddhamind.repository.UserRepository;
import com.siddhamind.repository.UserSessionState;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Session RBAC at the interceptor.
 *
 * <p>Rewritten when the server-rendered UI was removed. A refusal used to be a
 * redirect to /login or /denied; those pages no longer exist, so it is now a
 * status code. The tests assert the code and, just as importantly, that nothing
 * redirects any more - a 302 to a missing page would be a 404 the client could
 * not distinguish from a broken route.
 *
 * <p>The old postHandle tests are gone with postHandle itself: it existed only to
 * push currentUser/currentRole into a template model.
 */
class AuthInterceptorTest {

    /**
     * Every user is ACTIVE at session version 0, so these tests exercise the role
     * table alone. Revocation has its own tests in AuthInterceptorTest.
     */
    private final UserRepository users = activeUsers();

    static UserRepository activeUsers() {
        UserRepository repo = org.mockito.Mockito.mock(UserRepository.class);
        org.mockito.Mockito.when(repo.findSessionState(org.mockito.ArgumentMatchers.anyLong()))
                .thenReturn(java.util.Optional.of(new UserSessionState("ACTIVE", 0)));
        return repo;
    }

    private final AuthInterceptor interceptor = new AuthInterceptor(users);

    private MockHttpServletRequest request(String path, String userId, String role) {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", path);
        req.setRequestURI(path);
        if (userId != null) {
            req.getSession(true).setAttribute("userId", 1L);
            req.getSession(true).setAttribute("role", role);
            req.getSession(true).setAttribute("sessionVersion", 0);
        }
        return req;
    }

    private boolean allows(String path, String userId, String role) throws Exception {
        return interceptor.preHandle(request(path, userId, role), new MockHttpServletResponse(), null);
    }

    /** The response after a refusal, so status and redirect can both be checked. */
    private MockHttpServletResponse refuse(String path, String userId, String role) throws Exception {
        MockHttpServletResponse resp = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(request(path, userId, role), resp, null),
                path + " should have been refused");
        return resp;
    }

    // ---------- public paths ----------

    /**
     * The five paths that may be reached without a session, and nothing else.
     *
     * <p>Three API endpoints because that is how a session is created in the first
     * place, {@code /internal/health} because scripts/run.py polls it before a
     * session could exist, and {@code /error} because Spring forwards there for
     * every unhandled status - guarding it would turn a 404 into a 401 about the
     * error page itself.
     */
    @Test
    void allowsExactlyTheFiveRemainingPublicPaths() throws Exception {
        assertTrue(allows("/api/auth/login", null, null));
        assertTrue(allows("/api/auth/activate", null, null));
        assertTrue(allows("/api/auth/register", null, null));
        assertTrue(allows("/internal/health", null, null));
        assertTrue(allows("/error", null, null));
    }

    /**
     * The server-rendered pages were public; they are gone. Their paths must not
     * stay whitelisted, or an unauthenticated request to /login would be waved
     * through to a 404 instead of being told it needs a session.
     *
     * <p>Static-asset prefixes go with them: {@code /css/}, {@code /js/},
     * {@code /images/} and {@code /webjars/} served that UI's stylesheets and
     * bundles. PUBLIC_PREFIXES is now empty and WebConfig excludes only
     * {@code /error} from the interceptor, so these are guarded like anything else.
     */
    @Test
    void theRemovedServerRenderedPagesAreNoLongerPublic() throws Exception {
        for (String path : new String[] {
                "/", "/login", "/register", "/logout", "/denied",
                "/css/siddha.css", "/js/app.js", "/images/logo.png", "/webjars/x.js"}) {
            assertFalse(allows(path, null, null),
                    path + " must no longer be public - the page it served is gone");
        }
    }

    /**
     * Belt and braces on the same rule, read off the constant rather than inferred
     * from behaviour: a page path re-added to PUBLIC_EXACT by accident would make
     * it unauthenticated, and that is not something to discover from a 404.
     */
    @Test
    void thePublicPathSetContainsNoPagePaths() throws Exception {
        java.lang.reflect.Field f = AuthInterceptor.class.getDeclaredField("PUBLIC_EXACT");
        f.setAccessible(true);
        @SuppressWarnings("unchecked")
        java.util.Set<String> publicExact = (java.util.Set<String>) f.get(null);

        assertEquals(java.util.Set.of("/error", "/internal/health",
                        "/api/auth/login", "/api/auth/activate", "/api/auth/register"), publicExact,
                "PUBLIC_EXACT drifted; every entry must map to an endpoint that exists");

        java.lang.reflect.Field p = AuthInterceptor.class.getDeclaredField("PUBLIC_PREFIXES");
        p.setAccessible(true);
        @SuppressWarnings("unchecked")
        java.util.Set<String> prefixes = (java.util.Set<String>) p.get(null);
        assertTrue(prefixes.isEmpty(),
                "no static assets are served any more, so no prefix should be public");
    }

    /**
     * The relational version matched every public entry with a bare startsWith, so
     * any path beginning "/login" or "/register" skipped authentication entirely.
     */
    @Test
    void doesNotTreatPathsMerelyPrefixedByAPublicOneAsPublic() throws Exception {
        assertFalse(allows("/api/auth/loginhack", null, null));
        assertFalse(allows("/internal/healthz", null, null));
        assertFalse(allows("/errors", null, null));
    }

    // ---------- authentication ----------

    @Test
    void anonymousRequestsGet401AndAreNotRedirected() throws Exception {
        MockHttpServletResponse resp = refuse("/formulary", null, null);
        assertEquals(401, resp.getStatus());
        assertNull(resp.getRedirectedUrl(), "a refusal must not redirect to a page that no longer exists");
    }

    @Test
    void anonymousApiRequestsGet401WithAJsonBody() throws Exception {
        MockHttpServletResponse resp = refuse("/api/formulary", null, null);
        assertEquals(401, resp.getStatus());
        assertTrue(resp.getContentAsString().contains("\"error\""));
        assertTrue(resp.getContentType().startsWith("application/json"));
    }

    @Test
    void allowsAnyAuthenticatedRoleOnUnrestrictedPaths() throws Exception {
        assertTrue(allows("/formulary", "u1", "PATIENT"));
        assertTrue(allows("/profile", "u1", "STUDENT"));
        assertTrue(allows("/assistant", "u1", "PATIENT"));
    }

    // ---------- role rules ----------

    @Test
    void forbiddenRolesGet403AndAreNotRedirected() throws Exception {
        MockHttpServletResponse resp = refuse("/admin/users", "u1", "STUDENT");
        assertEquals(403, resp.getStatus());
        assertNull(resp.getRedirectedUrl());
    }

    @Test
    void forbiddenApiRolesGet403WithAJsonBody() throws Exception {
        MockHttpServletResponse resp = refuse("/api/admin/users", "u1", "STUDENT");
        assertEquals(403, resp.getStatus());
        assertTrue(resp.getContentAsString().contains("\"error\""));
    }

    @Test
    void restrictsAdminPathsToAdmins() throws Exception {
        assertTrue(allows("/admin/dashboard", "u1", "ADMIN"));
        assertFalse(allows("/admin/dashboard", "u1", "PRACTITIONER"));
        assertFalse(allows("/admin/users", "u1", "STUDENT"));
    }

    @Test
    void restrictsDiagnosisToPractitionersAndAdmins() throws Exception {
        assertTrue(allows("/diagnosis", "u1", "PRACTITIONER"));
        assertTrue(allows("/diagnosis/history", "u1", "ADMIN"));
        assertFalse(allows("/diagnosis", "u1", "STUDENT"));
        assertFalse(allows("/diagnosis", "u1", "PATIENT"));
    }

    @Test
    void keepsPatientsOutOfTheSafetyChecker() throws Exception {
        assertTrue(allows("/safety", "u1", "PRACTITIONER"));
        assertTrue(allows("/safety", "u1", "STUDENT"));
        assertFalse(allows("/safety", "u1", "PATIENT"));
    }

    @Test
    void keepsRolesOutOfEachOthersDashboards() throws Exception {
        assertTrue(allows("/practitioner/dashboard", "u1", "PRACTITIONER"));
        assertFalse(allows("/practitioner/dashboard", "u1", "STUDENT"));
        assertFalse(allows("/student/dashboard", "u1", "PATIENT"));
        assertFalse(allows("/patient/dashboard", "u1", "STUDENT"));
    }

    /** Rules match on whole segments, so a sibling path cannot slip past by prefix. */
    @Test
    void matchesRulePrefixesOnSegmentBoundaries() throws Exception {
        // "/administration" is not under the "/admin" rule, but it is still not public,
        // so an authenticated non-admin reaches it and an anonymous user does not.
        assertTrue(allows("/administration", "u1", "STUDENT"));
        assertFalse(allows("/administration", null, null));
    }

    @Test
    void treatsAMissingRoleAsUnauthorisedForRestrictedPaths() throws Exception {
        assertFalse(allows("/admin/dashboard", "u1", null));
    }

    /**
     * The whole point of stripping /api before matching: one table governs both.
     * If these ever disagree, a role could reach data through the API that the
     * same rule denies on the page path.
     */
    @Test
    void theApiAndPagePathsResolveToTheSameRule() throws Exception {
        for (String role : new String[] {"ADMIN", "PRACTITIONER", "STUDENT", "PATIENT"}) {
            assertEquals(allows("/admin/users", "u1", role), allows("/api/admin/users", "u1", role),
                    "admin rule disagreed between page and api for " + role);
            assertEquals(allows("/safety", "u1", role), allows("/api/safety", "u1", role),
                    "safety rule disagreed between page and api for " + role);
            assertEquals(allows("/diagnosis", "u1", role), allows("/api/diagnosis", "u1", role),
                    "diagnosis rule disagreed between page and api for " + role);
        }
    }
    // ---------- sessions confined to set-password ----------

    private MockHttpServletRequest confined(String method, String path, String role) {
        MockHttpServletRequest req = new MockHttpServletRequest(method, path);
        req.setRequestURI(path);
        req.getSession(true).setAttribute("userId", 20L);
        req.getSession(true).setAttribute("role", role);
        req.getSession(true).setAttribute("mustSetPassword", Boolean.TRUE);
        req.getSession(true).setAttribute("sessionVersion", 0);
        return req;
    }

    private boolean confinedAllows(String path, String role) throws Exception {
        return interceptor.preHandle(confined("POST", path, role), new MockHttpServletResponse(), null);
    }

    /**
     * A session opened with an activation code can set a password, ask who it is,
     * and sign out - nothing its role would otherwise reach.
     */
    @Test
    void aFlaggedSessionReachesOnlySetPasswordMeAndLogout() throws Exception {
        for (String role : new String[] {"PRACTITIONER", "STUDENT"}) {
            assertTrue(confinedAllows("/api/auth/set-password", role));
            assertTrue(confinedAllows("/api/auth/me", role));
            assertTrue(confinedAllows("/api/auth/logout", role));

            for (String path : new String[] {
                    "/api/formulary", "/api/assistant/ask", "/api/safety/check",
                    "/api/diagnosis/history", "/api/practitioner/dashboard",
                    "/api/student/dashboard", "/api/profile", "/api/admin/users",
                    "/api/auth/set-password/x", "/formulary"}) {
                assertFalse(confinedAllows(path, role), role + " flagged session reached " + path);
            }
        }
    }

    @Test
    void aFlaggedSessionIsRefusedWithAJson403() throws Exception {
        MockHttpServletResponse resp = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(confined("GET", "/api/formulary", "PRACTITIONER"), resp, null));

        assertEquals(403, resp.getStatus());
        assertTrue(resp.getContentType().startsWith("application/json"));
        assertTrue(resp.getContentAsString().contains("Set a new password"));
        assertNull(resp.getRedirectedUrl());
    }

    @Test
    void setPasswordStillNeedsASession() throws Exception {
        MockHttpServletResponse resp = refuse("/api/auth/set-password", null, null);
        assertEquals(401, resp.getStatus());
    }

    @Test
    void anUnflaggedSessionIsUnaffected() throws Exception {
        assertTrue(allows("/api/formulary", "u1", "PRACTITIONER"));
        assertTrue(allows("/api/diagnosis/history", "u1", "PRACTITIONER"));
    }
    // ---------- revocation: suspend / reset end existing sessions ----------

    private MockHttpServletRequest signedIn(String path, long userId, Integer version) {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", path);
        req.setRequestURI(path);
        req.getSession(true).setAttribute("userId", userId);
        req.getSession(true).setAttribute("role", "PRACTITIONER");
        if (version != null) {
            req.getSession(true).setAttribute("sessionVersion", version);
        }
        return req;
    }

    private MockHttpServletResponse callWith(UserSessionState state, Integer sessionVersion,
                                             MockHttpServletRequest[] out) throws Exception {
        UserRepository repo = org.mockito.Mockito.mock(UserRepository.class);
        org.mockito.Mockito.when(repo.findSessionState(7L))
                .thenReturn(java.util.Optional.ofNullable(state));
        MockHttpServletRequest req = signedIn("/api/formulary", 7L, sessionVersion);
        if (out != null) out[0] = req;
        MockHttpServletResponse resp = new MockHttpServletResponse();
        boolean allowed = new AuthInterceptor(repo).preHandle(req, resp, null);
        resp.setHeader("X-Allowed", String.valueOf(allowed));
        return resp;
    }

    @Test
    void aCurrentSessionOfAnActiveUserPasses() throws Exception {
        MockHttpServletResponse resp = callWith(new UserSessionState("ACTIVE", 3), 3, null);
        assertEquals("true", resp.getHeader("X-Allowed"));
    }

    @Test
    void aSessionOfASuspendedUserIsEndedWith401() throws Exception {
        MockHttpServletRequest[] req = new MockHttpServletRequest[1];
        MockHttpServletResponse resp = callWith(new UserSessionState("SUSPENDED", 4), 3, req);

        assertEquals("false", resp.getHeader("X-Allowed"));
        assertEquals(401, resp.getStatus());
        assertTrue(resp.getContentAsString().contains("Your session has ended"));
        assertTrue(((org.springframework.mock.web.MockHttpSession) req[0].getSession(false)) == null
                || ((org.springframework.mock.web.MockHttpSession) req[0].getSession(false)).isInvalid(),
                "the revoked session must be invalidated, not just refused once");
    }

    @Test
    void aSessionOpenedBeforeAResetIsEndedWith401() throws Exception {
        // Reset incremented the version from 3 to 4; this session recorded 3.
        MockHttpServletResponse resp = callWith(new UserSessionState("ACTIVE", 4), 3, null);
        assertEquals(401, resp.getStatus());
        assertEquals("false", resp.getHeader("X-Allowed"));
    }

    @Test
    void aSessionForADeletedUserIsEnded() throws Exception {
        assertEquals(401, callWith(null, 0, null).getStatus());
    }

    @Test
    void aSessionWithNoRecordedVersionIsEnded() throws Exception {
        // e.g. one created before revocation existed.
        assertEquals(401, callWith(new UserSessionState("ACTIVE", 0), null, null).getStatus());
    }

    @Test
    void revocationAlsoEndsAConfinedSession() throws Exception {
        UserRepository repo = org.mockito.Mockito.mock(UserRepository.class);
        org.mockito.Mockito.when(repo.findSessionState(20L))
                .thenReturn(java.util.Optional.of(new UserSessionState("ACTIVE", 1)));
        MockHttpServletResponse resp = new MockHttpServletResponse();

        // confined() records version 0; an admin re-issued the code since.
        assertFalse(new AuthInterceptor(repo).preHandle(
                confined("POST", "/api/auth/set-password", "STUDENT"), resp, null));
        assertEquals(401, resp.getStatus());
    }

    @Test
    void publicPathsNeverTouchTheDatabase() throws Exception {
        UserRepository repo = org.mockito.Mockito.mock(UserRepository.class);
        new AuthInterceptor(repo).preHandle(request("/api/auth/login", null, null),
                new MockHttpServletResponse(), null);
        org.mockito.Mockito.verifyNoInteractions(repo);
    }
}
