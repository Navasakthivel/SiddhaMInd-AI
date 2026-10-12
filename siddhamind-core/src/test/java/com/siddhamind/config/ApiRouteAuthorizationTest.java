package com.siddhamind.config;

import com.siddhamind.repository.UserRepository;
import com.siddhamind.repository.UserSessionState;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Who may call each of the new JSON endpoints.
 *
 * <p>Asserted against {@link AuthInterceptor} rather than against the controllers,
 * because that is where the decision is actually made. None of the new API
 * controllers contains a role check: the interceptor strips the {@code /api}
 * prefix and matches the remainder against the single role table. These tests
 * exist to prove that indirection really covers the
 * paths - a route that no rule matches falls through to "any signed-in user",
 * which is the correct answer for {@code /api/formulary} and a silent hole for
 * {@code /api/admin/reports}.
 *
 * <p>A refusal on an API path must be a JSON 403, never a 302 to /denied. A
 * redirect is followed transparently by fetch(), so the client would receive 200
 * plus a page of HTML where it expected JSON.
 */
class ApiRouteAuthorizationTest {

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

    private MockHttpServletRequest request(String path, String role) {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", path);
        req.setRequestURI(path);
        if (role != null) {
            req.getSession(true).setAttribute("userId", 1L);
            req.getSession(true).setAttribute("role", role);
            req.getSession(true).setAttribute("sessionVersion", 0);
        }
        return req;
    }

    private MockHttpServletResponse call(String path, String role) throws Exception {
        MockHttpServletResponse resp = new MockHttpServletResponse();
        interceptor.preHandle(request(path, role), resp, null);
        return resp;
    }

    private boolean allows(String path, String role) throws Exception {
        return interceptor.preHandle(request(path, role), new MockHttpServletResponse(), null);
    }

    // ------------------------------------------------------------------
    // 1. registration is public
    // ------------------------------------------------------------------

    @Test
    void registrationIsReachableWithoutASession() throws Exception {
        assertTrue(allows("/api/auth/register", null),
                "/api/auth/register must be public - a visitor with no session is who it is for");
    }

    @Test
    void registrationBeingPublicDoesNotMakeNeighbouringApiPathsPublic() throws Exception {
        // The prefix-matching bug this guards against would have made
        // "/api/auth/register-admin" public too.
        assertFalse(allows("/api/auth/registerX", null));
        assertFalse(allows("/api/auth/register/escalate", null));
        assertFalse(allows("/api/admin/users", null));
    }

    // ------------------------------------------------------------------
    // 3 + 4. role dashboards and diagnosis history
    // ------------------------------------------------------------------

    @ParameterizedTest
    @CsvSource({
            // path,                            role,          allowed
            "/api/practitioner/dashboard,       PRACTITIONER,  true",
            "/api/practitioner/dashboard,       ADMIN,         true",
            "/api/practitioner/dashboard,       STUDENT,       false",
            "/api/practitioner/dashboard,       PATIENT,       false",

            "/api/student/dashboard,            STUDENT,       true",
            "/api/student/dashboard,            ADMIN,         true",
            "/api/student/dashboard,            PRACTITIONER,  false",
            "/api/student/dashboard,            PATIENT,       false",

            "/api/patient/dashboard,            PATIENT,       true",
            "/api/patient/dashboard,            ADMIN,         true",
            "/api/patient/dashboard,            PRACTITIONER,  false",
            "/api/patient/dashboard,            STUDENT,       false",

            "/api/diagnosis/history,            PRACTITIONER,  true",
            "/api/diagnosis/history,            ADMIN,         true",
            "/api/diagnosis/history,            STUDENT,       false",
            "/api/diagnosis/history,            PATIENT,       false",
    })
    void roleScopedEndpointsFollowTheSameTableAsThePages(String path, String role, boolean allowed)
            throws Exception {
        assertEquals(allowed, allows(path, role),
                path + " for " + role + " should be " + (allowed ? "allowed" : "refused"));
    }

    // ------------------------------------------------------------------
    // 6. admin-only endpoints
    // ------------------------------------------------------------------

    @ParameterizedTest
    @ValueSource(strings = {"/api/admin/reports", "/api/admin/users/2/reset", "/api/admin/users"})
    void adminEndpointsAreAdminOnly(String path) throws Exception {
        assertTrue(allows(path, "ADMIN"));
        for (String role : new String[]{"PRACTITIONER", "STUDENT", "PATIENT"}) {
            assertFalse(allows(path, role), path + " must be refused for " + role);
        }
    }

    // ------------------------------------------------------------------
    // 2, 5, 7. endpoints open to any signed-in role
    // ------------------------------------------------------------------

    @ParameterizedTest
    @ValueSource(strings = {
            "/api/profile",
            "/api/assistant/chats",
            "/api/assistant/chats/7",
            "/api/formulary/ingredients",
            "/api/formulary/diseases",
            "/api/formulary/diseases/3",
    })
    void sharedEndpointsAreOpenToEverySignedInRole(String path) throws Exception {
        for (String role : new String[]{"ADMIN", "PRACTITIONER", "STUDENT", "PATIENT"}) {
            assertTrue(allows(path, role), path + " should be reachable by " + role);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "/api/profile",
            "/api/assistant/chats",
            "/api/formulary/ingredients",
            "/api/diagnosis/history",
            "/api/admin/reports",
    })
    void noNewEndpointIsReachableWithoutASession(String path) throws Exception {
        assertFalse(allows(path, null), path + " must not be reachable unauthenticated");
        assertEquals(401, call(path, null).getStatus());
    }

    // ------------------------------------------------------------------
    // the refusal must be JSON, not a redirect
    // ------------------------------------------------------------------

    @Test
    void aRefusedApiCallGetsJson403NotARedirectToDenied() throws Exception {
        MockHttpServletResponse resp = call("/api/admin/reports", "STUDENT");

        assertEquals(403, resp.getStatus());
        assertNull(resp.getRedirectedUrl(),
                "an API refusal must not redirect: fetch() follows it and the caller "
                        + "receives 200 plus HTML where it expected JSON");
        assertTrue(resp.getContentType().startsWith("application/json"));
        assertTrue(resp.getContentAsString().contains("\"status\": 403")
                        || resp.getContentAsString().contains("\"status\":403"),
                "body was: " + resp.getContentAsString());
    }

    @Test
    void theEquivalentNonApiRefusalIsAPlain403() throws Exception {
        // The non-API half of the same rule, so a change to one side that forgets
        // the other shows up here.
        //
        // This used to assert a redirect to /denied. That page was part of the
        // server-rendered UI and no longer exists, so a redirect would now send the
        // caller to a 404 - which reads as a broken route rather than a refusal.
        // The refusal is a bare status code; only /api/** carries a JSON body.
        MockHttpServletResponse resp = call("/admin/reports", "STUDENT");

        assertEquals(403, resp.getStatus());
        assertNull(resp.getRedirectedUrl(), "nothing may redirect to the removed pages");
    }
}
