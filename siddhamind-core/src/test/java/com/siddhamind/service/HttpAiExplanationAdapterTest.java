package com.siddhamind.service;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.siddhamind.config.AiProperties;
import com.siddhamind.dto.DiagnosisScores;
import com.siddhamind.dto.Finding;
import com.siddhamind.dto.SafetyVerdict;
import com.siddhamind.entity.Disease;
import com.siddhamind.entity.Formulation;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.net.ServerSocket;
import java.net.SocketTimeoutException;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * Resilience of the explanation adapter under real HTTP conditions.
 *
 * <p>The contract this proves: whatever the AI service does - hang, 500, 401,
 * return nonsense - {@code explainSafety} returns {@link Optional#empty()} and
 * never throws. SafetyService and DiagnosisService already have tests showing a
 * verdict survives an empty explanation; those tests use a stub port. These
 * ones show the real adapter actually produces empty rather than an exception,
 * which is the assumption those tests rest on.
 */
class HttpAiExplanationAdapterTest {

    private RestClient.Builder builder;
    private MockRestServiceServer server;
    private HttpAiExplanationAdapter adapter;
    private ListAppender<ILoggingEvent> logs;
    private ch.qos.logback.classic.Logger supportLogger;

    private static final SafetyVerdict VERDICT = new SafetyVerdict(
            "Thiripala Chooranam",
            "MAJOR",
            List.of(new Finding("Warfarin", "INTERACTION", "MAJOR",
                    "Increases bleeding risk", "Monitor INR")),
            List.of("aspirin"),
            1, 0, 0, 30.0);

    @BeforeEach
    void setUp() {
        AiProperties props = new AiProperties();
        props.setBaseUrl("http://ai.test");
        props.setInternalToken("test-token");
        props.setTimeoutSeconds(5);

        // Built through the real configuration, not a bare RestClient.builder():
        // the bearer header and the timeouts are set there, so a hand-rolled
        // builder would test an adapter that never sends credentials and would
        // not notice if AiClientConfig stopped attaching them.
        builder = new com.siddhamind.config.AiClientConfig().aiRestClientBuilder(props);
        server = MockRestServiceServer.bindTo(builder).build();
        adapter = new HttpAiExplanationAdapter(builder, props);

        supportLogger = (ch.qos.logback.classic.Logger) LoggerFactory.getLogger(AiCallSupport.class);
        logs = new ListAppender<>();
        logs.start();
        supportLogger.addAppender(logs);
    }

    @AfterEach
    void tearDown() {
        supportLogger.detachAppender(logs);
    }

    private String logText() {
        return logs.list.stream().map(ILoggingEvent::getFormattedMessage)
                .reduce("", (a, b) -> a + "\n" + b);
    }

    private boolean loggedAt(Level level) {
        return logs.list.stream().anyMatch(e -> e.getLevel() == level);
    }

    // ------------------------------------------------------------------
    // happy path
    // ------------------------------------------------------------------

    @Test
    void returnsThePhrasingOnSuccess() {
        server.expect(requestTo("http://ai.test/explain/safety"))
                .andExpect(method(org.springframework.http.HttpMethod.POST))
                .andExpect(header("Authorization", "Bearer test-token"))
                .andRespond(withSuccess("{\"explanation\":\"Major interaction with warfarin.\"}",
                        MediaType.APPLICATION_JSON));

        Optional<String> result = adapter.explainSafety(VERDICT);

        assertTrue(result.isPresent());
        assertEquals("Major interaction with warfarin.", result.get());
        server.verify();
    }

    @Test
    void sendsTheVerdictFieldsTheAiServiceExpects() {
        server.expect(requestTo("http://ai.test/explain/safety"))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("\"riskLevel\":\"MAJOR\"")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("\"heavyMetalDailyLimitMg\":30.0")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("\"unmatchedDrugs\":[\"aspirin\"]")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("\"severity\":\"MAJOR\"")))
                .andRespond(withSuccess("{\"explanation\":\"ok\"}", MediaType.APPLICATION_JSON));

        adapter.explainSafety(VERDICT);
        server.verify();
    }

    @Test
    void flattensEntitiesToNamesForDiagnosis() {
        Disease disease = new Disease();
        disease.setNoiEnglish("Vatha Suram");
        Formulation formulation = new Formulation();
        formulation.setNameEnglish("Nilavembu Kudineer");

        DiagnosisScores scores = new DiagnosisScores(
                6, 2, 1, "VATHAM", "Vatha Suram", List.of(disease), List.of(formulation));

        server.expect(requestTo("http://ai.test/explain/diagnosis"))
                // Names, not serialised entities. Sending the entities would walk
                // every lazy association and throw with open-in-view disabled.
                .andExpect(content().string(org.hamcrest.Matchers.containsString(
                        "\"candidateDiseases\":[\"Vatha Suram\"]")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString(
                        "\"suggestedFormulations\":[\"Nilavembu Kudineer\"]")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("\"inconclusive\":false")))
                .andRespond(withSuccess("{\"explanation\":\"Vatham dominant.\"}",
                        MediaType.APPLICATION_JSON));

        assertEquals("Vatham dominant.", adapter.explainDiagnosis(scores, "age 54").orElseThrow());
        server.verify();
    }

    // ------------------------------------------------------------------
    // failure modes - every one must yield empty, never an exception
    // ------------------------------------------------------------------

    @Test
    void serverErrorYieldsEmpty() {
        server.expect(requestTo("http://ai.test/explain/safety"))
                .andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR)
                        .body("{\"detail\":\"generation failed\"}")
                        .contentType(MediaType.APPLICATION_JSON));

        assertTrue(adapter.explainSafety(VERDICT).isEmpty());
        assertTrue(loggedAt(Level.WARN), "an AI outage is a WARN, not an ERROR");
        assertFalse(loggedAt(Level.ERROR), "an AI outage is not a Java-side defect");
    }

    @Test
    void unauthorizedYieldsEmptyAndNamesTheTokenProblem() {
        server.expect(requestTo("http://ai.test/explain/safety"))
                .andRespond(withStatus(HttpStatus.UNAUTHORIZED)
                        .body("{\"detail\":\"Invalid internal token.\"}")
                        .contentType(MediaType.APPLICATION_JSON));

        assertTrue(adapter.explainSafety(VERDICT).isEmpty());

        String text = logText();
        // A 401 is a configuration fault that never self-heals, and it is
        // invisible from the UI: explanations just stop appearing. The log has to
        // say so, not just report "a failure".
        assertTrue(text.contains("INTERNAL_API_TOKEN"),
                "the 401 log should name the token, got: " + text);
        assertTrue(text.contains("token"), "should describe it as an auth problem");
        assertTrue(loggedAt(Level.WARN));
    }

    @Test
    void forbiddenIsTreatedAsAnAuthProblemToo() {
        server.expect(requestTo("http://ai.test/explain/safety"))
                .andRespond(withStatus(HttpStatus.FORBIDDEN));

        assertTrue(adapter.explainSafety(VERDICT).isEmpty());
        assertTrue(logText().contains("INTERNAL_API_TOKEN"));
    }

    @Test
    void malformedJsonYieldsEmpty() {
        server.expect(requestTo("http://ai.test/explain/safety"))
                .andRespond(withSuccess("{ this is not json", MediaType.APPLICATION_JSON));

        assertTrue(adapter.explainSafety(VERDICT).isEmpty());
        assertTrue(loggedAt(Level.WARN));
    }

    @Test
    void unexpectedJsonShapeYieldsEmpty() {
        // Decodes without throwing - explanation is simply absent. If this were
        // not filtered the UI would show an empty explanation bubble, which reads
        // as "the AI had nothing to say" rather than as a fault.
        server.expect(requestTo("http://ai.test/explain/safety"))
                .andRespond(withSuccess("{\"unexpected\":\"shape\"}", MediaType.APPLICATION_JSON));

        assertTrue(adapter.explainSafety(VERDICT).isEmpty());
    }

    @Test
    void nullExplanationYieldsEmpty() {
        server.expect(requestTo("http://ai.test/explain/safety"))
                .andRespond(withSuccess("{\"explanation\":null}", MediaType.APPLICATION_JSON));

        assertTrue(adapter.explainSafety(VERDICT).isEmpty());
    }

    @Test
    void blankExplanationYieldsEmpty() {
        server.expect(requestTo("http://ai.test/explain/safety"))
                .andRespond(withSuccess("{\"explanation\":\"   \"}", MediaType.APPLICATION_JSON));

        assertTrue(adapter.explainSafety(VERDICT).isEmpty());
    }

    @Test
    void nonJsonContentTypeYieldsEmpty() {
        server.expect(requestTo("http://ai.test/explain/safety"))
                .andRespond(withSuccess("<html>502 Bad Gateway</html>", MediaType.TEXT_HTML));

        assertTrue(adapter.explainSafety(VERDICT).isEmpty());
    }

    @Test
    void ioFailureYieldsEmpty() {
        server.expect(requestTo("http://ai.test/explain/safety"))
                .andRespond(withException(new SocketTimeoutException("Read timed out")));

        assertTrue(adapter.explainSafety(VERDICT).isEmpty());
        assertTrue(loggedAt(Level.WARN));
    }

    @Test
    void connectionRefusedYieldsEmpty() {
        server.expect(requestTo("http://ai.test/explain/safety"))
                .andRespond(withException(new IOException("Connection refused")));

        assertTrue(adapter.explainSafety(VERDICT).isEmpty());
    }

    @Test
    void nullVerdictYieldsEmptyWithoutCallingTheService() {
        assertTrue(adapter.explainSafety(null).isEmpty());
        assertTrue(adapter.explainDiagnosis(null, "context").isEmpty());
        server.verify();  // no request was expected, and none was made
    }

    // ------------------------------------------------------------------
    // the timeout is real, not just configured
    // ------------------------------------------------------------------

    @Test
    void hangingServerIsAbandonedAtTheConfiguredTimeout() throws Exception {
        // MockRestServiceServer cannot prove this: it never opens a socket, so a
        // simulated SocketTimeoutException would pass even if the read timeout
        // were left at the JDK default of infinite. This uses a real socket that
        // accepts the connection and then says nothing.
        try (ServerSocket socket = new ServerSocket(0)) {
            AiProperties props = new AiProperties();
            props.setBaseUrl("http://localhost:" + socket.getLocalPort());
            props.setInternalToken("test-token");
            props.setTimeoutSeconds(1);

            Thread accepter = new Thread(() -> {
                try (var ignored = socket.accept()) {
                    Thread.sleep(30_000);
                } catch (Exception ignored) {
                    // socket closed by the test, or interrupted - both fine
                }
            });
            accepter.setDaemon(true);
            accepter.start();

            HttpAiExplanationAdapter real = new HttpAiExplanationAdapter(
                    new com.siddhamind.config.AiClientConfig()
                            .aiRestClientBuilder(props), props);

            long start = System.currentTimeMillis();
            Optional<String> result = real.explainSafety(VERDICT);
            long elapsed = System.currentTimeMillis() - start;

            assertTrue(result.isEmpty(), "a hanging AI service must not produce a value");
            assertTrue(elapsed < 15_000,
                    "should give up near the 1s timeout, took " + elapsed + "ms - "
                            + "the read timeout is probably not being applied");
        }
    }

    // ------------------------------------------------------------------
    // availability
    // ------------------------------------------------------------------

    /**
     * Configured AND reachable. {@code isAvailable()} used to return
     * {@code props.isConfigured()} alone, so it could not tell these two apart -
     * which is what let the admin dashboard print "Gemini API is connected"
     * while every explanation call was failing.
     */
    @Test
    void reportsAvailableWhenConfiguredAndTheServiceAnswers() {
        server.expect(requestTo("http://ai.test/health"))
                .andExpect(method(org.springframework.http.HttpMethod.GET))
                .andRespond(withSuccess("{\"status\":\"UP\"}", MediaType.APPLICATION_JSON));

        assertTrue(adapter.isAvailable());
        server.verify();
    }

    /** Configured but NOT reachable: the case the old implementation got wrong. */
    @Test
    void reportsUnavailableWhenConfiguredButTheServiceIsDown() {
        server.expect(requestTo("http://ai.test/health"))
                .andExpect(method(org.springframework.http.HttpMethod.GET))
                .andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));

        assertFalse(adapter.isAvailable());
        server.verify();
    }

    /** The probe is cached, so a dashboard poll does not hit the service every time. */
    @Test
    void theLivenessProbeIsCachedAcrossCalls() {
        server.expect(requestTo("http://ai.test/health"))
                .andExpect(method(org.springframework.http.HttpMethod.GET))
                .andRespond(withSuccess("{\"status\":\"UP\"}", MediaType.APPLICATION_JSON));

        assertTrue(adapter.isAvailable());
        // A second call inside the TTL must not produce a second request. The mock
        // server has exactly one expectation, so a repeat call would fail verify().
        assertTrue(adapter.isAvailable());
        assertTrue(adapter.isAvailable());
        server.verify();
    }

    @Test
    void reportsUnavailableWhenBaseUrlIsBlank() {
        AiProperties blank = new AiProperties();
        blank.setBaseUrl("  ");
        assertFalse(new HttpAiExplanationAdapter(RestClient.builder(), blank).isAvailable());
    }
}
