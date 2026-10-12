package com.siddhamind.service;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.siddhamind.config.AiClientConfig;
import com.siddhamind.config.AiProperties;
import com.siddhamind.dto.RagAnswer;
import com.siddhamind.dto.RagCitation;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/** Mapping and resilience of the {@code /query} adapter. */
class HttpAiQueryAdapterTest {

    private MockRestServiceServer server;
    private HttpAiQueryAdapter adapter;
    private ListAppender<ILoggingEvent> logs;
    private ch.qos.logback.classic.Logger supportLogger;

    /** A realistic response, including the two fields added after the contract was agreed. */
    private static final String FULL_RESPONSE = """
            {
              "answer": "Thiripala Chooranam contains Kadukkai 35 g, Thandrikkai 35 g and Nellikkai 35 g [1].",
              "citations": [
                {"passageNo": 1, "chunkId": 42, "sourceDocumentId": 7,
                 "bookName": "Synthetic Test Document", "pageNo": 1, "verseNo": "101",
                 "chunkIndex": 1, "snippet": "101. Thiripala Chooranam...", "score": 0.0328}
              ],
              "notFoundInCorpus": false,
              "retrievalCount": 6,
              "reason": "top similarity 0.812 at or above the 0.35 floor",
              "diagnostics": {"tsquery": "ingredients | thiripala | chooranam"}
            }
            """;

    @BeforeEach
    void setUp() {
        AiProperties props = new AiProperties();
        props.setBaseUrl("http://ai.test");
        props.setInternalToken("test-token");
        props.setTimeoutSeconds(5);

        RestClient.Builder builder = new AiClientConfig().aiRestClientBuilder(props);
        server = MockRestServiceServer.bindTo(builder).build();
        adapter = new HttpAiQueryAdapter(builder, props);

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

    // ------------------------------------------------------------------
    // mapping
    // ------------------------------------------------------------------

    @Test
    void mapsAGroundedAnswerWithItsCitations() {
        server.expect(requestTo("http://ai.test/query"))
                .andExpect(header("Authorization", "Bearer test-token"))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("\"question\"")))
                .andRespond(withSuccess(FULL_RESPONSE, MediaType.APPLICATION_JSON));

        RagAnswer answer = adapter.ask("What are the ingredients of Thiripala Chooranam?");

        assertFalse(answer.serviceUnavailable());
        assertFalse(answer.notFoundInCorpus());
        assertTrue(answer.isGrounded());
        assertEquals(6, answer.retrievalCount());
        assertTrue(answer.answer().contains("Kadukkai"));

        assertEquals(1, answer.citations().size());
        RagCitation c = answer.citations().get(0);
        assertEquals(1, c.passageNo());
        assertEquals(42L, c.chunkId());
        assertEquals(7L, c.sourceDocumentId());
        assertEquals("Synthetic Test Document", c.bookName());
        assertEquals(1, c.pageNo());
        assertEquals("101", c.verseNo());
        assertEquals(1, c.chunkIndex());
        assertEquals(0.0328, c.score(), 1e-9);
        assertEquals("Synthetic Test Document, p.1, v.101", c.label());
        server.verify();
    }

    @Test
    void ignoresFieldsAddedToThePythonContractLater() {
        // 'reason' and 'diagnostics' were added after the contract was first
        // agreed. An additive change on the AI side must never break Java.
        server.expect(requestTo("http://ai.test/query"))
                .andRespond(withSuccess("""
                        {"answer":"x","citations":[],"notFoundInCorpus":false,
                         "retrievalCount":1,"reason":"why","diagnostics":{"a":1},
                         "somethingAddedInPhase9":{"nested":[1,2,3]}}
                        """, MediaType.APPLICATION_JSON));

        RagAnswer answer = adapter.ask("q");
        assertFalse(answer.serviceUnavailable());
        assertEquals("why", answer.reason());
    }

    @Test
    void passesFiltersWhenSupplied() {
        server.expect(requestTo("http://ai.test/query"))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("\"book_names\":[\"Book A\"]")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("\"source_document_ids\":[7]")))
                .andRespond(withSuccess(FULL_RESPONSE, MediaType.APPLICATION_JSON));

        adapter.ask("q", List.of("Book A"), List.of(7L));
        server.verify();
    }

    @Test
    void omitsEmptyFiltersRatherThanSendingEmptyArrays() {
        server.expect(requestTo("http://ai.test/query"))
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("book_names"))))
                .andRespond(withSuccess(FULL_RESPONSE, MediaType.APPLICATION_JSON));

        adapter.ask("q", List.of(), List.of());
        server.verify();
    }

    // ------------------------------------------------------------------
    // not found in corpus - a success, not a failure
    // ------------------------------------------------------------------

    @Test
    void notFoundInCorpusIsAnAnswerNotAnOutage() {
        server.expect(requestTo("http://ai.test/query"))
                .andRespond(withSuccess("""
                        {"answer":"That is not covered by the indexed corpus.",
                         "citations":[],"notFoundInCorpus":true,"retrievalCount":6,
                         "reason":"no exact-term match and top similarity 0.11 is below the 0.35 floor"}
                        """, MediaType.APPLICATION_JSON));

        RagAnswer answer = adapter.ask("What is the tyre pressure of a Boeing 737?");

        assertTrue(answer.notFoundInCorpus());
        assertFalse(answer.serviceUnavailable(), "a refusal is not an outage");
        assertFalse(answer.isGrounded());
        assertTrue(answer.citations().isEmpty());
        assertEquals(6, answer.retrievalCount());
    }

    // ------------------------------------------------------------------
    // failure modes
    // ------------------------------------------------------------------

    @Test
    void serverErrorBecomesUnavailable() {
        server.expect(requestTo("http://ai.test/query"))
                .andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR));

        RagAnswer answer = adapter.ask("q");
        assertTrue(answer.serviceUnavailable());
        assertFalse(answer.notFoundInCorpus(), "an outage must not be recorded as a corpus gap");
        assertTrue(answer.answer().contains("temporarily unavailable"));
    }

    @Test
    void badGatewayFromGenerationBecomesUnavailable() {
        // What /query returns when Gemini itself failed - e.g. the daily free-tier
        // quota is exhausted.
        server.expect(requestTo("http://ai.test/query"))
                .andRespond(withStatus(HttpStatus.BAD_GATEWAY)
                        .body("{\"detail\":\"generation failed: RESOURCE_EXHAUSTED\"}")
                        .contentType(MediaType.APPLICATION_JSON));

        assertTrue(adapter.ask("q").serviceUnavailable());
        assertTrue(logText().contains("502"));
    }

    @Test
    void unauthorizedBecomesUnavailableAndNamesTheToken() {
        server.expect(requestTo("http://ai.test/query"))
                .andRespond(withStatus(HttpStatus.UNAUTHORIZED));

        assertTrue(adapter.ask("q").serviceUnavailable());
        assertTrue(logText().contains("INTERNAL_API_TOKEN"));
        assertTrue(logs.list.stream().anyMatch(e -> e.getLevel() == Level.WARN));
    }

    @Test
    void malformedJsonBecomesUnavailable() {
        server.expect(requestTo("http://ai.test/query"))
                .andRespond(withSuccess("{oops", MediaType.APPLICATION_JSON));

        assertTrue(adapter.ask("q").serviceUnavailable());
    }

    @Test
    void timeoutBecomesUnavailable() {
        server.expect(requestTo("http://ai.test/query"))
                .andRespond(withException(new SocketTimeoutException("Read timed out")));

        assertTrue(adapter.ask("q").serviceUnavailable());
    }

    @Test
    void connectionRefusedBecomesUnavailable() {
        server.expect(requestTo("http://ai.test/query"))
                .andRespond(withException(new IOException("Connection refused")));

        assertTrue(adapter.ask("q").serviceUnavailable());
    }

    @Test
    void emptyAnswerBecomesUnavailableRatherThanAnEmptyBubble() {
        // A 200 that decodes cleanly but says nothing. Showing it as an answer
        // would be a claim about the corpus that the response never made.
        server.expect(requestTo("http://ai.test/query"))
                .andRespond(withSuccess("{\"answer\":\"\",\"citations\":[],\"notFoundInCorpus\":false}",
                        MediaType.APPLICATION_JSON));

        RagAnswer answer = adapter.ask("q");
        assertTrue(answer.serviceUnavailable());
    }

    @Test
    void missingAnswerFieldBecomesUnavailable() {
        server.expect(requestTo("http://ai.test/query"))
                .andRespond(withSuccess("{\"citations\":[]}", MediaType.APPLICATION_JSON));

        assertTrue(adapter.ask("q").serviceUnavailable());
    }

    @Test
    void citationsWithoutAChunkIdAreDropped() {
        // chunk_id is the only field that ties a citation back to a real passage.
        // Persisting one without it would create a source reference pointing at
        // nothing, which is worse than showing one citation fewer.
        server.expect(requestTo("http://ai.test/query"))
                .andRespond(withSuccess("""
                        {"answer":"a","notFoundInCorpus":false,"retrievalCount":2,
                         "citations":[{"passageNo":1,"chunkId":null,"snippet":"x","score":0.1},
                                      {"passageNo":2,"chunkId":9,"snippet":"y","score":0.2}]}
                        """, MediaType.APPLICATION_JSON));

        RagAnswer answer = adapter.ask("q");
        assertEquals(1, answer.citations().size());
        assertEquals(9L, answer.citations().get(0).chunkId());
    }

    @Test
    void nullCitationListIsTreatedAsEmpty() {
        server.expect(requestTo("http://ai.test/query"))
                .andRespond(withSuccess("{\"answer\":\"a\",\"citations\":null}",
                        MediaType.APPLICATION_JSON));

        RagAnswer answer = adapter.ask("q");
        assertFalse(answer.serviceUnavailable());
        assertNotNull(answer.citations());
        assertTrue(answer.citations().isEmpty());
    }

    @Test
    void blankQuestionShortCircuitsWithoutCallingTheService() {
        assertTrue(adapter.ask("   ").serviceUnavailable());
        assertTrue(adapter.ask(null).serviceUnavailable());
        server.verify();  // no requests expected, none made
    }

    @Test
    void citationLabelDegradesWhenMetadataIsMissing() {
        RagCitation bare = new RagCitation(1, 1L, null, null, null, null, null, "s", 0.1);
        assertEquals("Unknown source", bare.label());
    }
}
