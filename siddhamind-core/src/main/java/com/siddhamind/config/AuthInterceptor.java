package com.siddhamind.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import com.siddhamind.repository.UserRepository;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.List;
import java.util.Set;

/**
 * Session RBAC. Ported from the relational version, with the path matching tightened.
 *
 * <p>Authorisation is deny-by-default: anything not listed in {@link #PUBLIC_PATHS}
 * requires a session, and {@link #RULES} then narrows specific prefixes to specific
 * roles. A new route is therefore login-protected the moment it is added; only its
 * role restriction needs a rule here.
 *
 * <p>There is no longer a server-rendered UI, so a refusal is a status code, never
 * a redirect: 401 with no session, 403 when the session's role is not allowed.
 * Redirecting to /login or /denied would now point at pages that do not exist, and
 * for the React client - the only client - a 302 to HTML was always the wrong
 * answer anyway. API and non-API paths differ in one respect only: /api/** is
 * answered with a JSON body, everything else with an empty status.
 */
@Component
public class AuthInterceptor implements HandlerInterceptor {

    /**
     * Public paths matched in full.
     *
     * <p>Kept separate from {@link #PUBLIC_PREFIXES} rather than inferring the
     * distinction from a trailing slash: the landing page is "/", and treating that
     * as a prefix makes {@code path.startsWith("/")} true for every request, which
     * would leave the whole application unauthenticated.
     */
    private static final Set<String> PUBLIC_EXACT =
            Set.of(// Spring forwards to /error for every unhandled status. Blocking it
                   // would turn a 404 into a 401 about the error page itself.
                   "/error",
                   // Liveness, polled by scripts/run.py before it opens a browser.
                   "/internal/health",
                   // The JSON sign-in endpoint. Unauthenticated by definition: it is
                   // how a session is established in the first place.
                   "/api/auth/login",
                   // First sign-in with a one-time code. Also how a session is
                   // established - a confined one, see CONFINED_SESSION_PATHS.
                   "/api/auth/activate",
                   // Likewise registration: a visitor with no session is exactly who
                   // this is for. AuthService creates PATIENT accounts only, so being
                   // public here does not make any staff role self-assignable.
                   "/api/auth/register");

    /**
     * The only paths a session flagged {@code mustSetPassword} may reach.
     *
     * <p>Such a session was opened with a one-time activation code. Until it has
     * chosen a password it can set one, read who it is, and leave - nothing else,
     * so a code alone never yields access to clinical data.
     */
    private static final Set<String> CONFINED_SESSION_PATHS =
            Set.of("/api/auth/set-password", "/api/auth/me", "/api/auth/logout");

    private final UserRepository userRepository;

    public AuthInterceptor(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    /**
     * Public path prefixes.
     *
     * <p>Empty. These were the server-rendered UI's static assets; that UI is gone
     * and the React client serves its own from Vite. Kept as a named, empty set
     * rather than deleted so the isPublic() contract stays symmetrical and adding
     * a public prefix later is a one-line change.
     */
    private static final Set<String> PUBLIC_PREFIXES = Set.of();

    /** Everything the React client calls sits under this. */
    private static final String API_PREFIX = "/api";

    /** Path prefix to the roles allowed past it. First match wins. */
    private static final List<Rule> RULES = List.of(
            new Rule("/admin", Set.of("ADMIN")),
            new Rule("/diagnosis", Set.of("PRACTITIONER", "ADMIN")),
            new Rule("/safety", Set.of("ADMIN", "PRACTITIONER", "STUDENT")),
            new Rule("/practitioner", Set.of("PRACTITIONER", "ADMIN")),
            new Rule("/student", Set.of("STUDENT", "ADMIN")),
            new Rule("/patient", Set.of("PATIENT", "ADMIN"))
    );

    private record Rule(String prefix, Set<String> allowedRoles) {
        boolean covers(String path) {
            return path.equals(prefix) || path.startsWith(prefix + "/");
        }
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse resp, Object handler)
            throws Exception {
        String path = req.getRequestURI().substring(req.getContextPath().length());
        if (path.isEmpty()) {
            path = "/";
        }

        if (isPublic(path)) {
            return true;
        }

        // An XHR from the React client must not be answered with a 302 to an HTML
        // login page: fetch() follows the redirect transparently and the caller
        // receives 200 plus a page of markup where it expected JSON, which is
        // indistinguishable from a successful request until it fails to parse.
        // These paths get a status code instead.
        boolean isApi = path.equals(API_PREFIX) || path.startsWith(API_PREFIX + "/");

        HttpSession session = req.getSession(false);
        if (session == null || session.getAttribute("userId") == null) {
            if (isApi) {
                sendJsonError(resp, HttpServletResponse.SC_UNAUTHORIZED, "Not signed in.");
            } else {
                resp.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            }
            return false;
        }

        // Revocation. A session is only as current as the user row behind it: an
        // admin suspend or reset increments users.session_version, and a session
        // recorded at the old value - or for an account no longer ACTIVE - is
        // ended here, on its very next request, rather than living on until it
        // times out. One narrow query per authenticated request.
        if (!isCurrent(session)) {
            session.invalidate();
            if (isApi) {
                sendJsonError(resp, HttpServletResponse.SC_UNAUTHORIZED,
                        "Your session has ended. Please sign in again.");
            } else {
                resp.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            }
            return false;
        }

        // Checked before the role table: a confined session holds a real role, and
        // its role alone would admit it to that role's routes.
        if (Boolean.TRUE.equals(session.getAttribute(SessionKeys.MUST_SET_PASSWORD))
                && !CONFINED_SESSION_PATHS.contains(path)) {
            if (isApi) {
                sendJsonError(resp, HttpServletResponse.SC_FORBIDDEN,
                        "Set a new password before continuing.");
            } else {
                resp.sendError(HttpServletResponse.SC_FORBIDDEN);
            }
            return false;
        }

        // One table governs every path. /api is stripped before matching, so the
        // API and any non-API route resolve to the same rule. Keeping a second
        // copy of the table for /api/** is how the two would drift apart - and a
        // drift here is data a role should not be able to reach.
        String ruleTarget = isApi ? path.substring(API_PREFIX.length()) : path;
        if (ruleTarget.isEmpty()) {
            ruleTarget = "/";
        }

        String role = (String) session.getAttribute("role");
        for (Rule rule : RULES) {
            if (rule.covers(ruleTarget)) {
                // A session carrying a userId but no role is malformed. Deny rather
                // than let Set.contains(null) throw and surface a 500.
                if (role == null || !rule.allowedRoles().contains(role)) {
                    if (isApi) {
                        sendJsonError(resp, HttpServletResponse.SC_FORBIDDEN,
                                "Your role may not access this.");
                    } else {
                        resp.sendError(HttpServletResponse.SC_FORBIDDEN);
                    }
                    return false;
                }
                return true;
            }
        }
        // Authenticated and not covered by a role rule: /formulary, /assistant, /profile.
        return true;
    }

    /**
     * True when the session's user still exists, is ACTIVE, and has the session
     * version the session recorded at sign-in. A session missing either attribute
     * (one created before revocation existed, or malformed) is not current.
     */
    private boolean isCurrent(HttpSession session) {
        if (!(session.getAttribute(SessionKeys.USER_ID) instanceof Long userId)
                || !(session.getAttribute(SessionKeys.SESSION_VERSION) instanceof Integer version)) {
            return false;
        }
        return userRepository.findSessionState(userId)
                .map(s -> "ACTIVE".equals(s.status()) && s.sessionVersion() == version)
                .orElse(false);
    }

    /**
     * Writes a minimal JSON error body.
     *
     * <p>Hand-rolled rather than routed through Jackson: this runs before any
     * handler is chosen, so there is no message converter in play, and the shape
     * is two fixed fields. The message is a fixed string at every call site, so
     * there is nothing here that needs escaping.
     */
    private static void sendJsonError(HttpServletResponse resp, int status, String message)
            throws java.io.IOException {
        resp.setStatus(status);
        resp.setContentType("application/json;charset=UTF-8");
        resp.getWriter().write("{\"error\":\"" + message + "\",\"status\":" + status + "}");
    }

    /**
     * The relational version used a bare {@code startsWith} for every public entry,
     * so {@code /loginhack} and {@code /registeranything} skipped authentication.
     * Page paths now match in full; only the asset prefixes match by prefix.
     */
    private boolean isPublic(String path) {
        if (PUBLIC_EXACT.contains(path)) {
            return true;
        }
        for (String prefix : PUBLIC_PREFIXES) {
            if (path.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

}
