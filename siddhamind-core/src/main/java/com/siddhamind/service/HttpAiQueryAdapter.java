package com.siddhamind.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.siddhamind.config.AiProperties;
import com.siddhamind.dto.RagAnswer;
import com.siddhamind.dto.RagCitation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Calls siddhamind-ai's {@code POST /query} and maps the result.
 *
 * <p>Registered only when {@code siddhamind.ai.base-url} is set; the assistant
 * feature reports itself unavailable otherwise, which is honest - there is no
 * local fallback for retrieval, unlike safety and diagnosis where the
 * deterministic engine is the real product.
 */
@Component
@ConditionalOnExpression("!'${siddhamind.ai.base-url:}'.isBlank()")
public class HttpAiQueryAdapter implements AiQueryPort {

    private static final Logger log = LoggerFactory.getLogger(HttpAiQueryAdapter.class);

    /** How long a liveness result is trusted before the service is probed again. */
    private static final long PROBE_TTL_MILLIS = 15_000L;

    /** Longest a caller of {@link #isAvailable()} will wait for a probe. */
    private static final long PROBE_TIMEOUT_SECONDS = 3L;

    private final RestClient client;
    private final AiProperties props;

    /**
     * Runs the probe off the caller's thread so a hung AI service cannot hold a
     * Tomcat worker. Daemon, so it never keeps the JVM alive at shutdown.
     */
    private final ExecutorService probePool = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "ai-liveness-probe");
        t.setDaemon(true);
        return t;
    });

    private final AtomicBoolean probeInFlight = new AtomicBoolean();
    private volatile long probedAtMillis;
    private volatile boolean lastProbeOk;

    public HttpAiQueryAdapter(RestClient.Builder builder, AiProperties props) {
        this.client = builder.baseUrl(props.getBaseUrl()).build();
        this.props = props;
    }

    /**
     * The wire shape of the Python response.
     *
     * <p>{@code @JsonIgnoreProperties} is explicit rather than relying on Spring
     * Boot's default: {@code reason} and {@code diagnostics} were added to the
     * Python contract after it was first agreed, and more fields may follow. An
     * additive change on the AI side must never break Java.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record QueryResponse(
            String answer,
            List<Citation> citations,
            Boolean notFoundInCorpus,
            Integer retrievalCount,
            String reason) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Citation(
            Integer passageNo,
            Long chunkId,
            Long sourceDocumentId,
            String bookName,
            Integer pageNo,
            String verseNo,
            Integer chunkIndex,
            String snippet,
            Double score) {}

    @Override
    public RagAnswer ask(String question, List<String> bookNames, List<Long> documentIds) {
        if (question == null || question.isBlank()) {
            return RagAnswer.unavailable("question was empty");
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("question", question.strip());
        if (bookNames != null && !bookNames.isEmpty()) {
            body.put("book_names", bookNames);
        }
        if (documentIds != null && !documentIds.isEmpty()) {
            body.put("source_document_ids", documentIds);
        }

        Optional<QueryResponse> response = AiCallSupport.guard("query", () ->
                client.post()
                        .uri("/query")
                        .body(body)
                        .retrieve()
                        .body(QueryResponse.class));

        if (response.isEmpty()) {
            return RagAnswer.unavailable("the AI service could not be reached");
        }

        QueryResponse r = response.get();
        if (r.answer() == null || r.answer().isBlank()) {
            // A 200 that decodes cleanly but carries no answer. Presenting an
            // empty bubble would read as "the corpus said nothing", which is a
            // claim about the corpus rather than about the response.
            log.warn("AI query returned a response with no answer text");
            return RagAnswer.unavailable("the AI service returned an empty answer");
        }

        boolean notFound = Boolean.TRUE.equals(r.notFoundInCorpus());
        List<RagCitation> citations = r.citations() == null ? List.of()
                : r.citations().stream()
                        .filter(c -> c != null && c.chunkId() != null)
                        .map(c -> new RagCitation(
                                c.passageNo(), c.chunkId(), c.sourceDocumentId(),
                                c.bookName(), c.pageNo(), c.verseNo(),
                                c.chunkIndex(), c.snippet(), c.score()))
                        .toList();

        return new RagAnswer(
                r.answer(),
                citations,
                notFound,
                r.retrievalCount() == null ? 0 : r.retrievalCount(),
                r.reason(),
                false);
    }

    /**
     * Whether the assistant can actually answer right now.
     *
     * <p>Configured is not the same as reachable. This previously returned
     * {@code props.isConfigured()}, so {@code /api/assistant/status} reported
     * {@code aiAvailable: true} whenever a base-url was set - including when
     * nothing was listening on it - and the admin dashboard told practitioners
     * the assistant was connected while every question was failing.
     *
     * <p>The result is cached for {@value #PROBE_TTL_MILLIS}ms. This backs a
     * status indicator a dashboard polls, not a per-request gate, so a slightly
     * stale answer is fine and hammering the AI service is not.
     *
     * <p>{@link #ask} is deliberately unchanged: it already degrades to
     * {@link RagAnswer#unavailable} on its own and must not depend on this.
     */
    @Override
    public boolean isAvailable() {
        return props.isConfigured() && probeWithinTtl();
    }

    private boolean probeWithinTtl() {
        long probedAt = probedAtMillis;
        if (probedAt != 0L && System.currentTimeMillis() - probedAt < PROBE_TTL_MILLIS) {
            return lastProbeOk;
        }
        return refreshProbe();
    }

    private boolean refreshProbe() {
        if (!probeInFlight.compareAndSet(false, true)) {
            // Another request is already probing. Answering from the last known
            // result beats queueing behind it on the single probe thread.
            return lastProbeOk;
        }

        CompletableFuture<Boolean> task = CompletableFuture.supplyAsync(this::pingHealth, probePool);
        // Cleared when the real call finishes, not when the wait below gives up:
        // against a hung service the thread stays busy, and starting a second
        // probe on top of it would only deepen the queue.
        task.whenComplete((ok, error) -> {
            lastProbeOk = Boolean.TRUE.equals(ok);
            probedAtMillis = System.currentTimeMillis();
            probeInFlight.set(false);
        });

        try {
            // get(timeout) stops waiting without cancelling the task, so a slow
            // probe still records its result for the next caller.
            return task.get(PROBE_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            log.debug("AI liveness probe exceeded {}s", PROBE_TIMEOUT_SECONDS);
            return false;
        } catch (ExecutionException e) {
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    /**
     * siddhamind-ai's {@code GET /health}: unauthenticated by design so probes and
     * container healthchecks can reach it, and cheap enough to poll.
     */
    private boolean pingHealth() {
        try {
            return client.get()
                    .uri("/health")
                    .retrieve()
                    .toBodilessEntity()
                    .getStatusCode()
                    .is2xxSuccessful();
        } catch (RuntimeException e) {
            // A failed probe is this method's answer, not an incident, so it is
            // logged at DEBUG rather than routed through AiCallSupport - which
            // logs at WARN, and would emit one every TTL while the service is down.
            log.debug("AI liveness probe failed: {}", e.toString());
            return false;
        }
    }
}
