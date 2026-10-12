package com.siddhamind.controller.api;

import com.siddhamind.entity.ChatMessage;
import com.siddhamind.entity.ChatSession;
import com.siddhamind.entity.DiagnosisSession;
import com.siddhamind.entity.Disease;
import com.siddhamind.entity.Formulation;
import com.siddhamind.entity.Ingredient;
import com.siddhamind.entity.Notification;
import com.siddhamind.entity.Role;
import com.siddhamind.entity.SafetyCheck;
import com.siddhamind.entity.User;
import com.siddhamind.repository.ChatSessionRepository;
import com.siddhamind.repository.ContraindicationRepository;
import com.siddhamind.repository.DiagnosisSessionRepository;
import com.siddhamind.repository.DiseaseRepository;
import com.siddhamind.repository.FormulationRepository;
import com.siddhamind.repository.IngredientRepository;
import com.siddhamind.repository.NotificationRepository;
import com.siddhamind.repository.SafetyCheckRepository;
import com.siddhamind.service.AdminService;
import com.siddhamind.service.AiExplanationPort;
import com.siddhamind.service.AssistantService;
import com.siddhamind.service.AuthService;
import com.siddhamind.service.DiagnosisService;
import com.siddhamind.service.SignInLockedException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Behaviour of the JSON endpoints added for the React client.
 *
 * <p>Role refusals are asserted in {@code ApiRouteAuthorizationTest}, against the
 * interceptor that actually performs them. What is checked here is what each
 * endpoint returns once the caller is past that gate: the wire shape, the
 * ownership scoping the interceptor cannot do, and the failure answers.
 *
 * <p>Repositories are mocked. These endpoints hold no logic worth a database -
 * they read and reshape - and the point of the assertions below is the shape, not
 * the query.
 */
class ApiEndpointTest {

    private final NotificationRepository notifications = mock(NotificationRepository.class);
    private final DiagnosisSessionRepository diagnoses = mock(DiagnosisSessionRepository.class);
    private final SafetyCheckRepository checks = mock(SafetyCheckRepository.class);
    private final ChatSessionRepository chats = mock(ChatSessionRepository.class);
    private final FormulationRepository formulations = mock(FormulationRepository.class);
    private final IngredientRepository ingredients = mock(IngredientRepository.class);
    private final DiseaseRepository diseases = mock(DiseaseRepository.class);
    private final ContraindicationRepository contraindications = mock(ContraindicationRepository.class);
    private final AiExplanationPort ai = mock(AiExplanationPort.class);
    private final AssistantService assistantService = mock(AssistantService.class);
    private final AdminService adminService = mock(AdminService.class);
    private final AuthService authService = mock(AuthService.class);
    private final DiagnosisService diagnosisService = mock(DiagnosisService.class);

    private DashboardApiController dashboard;
    private AssistantApiController assistant;
    private AdminApiController admin;
    private FormularyApiController formulary;
    private DiagnosisApiController diagnosis;
    private AuthApiController auth;

    private static final long ME = 7L;
    private static final long SOMEONE_ELSE = 99L;

    @BeforeEach
    void setUp() {
        dashboard = new DashboardApiController(notifications, diagnoses, checks, chats,
                formulations, ingredients, diseases, ai);
        assistant = new AssistantApiController(assistantService);
        admin = new AdminApiController(adminService, checks, diagnoses);
        formulary = new FormularyApiController(formulations, contraindications, ingredients, diseases);
        diagnosis = new DiagnosisApiController(diagnosisService, diagnoses);
        auth = new AuthApiController(authService);
    }

    private MockHttpSession session(Long userId, String role) {
        MockHttpSession s = new MockHttpSession();
        if (userId != null) {
            s.setAttribute("userId", userId);
            s.setAttribute("role", role);
            s.setAttribute("currentUser", user(userId, "Test Person", role));
        }
        return s;
    }

    private static User user(Long id, String name, String roleName) {
        User u = new User();
        u.setUserId(id);
        u.setFullName(name);
        u.setEmail("test@siddhamind.in");
        u.setStatus("ACTIVE");
        u.setRole(new Role(roleName, roleName));
        return u;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> body(ResponseEntity<?> r) {
        return (Map<String, Object>) r.getBody();
    }

    // ==================================================================
    // 1. POST /api/auth/register - patients only
    // ==================================================================

    @Test
    void registerCreatesAPatientAndReturns201() {
        when(authService.register(any(), any(), any(), any(), any()))
                .thenReturn(user(11L, "New Patient", "PATIENT"));

        ResponseEntity<?> r = auth.register(new AuthApiController.RegisterRequest(
                "New Patient", "new@siddhamind.in", "password1", "9000", null, null, null));

        assertEquals(HttpStatus.CREATED, r.getStatusCode());
        assertEquals(11L, body(r).get("userId"));
        assertEquals("PATIENT", body(r).get("role"));
        assertFalse(body(r).containsKey("passwordHash"), "never expose the hash");
    }

    @Test
    void registerRefusesStaffRolesWithoutRevealingWhy() {
        // AuthService returns null for anything but PATIENT.
        when(authService.register(any(), any(), any(), any(), any())).thenReturn(null);

        for (String role : new String[]{"ADMIN", "PRACTITIONER", "STUDENT"}) {
            ResponseEntity<?> r = auth.register(new AuthApiController.RegisterRequest(
                    "Sneaky", "x@siddhamind.in", "password1", null, role, null, null));

            assertEquals(HttpStatus.BAD_REQUEST, r.getStatusCode());
            String message = String.valueOf(body(r).get("error"));
            assertTrue(message.contains("may already be registered"),
                    "one message must cover both causes, or the endpoint becomes an "
                            + "email-enumeration oracle; was: " + message);
            verify(authService).register(any(), any(), any(), any(), eq(role));
        }
    }

    @Test
    void registerRejectsMissingFieldsWithoutCallingTheService() {
        ResponseEntity<?> r = auth.register(new AuthApiController.RegisterRequest(
                "No Password", "x@siddhamind.in", "  ", null, "PATIENT", null, null));

        assertEquals(HttpStatus.BAD_REQUEST, r.getStatusCode());
        verify(authService, never()).register(any(), any(), any(), any(), any());
    }

    @Test
    void registerRejectsAShortPasswordWithASpecificMessage() {
        ResponseEntity<?> r = auth.register(new AuthApiController.RegisterRequest(
                "Short", "x@siddhamind.in", "1234567", null, "PATIENT", null, null));

        assertEquals(HttpStatus.BAD_REQUEST, r.getStatusCode());
        assertTrue(String.valueOf(body(r).get("error")).contains("at least 8 characters"));
        verify(authService, never()).register(any(), any(), any(), any(), any());
    }

    @Test
    void registerHandlesAnAbsentBody() {
        assertEquals(HttpStatus.BAD_REQUEST, auth.register(null).getStatusCode());
    }

    // ==================================================================
    // 1b. login / activate / set-password / me
    // ==================================================================

    private static User pendingPractitioner() {
        User u = user(20L, "Dr. New", "PRACTITIONER");
        u.setLoginId("DOC-0002");
        u.setMustSetPassword(true);
        u.setActivationCodeHash("$2a$10$code-hash");
        u.setSessionVersion(3);
        return u;
    }

    @Test
    void loginAcceptsALoginIdAsTheIdentifier() {
        User doc = user(2L, "Dr. M", "PRACTITIONER");
        doc.setLoginId("DOC-0001");
        when(authService.authenticate("DOC-0001", "doctor123")).thenReturn(doc);
        when(authService.sessionView(doc)).thenReturn(doc);
        MockHttpServletRequest req = new MockHttpServletRequest();

        ResponseEntity<?> r = auth.login(new AuthApiController.LoginRequest("DOC-0001", null, "doctor123"), req);

        assertEquals(HttpStatus.OK, r.getStatusCode());
        assertEquals("DOC-0001", body(r).get("loginId"));
        assertEquals(false, body(r).get("mustSetPassword"));
        assertEquals(2L, req.getSession(false).getAttribute("userId"));
        assertNull(req.getSession(false).getAttribute(AuthApiController.MUST_SET_PASSWORD));
    }

    @Test
    void loginStillAcceptsTheLegacyEmailField() {
        User admin = user(1L, "Admin", "ADMIN");
        when(authService.authenticate("admin@siddhamind.in", "admin123")).thenReturn(admin);
        when(authService.sessionView(admin)).thenReturn(admin);

        ResponseEntity<?> r = auth.login(new AuthApiController.LoginRequest(
                null, "admin@siddhamind.in", "admin123"), new MockHttpServletRequest());

        assertEquals(HttpStatus.OK, r.getStatusCode());
    }

    @Test
    void everySignInFailureGetsTheSameMessage() {
        // authenticate() and activate() return null for every cause; the
        // controller must not add a distinguishing detail of its own.
        when(authService.authenticate(any(), any())).thenReturn(null);
        when(authService.activate(any(), any())).thenReturn(null);

        ResponseEntity<?> unknownEmail = auth.login(
                new AuthApiController.LoginRequest("nobody@x.in", null, "pw"), new MockHttpServletRequest());
        ResponseEntity<?> unknownId = auth.login(
                new AuthApiController.LoginRequest("DOC-9999", null, "pw"), new MockHttpServletRequest());
        ResponseEntity<?> badCode = auth.activate(
                new AuthApiController.ActivateRequest("DOC-0002", "000000"), new MockHttpServletRequest());

        for (ResponseEntity<?> r : List.of(unknownEmail, unknownId, badCode)) {
            assertEquals(HttpStatus.UNAUTHORIZED, r.getStatusCode());
            assertEquals(AuthApiController.SIGN_IN_FAILED, body(r).get("error"));
        }
    }

    @Test
    void aLockedOutLoginOrActivationGets429WithTheFixedMessage() {
        when(authService.authenticate(any(), any())).thenThrow(new SignInLockedException());
        when(authService.activate(any(), any())).thenThrow(new SignInLockedException());

        ResponseEntity<?> login = auth.login(
                new AuthApiController.LoginRequest("DOC-0001", null, "pw"), new MockHttpServletRequest());
        ResponseEntity<?> unknown = auth.login(
                new AuthApiController.LoginRequest("DOC-9999", null, "pw"), new MockHttpServletRequest());
        MockHttpServletRequest activateReq = new MockHttpServletRequest();
        ResponseEntity<?> activate = auth.activate(
                new AuthApiController.ActivateRequest("DOC-0002", "123456"), activateReq);

        for (ResponseEntity<?> r : List.of(login, unknown, activate)) {
            assertEquals(HttpStatus.TOO_MANY_REQUESTS, r.getStatusCode());
            assertEquals("Too many attempts. Try again in 15 minutes.", body(r).get("error"));
        }
        assertNull(activateReq.getSession(false), "a lockout opens no session");
    }

    @Test
    void loginRequiresAnIdentifier() {
        assertEquals(HttpStatus.BAD_REQUEST, auth.login(
                new AuthApiController.LoginRequest(null, null, "pw"), new MockHttpServletRequest()).getStatusCode());
        verify(authService, never()).authenticate(any(), any());
    }

    @Test
    void activateStartsASessionFlaggedMustSetPassword() {
        User pending = pendingPractitioner();
        when(authService.activate("DOC-0002", "482913")).thenReturn(pending);
        when(authService.sessionView(pending)).thenReturn(pending);
        MockHttpServletRequest req = new MockHttpServletRequest();

        ResponseEntity<?> r = auth.activate(new AuthApiController.ActivateRequest("DOC-0002", "482913"), req);

        assertEquals(HttpStatus.OK, r.getStatusCode());
        assertEquals(true, body(r).get("mustSetPassword"));
        assertEquals(Boolean.TRUE, req.getSession(false).getAttribute(AuthApiController.MUST_SET_PASSWORD));
        assertEquals(20L, req.getSession(false).getAttribute("userId"));
        assertEquals("$2a$10$code-hash", req.getSession(false).getAttribute("activationCodeHash"),
                "set-password must be able to spend exactly this code");
        assertEquals(3, req.getSession(false).getAttribute("sessionVersion"));
        assertFalse(String.valueOf(body(r)).contains("code-hash"), "the hash never reaches the client");
    }

    @Test
    void loginRecordsTheSessionVersion() {
        User doc = user(2L, "Dr. M", "PRACTITIONER");
        doc.setSessionVersion(9);
        when(authService.authenticate("DOC-0001", "doctor123")).thenReturn(doc);
        when(authService.sessionView(doc)).thenReturn(doc);
        MockHttpServletRequest req = new MockHttpServletRequest();

        auth.login(new AuthApiController.LoginRequest("DOC-0001", null, "doctor123"), req);

        assertEquals(9, req.getSession(false).getAttribute("sessionVersion"));
    }

    @Test
    void activateRequiresBothFields() {
        assertEquals(HttpStatus.BAD_REQUEST, auth.activate(
                new AuthApiController.ActivateRequest("DOC-0002", " "), new MockHttpServletRequest()).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, auth.activate(null, new MockHttpServletRequest()).getStatusCode());
        verify(authService, never()).activate(any(), any());
    }

    @Test
    void setPasswordClearsTheSessionFlagAndRotatesTheSessionId() {
        User pending = pendingPractitioner();
        MockHttpServletRequest req = new MockHttpServletRequest();
        MockHttpSession s = new MockHttpSession();
        s.setAttribute("userId", 20L);
        s.setAttribute("role", "PRACTITIONER");
        s.setAttribute("currentUser", pending);
        s.setAttribute(AuthApiController.MUST_SET_PASSWORD, Boolean.TRUE);
        s.setAttribute("activationCodeHash", "$2a$10$code-hash");
        s.setAttribute("sessionVersion", 3);
        req.setSession(s);
        String idBefore = s.getId();
        when(authService.setPassword(20L, "$2a$10$code-hash", "a-good-passw0rd"))
                .thenReturn(new AuthService.PasswordChange(null, 4));

        ResponseEntity<?> r = auth.setPassword(new AuthApiController.SetPasswordRequest("a-good-passw0rd"), req);

        assertEquals(HttpStatus.OK, r.getStatusCode());
        assertEquals(false, body(r).get("mustSetPassword"));
        assertNull(s.getAttribute(AuthApiController.MUST_SET_PASSWORD));
        assertFalse(((User) s.getAttribute("currentUser")).isMustSetPassword());
        assertNotEquals(idBefore, req.getSession(false).getId(), "privileges widened; the id must change");
        assertEquals(4, s.getAttribute("sessionVersion"), "this session survives the revocation it caused");
        assertNull(s.getAttribute("activationCodeHash"), "the spent code's hash is dropped");
        assertFalse(String.valueOf(body(r)).contains("a-good-passw0rd"));
    }

    @Test
    void setPasswordSurfacesTheServicesRefusalAndKeepsTheFlag() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        MockHttpSession s = new MockHttpSession();
        s.setAttribute("userId", 20L);
        s.setAttribute(AuthApiController.MUST_SET_PASSWORD, Boolean.TRUE);
        req.setSession(s);
        when(authService.setPassword(20L, null, "short"))
                .thenReturn(new AuthService.PasswordChange("The new password must be at least 8 characters.", -1));

        ResponseEntity<?> r = auth.setPassword(new AuthApiController.SetPasswordRequest("short"), req);

        assertEquals(HttpStatus.BAD_REQUEST, r.getStatusCode());
        assertEquals(Boolean.TRUE, s.getAttribute(AuthApiController.MUST_SET_PASSWORD));
    }

    @Test
    void meReportsMustSetPasswordAndTheLoginId() {
        MockHttpSession s = new MockHttpSession();
        s.setAttribute("currentUser", pendingPractitioner());

        ResponseEntity<?> r = auth.me(s);

        assertEquals(true, body(r).get("mustSetPassword"));
        assertEquals("DOC-0002", body(r).get("loginId"));
    }

    // ==================================================================
    // 2. GET /api/profile
    // ==================================================================

    @Test
    void profileReturnsTheSignedInUserAndTheirNotifications() {
        Notification n = new Notification();
        n.setNotifId(3L);
        n.setTitle("Corpus indexed");
        n.setMessage("2 documents finished");
        n.setCreatedAt(Instant.now());
        when(notifications.findByUser_UserIdOrderByCreatedAtDesc(ME)).thenReturn(List.of(n));

        ResponseEntity<?> r = dashboard.profile(session(ME, "STUDENT"));

        assertEquals(HttpStatus.OK, r.getStatusCode());
        @SuppressWarnings("unchecked")
        Map<String, Object> profile = (Map<String, Object>) body(r).get("profile");
        assertEquals(ME, profile.get("userId"));
        assertEquals("STUDENT", profile.get("role"));
        assertFalse(profile.containsKey("passwordHash"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> notes = (List<Map<String, Object>>) body(r).get("notifications");
        assertEquals(1, notes.size());
        assertEquals("Corpus indexed", notes.get(0).get("title"));
    }

    @Test
    void profileIs401WithoutASession() {
        assertEquals(HttpStatus.UNAUTHORIZED, dashboard.profile(session(null, null)).getStatusCode());
    }

    // ==================================================================
    // 3. role dashboards
    // ==================================================================

    @Test
    void practitionerDashboardReturnsOnlyTheCallersOwnRows() {
        DiagnosisSession d = new DiagnosisSession();
        d.setSessionId(1L);
        d.setPatientName("A Patient");
        d.setDominantKutram("VATHAM");
        SafetyCheck c = new SafetyCheck();
        c.setCheckId(2L);
        c.setFormulationName("Thiripala Churanam");
        c.setRiskLevel("HIGH");

        when(diagnoses.findByPractitioner_UserIdOrderByCreatedAtDesc(ME)).thenReturn(List.of(d));
        when(checks.findByUser_UserIdOrderByCreatedAtDesc(ME)).thenReturn(List.of(c));
        when(formulations.count()).thenReturn(10L);
        when(ai.isAvailable()).thenReturn(true);

        ResponseEntity<?> r = dashboard.practitioner(session(ME, "PRACTITIONER"));

        assertEquals(10L, body(r).get("formulationCount"));
        assertEquals(true, body(r).get("aiReady"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> dx = (List<Map<String, Object>>) body(r).get("myDiagnoses");
        assertEquals("VATHAM", dx.get(0).get("dominantKutram"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> ck = (List<Map<String, Object>>) body(r).get("myChecks");
        assertEquals("HIGH", ck.get(0).get("riskLevel"));

        // Scoped by the session's id, never by a parameter the caller controls.
        verify(diagnoses).findByPractitioner_UserIdOrderByCreatedAtDesc(ME);
        verify(diagnoses, never()).findAllByOrderByCreatedAtDesc();
    }

    @Test
    void studentDashboardReturnsCountsAndTheCallersOwnChats() {
        ChatSession chat = new ChatSession();
        chat.setChatId(4L);
        chat.setTitle("What is Nandukkal Parpam?");
        when(chats.findByUser_UserIdOrderByCreatedAtDesc(ME)).thenReturn(List.of(chat));
        when(formulations.count()).thenReturn(10L);
        when(ingredients.count()).thenReturn(20L);
        when(diseases.count()).thenReturn(13L);

        ResponseEntity<?> r = dashboard.student(session(ME, "STUDENT"));

        assertEquals(10L, body(r).get("formulationCount"));
        assertEquals(20L, body(r).get("ingredientCount"));
        assertEquals(13L, body(r).get("diseaseCount"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> myChats = (List<Map<String, Object>>) body(r).get("myChats");
        assertEquals(4L, myChats.get(0).get("chatId"));
        verify(chats).findByUser_UserIdOrderByCreatedAtDesc(ME);
    }

    @Test
    void patientDashboardReturnsHeavyMetalIngredientsWithTheirCeilings() {
        Ingredient i = new Ingredient();
        i.setIngredientId(5L);
        i.setNameEnglish("Cinnabar");
        i.setHeavyMetal(true);
        i.setElementSymbol("Hg");
        i.setMaxDailyMg(4);
        when(ingredients.findByHeavyMetalTrueOrderByNameEnglishAsc()).thenReturn(List.of(i));

        ResponseEntity<?> r = dashboard.patient();

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows =
                (List<Map<String, Object>>) body(r).get("heavyMetalIngredients");
        assertEquals("Cinnabar", rows.get(0).get("nameEnglish"));
        assertEquals("Hg", rows.get(0).get("elementSymbol"));
        assertEquals(4, rows.get(0).get("maxDailyMg"));
    }

    // ==================================================================
    // 4. GET /api/diagnosis/history
    // ==================================================================

    @Test
    void historyReturnsOnlyTheCallersSessionsForAPractitioner() {
        DiagnosisSession mine = new DiagnosisSession();
        mine.setSessionId(1L);
        when(diagnoses.findByPractitioner_UserIdOrderByCreatedAtDesc(ME)).thenReturn(List.of(mine));

        ResponseEntity<?> r = diagnosis.history(session(ME, "PRACTITIONER"));

        assertEquals("mine", body(r).get("scope"));
        assertEquals(1, body(r).get("total"));
        verify(diagnoses).findByPractitioner_UserIdOrderByCreatedAtDesc(ME);
        verify(diagnoses, never()).findAllByOrderByCreatedAtDesc();
    }

    @Test
    void historyReturnsEverySessionForAnAdmin() {
        when(diagnoses.findAllByOrderByCreatedAtDesc())
                .thenReturn(List.of(new DiagnosisSession(), new DiagnosisSession()));

        ResponseEntity<?> r = diagnosis.history(session(ME, "ADMIN"));

        assertEquals("all", body(r).get("scope"));
        assertEquals(2, body(r).get("total"));
        verify(diagnoses, never()).findByPractitioner_UserIdOrderByCreatedAtDesc(any());
    }

    @Test
    void historyIs401WithoutASession() {
        assertEquals(401, diagnosis.history(session(null, null)).getStatusCode().value());
    }

    // ==================================================================
    // 5. GET /api/assistant/chats and /chats/{id}
    // ==================================================================

    @Test
    void chatsListsOnlyTheCallersConversations() {
        ChatSession c = new ChatSession();
        c.setChatId(4L);
        c.setTitle("Nandukkal Parpam");
        when(assistantService.sessionsFor(ME)).thenReturn(List.of(c));

        ResponseEntity<?> r = assistant.chats(session(ME, "STUDENT"));

        assertEquals(1, body(r).get("total"));
        verify(assistantService).sessionsFor(ME);
    }

    @Test
    void chatDetailReturnsMessagesWithCitationsForTheOwner() {
        ChatSession c = new ChatSession();
        c.setChatId(4L);
        c.setTitle("Nandukkal Parpam");
        ChatMessage m = new ChatMessage();
        m.setMessageId(9L);
        m.setSender("ASSISTANT");
        m.setMessage("It is indicated for...");
        m.setDeliveryStatus(ChatMessage.DELIVERY_ANSWERED);

        when(assistantService.session(4L, ME)).thenReturn(Optional.of(c));
        when(assistantService.messages(4L, ME)).thenReturn(List.of(m));

        ResponseEntity<?> r = assistant.chat(4L, session(ME, "STUDENT"));

        assertEquals(HttpStatus.OK, r.getStatusCode());
        assertEquals(4L, body(r).get("chatId"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> msgs = (List<Map<String, Object>>) body(r).get("messages");
        assertEquals("cited", msgs.get(0).get("status"));
        assertEquals("It is indicated for...", msgs.get(0).get("body"));
        assertNotNull(msgs.get(0).get("citations"));
    }

    /**
     * The ownership boundary the interceptor cannot enforce: /api/assistant/chats/{id}
     * is reachable by every signed-in role, so the check that it is *your* chat has
     * to happen here.
     */
    @Test
    void chatDetailIs404ForSomeoneElsesConversation() {
        when(assistantService.session(4L, SOMEONE_ELSE)).thenReturn(Optional.empty());

        ResponseEntity<?> r = assistant.chat(4L, session(SOMEONE_ELSE, "STUDENT"));

        assertEquals(HttpStatus.NOT_FOUND, r.getStatusCode());
        assertEquals("No such conversation.", body(r).get("error"));
        // Never fetches the messages of a chat the caller does not own.
        verify(assistantService, never()).messages(eq(4L), eq(SOMEONE_ELSE));
    }

    @Test
    void aMissingChatAndSomeoneElsesChatAreIndistinguishable() {
        when(assistantService.session(404L, ME)).thenReturn(Optional.empty());
        when(assistantService.session(4L, SOMEONE_ELSE)).thenReturn(Optional.empty());

        ResponseEntity<?> missing = assistant.chat(404L, session(ME, "STUDENT"));
        ResponseEntity<?> notMine = assistant.chat(4L, session(SOMEONE_ELSE, "STUDENT"));

        assertEquals(missing.getStatusCode(), notMine.getStatusCode());
        assertEquals(body(missing).get("error"), body(notMine).get("error"));
    }

    @Test
    void chatsIs401WithoutASession() {
        assertEquals(401, assistant.chats(session(null, null)).getStatusCode().value());
    }

    // ==================================================================
    // 6. admin reset + reports
    // ==================================================================

    @Test
    void resetPasswordDelegatesToTheServiceAndNeverEchoesThePassword() {
        when(adminService.resetPassword(4L, "a-new-password"))
                .thenReturn(new AdminService.Issued(null, 4L, null, null, null));

        ResponseEntity<?> r = admin.resetPassword(4L, new AdminApiController.ResetRequest("a-new-password"));

        assertEquals(HttpStatus.OK, r.getStatusCode());
        assertEquals(true, body(r).get("ok"));
        assertFalse(String.valueOf(body(r)).contains("a-new-password"),
                "the new password must not come back in the response");
        assertFalse(body(r).containsKey("activationCode"));
        verify(adminService).resetPassword(4L, "a-new-password");
    }

    @Test
    void resettingAPractitionerReturnsTheNewCodeOnce() {
        Instant expires = Instant.now().plusSeconds(7 * 86400);
        when(adminService.resetPassword(2L, null))
                .thenReturn(new AdminService.Issued(null, 2L, "DOC-0001", "735102", expires));

        ResponseEntity<?> r = admin.resetPassword(2L, null);

        assertEquals(HttpStatus.OK, r.getStatusCode());
        assertEquals("DOC-0001", body(r).get("loginId"));
        assertEquals("735102", body(r).get("activationCode"));
        assertEquals(expires, body(r).get("activationExpiresAt"));
    }

    @Test
    void resetPasswordSurfacesTheServicesRefusal() {
        when(adminService.resetPassword(eq(4L), any()))
                .thenReturn(new AdminService.Issued("The new password must be at least 8 characters.",
                        null, null, null, null));

        ResponseEntity<?> r = admin.resetPassword(4L, new AdminApiController.ResetRequest("short"));

        assertEquals(HttpStatus.BAD_REQUEST, r.getStatusCode());
        assertEquals("The new password must be at least 8 characters.", body(r).get("error"));
    }

    @Test
    void createUserReturnsTheLoginIdAndCodeOnce() {
        Instant expires = Instant.now().plusSeconds(7 * 86400);
        when(adminService.createUser("Dr. New", "new@x.in", "9000", "GSMC", "TN-9", "PRACTITIONER"))
                .thenReturn(new AdminService.Issued(null, 42L, "DOC-0002", "482913", expires));

        ResponseEntity<?> r = admin.createUser(new AdminApiController.CreateUserRequest(
                "Dr. New", "new@x.in", "9000", "GSMC", "TN-9", "PRACTITIONER"));

        assertEquals(HttpStatus.CREATED, r.getStatusCode());
        assertEquals(42L, body(r).get("userId"));
        assertEquals("DOC-0002", body(r).get("loginId"));
        assertEquals("482913", body(r).get("activationCode"));
        assertEquals(expires, body(r).get("activationExpiresAt"));
    }

    @Test
    void createUserSurfacesTheServicesRefusal() {
        when(adminService.createUser(any(), any(), any(), any(), any(), eq("ADMIN")))
                .thenReturn(new AdminService.Issued("Admins can create PRACTITIONER or STUDENT accounts only.",
                        null, null, null, null));

        ResponseEntity<?> r = admin.createUser(new AdminApiController.CreateUserRequest(
                "X", "x@x.in", null, null, null, "ADMIN"));

        assertEquals(HttpStatus.BAD_REQUEST, r.getStatusCode());
        assertFalse(body(r).containsKey("activationCode"));
        assertEquals(HttpStatus.BAD_REQUEST, admin.createUser(null).getStatusCode());
    }

    @Test
    @SuppressWarnings("unchecked")
    void theUserListShowsLoginIdsAndPendingActivation() {
        User doc = user(2L, "Dr. M", "PRACTITIONER");
        doc.setLoginId("DOC-0001");
        User pending = user(20L, "Dr. New", "PRACTITIONER");
        pending.setLoginId("DOC-0002");
        pending.setMustSetPassword(true);
        pending.setActivationExpiresAt(Instant.now().plusSeconds(3600));
        pending.setActivationCodeHash("$2a$10$secret");
        User expired = user(21L, "Dr. Late", "STUDENT");
        expired.setLoginId("STU-0002");
        expired.setMustSetPassword(true);
        expired.setActivationExpiresAt(Instant.now().minusSeconds(60));
        when(adminService.allUsers()).thenReturn(List.of(doc, pending, expired));
        when(adminService.creatableRoles()).thenReturn(List.of("PRACTITIONER", "STUDENT"));

        Map<String, Object> out = admin.users();
        List<Map<String, Object>> rows = (List<Map<String, Object>>) out.get("users");

        assertEquals("DOC-0001", rows.get(0).get("loginId"));
        assertEquals(false, rows.get(0).get("activationPending"));
        assertEquals(true, rows.get(1).get("activationPending"));
        assertEquals(false, rows.get(1).get("activationExpired"));
        assertEquals(true, rows.get(2).get("activationExpired"));
        assertFalse(String.valueOf(rows).contains("$2a$"), "no hash of any kind in the list");
        assertEquals(List.of("PRACTITIONER", "STUDENT"), out.get("roles"));
    }

    @Test
    void adminStatsCarryTheTwoRecentPanels() {
        SafetyCheck c = new SafetyCheck();
        c.setCheckId(1L); c.setFormulationName("Linga Chenthuram"); c.setRiskLevel("HIGH");
        DiagnosisSession d = new DiagnosisSession();
        d.setSessionId(2L); d.setDominantKutram("VATHAM");
        when(adminService.reportStats()).thenReturn(Map.of("userCount", 5));
        when(adminService.recentActivity()).thenReturn(List.of());
        when(checks.findAllByOrderByCreatedAtDesc(any())).thenReturn(List.of(c));
        when(diagnoses.findAllByOrderByCreatedAtDesc(any(Pageable.class))).thenReturn(List.of(d));

        Map<String, Object> out = admin.stats();

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rc = (List<Map<String, Object>>) out.get("recentChecks");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rd = (List<Map<String, Object>>) out.get("recentDiagnoses");
        assertEquals("HIGH", rc.get(0).get("riskLevel"));
        assertEquals("VATHAM", rd.get(0).get("dominantKutram"));
        // Paged at the database, never the unpaged overload.
        verify(diagnoses, never()).findAllByOrderByCreatedAtDesc();
    }

    @Test
    void formulationDetailCarriesItsIndicatedDiseases() {
        Formulation f = new Formulation();
        f.setFormId(5L); f.setNameEnglish("Ayya Parpam");
        Disease d = new Disease();
        d.setDiseaseId(2L); d.setNoiEnglish("Kalladaippu");
        when(formulations.findDetailById(5L)).thenReturn(Optional.of(f));
        when(contraindications.findByFormulation_FormId(5L)).thenReturn(List.of());
        when(diseases.findIndicatedFor(5L)).thenReturn(List.of(d));

        ResponseEntity<?> r = formulary.detail(5L);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> ind = (List<Map<String, Object>>) body(r).get("indications");
        assertEquals("Kalladaippu", ind.get(0).get("noiEnglish"));
        // Fetched by its own query, never by walking the lazy association.
        verify(diseases).findIndicatedFor(5L);
    }

    @Test
    void reportsCombinesStatsWithTheActivityFeed() {
        when(adminService.reportStats()).thenReturn(Map.of("userCount", 5, "formulationCount", 10));
        when(adminService.recentActivity()).thenReturn(List.of());

        Map<String, Object> out = admin.reports();

        assertEquals(5, out.get("userCount"));
        assertEquals(10, out.get("formulationCount"));
        assertTrue(out.containsKey("recentActivity"));
    }

    // ==================================================================
    // 7. formulary ingredients + diseases
    // ==================================================================

    @Test
    void ingredientsEndpointReturnsEveryIngredient() {
        Ingredient i = new Ingredient();
        i.setIngredientId(1L);
        i.setNameEnglish("Turmeric");
        i.setHeavyMetal(false);
        when(ingredients.findAllByOrderByNameEnglishAsc()).thenReturn(List.of(i));

        Map<String, Object> out = formulary.ingredients();

        assertEquals(1, out.get("total"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) out.get("ingredients");
        assertEquals("Turmeric", rows.get(0).get("nameEnglish"));
        assertEquals(false, rows.get(0).get("heavyMetal"));
    }

    @Test
    void diseasesEndpointCarriesAPreparationCountPerDisease() {
        Disease a = new Disease(); a.setDiseaseId(2L); a.setNoiEnglish("Kalladaippu");
        Disease b = new Disease(); b.setDiseaseId(3L); b.setNoiEnglish("Neeradaippu");
        when(diseases.findAllByOrderByNoiEnglishAsc()).thenReturn(List.of(a, b));
        // Only disease 2 has indicated preparations; 3 is absent from the grouped
        // result, which must read as zero rather than as a missing field.
        when(diseases.countFormulationsPerDisease())
                // Explicit witness: List.of(Object[]) spreads into varargs and infers
                // List<Object>, which does not match List<Object[]>.
                .thenReturn(List.<Object[]>of(new Object[]{2L, 4L}));

        Map<String, Object> out = formulary.diseases();

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) out.get("diseases");
        assertEquals(4L, rows.get(0).get("preparationCount"));
        assertEquals(0L, rows.get(1).get("preparationCount"),
                "a disease with no indicated preparation must report 0, not null");
    }

    /** The count must cost one grouped query, not one per disease. */
    @Test
    void theDiseaseListDoesNotIssueAQueryPerDisease() {
        when(diseases.findAllByOrderByNoiEnglishAsc())
                .thenReturn(List.of(new Disease(), new Disease(), new Disease()));
        when(diseases.countFormulationsPerDisease()).thenReturn(List.of());

        formulary.diseases();

        verify(diseases, times(1)).countFormulationsPerDisease();
        verify(formulations, never()).findByDiseaseId(any());
    }

    @Test
    void diseaseDetailCarriesTheSourceCitationOnEachPreparation() {
        Disease d = new Disease(); d.setDiseaseId(2L); d.setNoiEnglish("Kalladaippu");
        Formulation f = new Formulation();
        f.setFormId(10L);
        f.setNameEnglish("Thiripala Churanam");
        f.setSfiCode("SFI-S-004");
        f.setSourceBook("Siddha TERM-1 SFI Preparations");
        f.setPageNo(42);
        when(diseases.findById(2L)).thenReturn(Optional.of(d));
        when(formulations.findByDiseaseId(2L)).thenReturn(List.of(f));

        ResponseEntity<?> r = formulary.disease(2L);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> forms = (List<Map<String, Object>>) body(r).get("formulations");
        assertEquals("Siddha TERM-1 SFI Preparations", forms.get(0).get("sourceBook"));
        assertEquals(42, forms.get(0).get("pageNo"));
        // still carries the list fields
        assertEquals("SFI-S-004", forms.get(0).get("sfiCode"));
    }

    @Test
    void diseasesEndpointReturnsEveryDisease() {
        Disease d = new Disease();
        d.setDiseaseId(2L);
        d.setNoiEnglish("Kalladaippu");
        d.setMukkutramType("VATHAM");
        when(diseases.findAllByOrderByNoiEnglishAsc()).thenReturn(List.of(d));
        when(diseases.countFormulationsPerDisease()).thenReturn(List.of());

        Map<String, Object> out = formulary.diseases();

        assertEquals(1, out.get("total"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) out.get("diseases");
        assertEquals("Kalladaippu", rows.get(0).get("noiEnglish"));
    }

    @Test
    void diseaseDetailReturnsTheDiseaseAndItsFormulations() {
        Disease d = new Disease();
        d.setDiseaseId(2L);
        d.setNoiEnglish("Kalladaippu");
        d.setDescription("Urinary calculi");
        when(diseases.findById(2L)).thenReturn(Optional.of(d));
        when(formulations.findByDiseaseId(2L)).thenReturn(List.of());

        ResponseEntity<?> r = formulary.disease(2L);

        assertEquals(HttpStatus.OK, r.getStatusCode());
        assertEquals("Kalladaippu", body(r).get("noiEnglish"));
        assertEquals("Urinary calculi", body(r).get("description"));
        assertTrue(body(r).containsKey("formulations"));
    }

    @Test
    void diseaseDetailIs404ForAnUnknownId() {
        when(diseases.findById(404L)).thenReturn(Optional.empty());

        ResponseEntity<?> r = formulary.disease(404L);

        assertEquals(HttpStatus.NOT_FOUND, r.getStatusCode());
    }
}
