package com.siddhamind.service;

import com.siddhamind.config.AiProperties;
import com.siddhamind.dto.DiagnosisScores;
import com.siddhamind.dto.Finding;
import com.siddhamind.dto.SafetyVerdict;
import com.siddhamind.entity.Disease;
import com.siddhamind.entity.Formulation;
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
 * Real {@link AiExplanationPort}: phrases a verdict by calling siddhamind-ai.
 *
 * <p>Registered only when {@code siddhamind.ai.base-url} is non-blank, so with
 * {@code AI_SERVICE_URL} unset {@link NoOpAiExplanationAdapter} stays in place
 * through {@code @ConditionalOnMissingBean} and every deterministic feature
 * works exactly as before.
 *
 * <p>Both methods return {@link Optional#empty()} on any failure - see
 * {@link AiCallSupport}. The verdict was computed before this class was called
 * and is unaffected by whatever happens here.
 */
@Component
@ConditionalOnExpression("!'${siddhamind.ai.base-url:}'.isBlank()")
public class HttpAiExplanationAdapter implements AiExplanationPort {

    private static final Logger log = LoggerFactory.getLogger(HttpAiExplanationAdapter.class);

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
        Thread t = new Thread(r, "ai-explanation-liveness-probe");
        t.setDaemon(true);
        return t;
    });

    private final AtomicBoolean probeInFlight = new AtomicBoolean();
    private volatile long probedAtMillis;
    private volatile boolean lastProbeOk;

    public HttpAiExplanationAdapter(RestClient.Builder builder, AiProperties props) {
        this.client = builder.baseUrl(props.getBaseUrl()).build();
        this.props = props;
    }

    /** The AI service's response surface: one string, so no verdict can travel back. */
    record ExplanationResponse(String explanation) {}

    @Override
    public Optional<String> explainSafety(SafetyVerdict verdict) {
        if (verdict == null) {
            return Optional.empty();
        }
        return AiCallSupport.guard("safety explanation", () ->
                        client.post()
                                .uri("/explain/safety")
                                .body(safetyPayload(verdict))
                                .retrieve()
                                .body(ExplanationResponse.class))
                .map(ExplanationResponse::explanation)
                .filter(text -> text != null && !text.isBlank());
        // The filter is not defensive noise. A 200 carrying {"explanation": null}
        // decodes without throwing, and an empty bubble in the UI reads as "the
        // AI had nothing to say about this verdict" rather than as a fault.
    }

    @Override
    public Optional<String> explainDiagnosis(DiagnosisScores scores, String patientContext) {
        if (scores == null) {
            return Optional.empty();
        }
        return AiCallSupport.guard("diagnosis explanation", () ->
                        client.post()
                                .uri("/explain/diagnosis")
                                .body(diagnosisPayload(scores, patientContext))
                                .retrieve()
                                .body(ExplanationResponse.class))
                .map(ExplanationResponse::explanation)
                .filter(text -> text != null && !text.isBlank());
    }

    /**
     * Whether the explainer can actually answer right now.
     *
     * <p>Configured is not the same as reachable. This previously returned
     * {@code props.isConfigured()}, and the dashboard endpoints read this
     * port for the admin dashboard's "Gemini API is connected. The assistant
     * generates grounded written answers." banner - so with a base-url set and
     * nothing listening on it, the dashboard asserted a working explainer while
     * every call was quietly returning {@link Optional#empty()}.
     *
     * <p>The result is cached for {@value #PROBE_TTL_MILLIS}ms. This backs a
     * status banner, not a per-request gate, so a slightly stale answer is fine
     * and hammering the AI service is not.
     *
     * <p>{@link #explainSafety} and {@link #explainDiagnosis} are deliberately
     * unchanged: they already degrade to {@link Optional#empty()} through
     * {@link AiCallSupport} and must not depend on this.
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

    // ------------------------------------------------------------------
    // payload construction
    // ------------------------------------------------------------------

    private static Map<String, Object> safetyPayload(SafetyVerdict v) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("formulationName", v.formulationName());
        body.put("riskLevel", v.riskLevel());
        body.put("unmatchedDrugs", v.unmatchedDrugs());
        body.put("majorCount", v.majorCount());
        body.put("moderateCount", v.moderateCount());
        body.put("minorCount", v.minorCount());
        body.put("heavyMetalDailyLimitMg", v.heavyMetalDailyLimitMg());
        body.put("findings", v.findings().stream().map(HttpAiExplanationAdapter::finding).toList());
        return body;
    }

    private static Map<String, Object> finding(Finding f) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("severity", f.severity());
        item.put("type", f.type());
        item.put("subject", f.subject());
        item.put("detail", f.detail());
        item.put("advice", f.advice());
        return item;
    }

    /**
     * Flattens the scores to names before sending.
     *
     * <p>{@link DiagnosisScores} holds {@code List<Disease>} and
     * {@code List<Formulation>} - JPA entities, not DTOs. Serialising those
     * directly would walk every lazy association on the far side of each entity,
     * and with {@code spring.jpa.open-in-view=false} the session is already
     * closed by the time Jackson touches them, so it would throw rather than
     * merely send far too much. The AI service needs the names and nothing else.
     */
    private static Map<String, Object> diagnosisPayload(DiagnosisScores s, String patientContext) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("vathaScore", s.vathaScore());
        body.put("pithaScore", s.pithaScore());
        body.put("kabamScore", s.kabamScore());
        body.put("dominantKutram", s.dominantKutram());
        body.put("predictedDisease", s.predictedDisease());
        body.put("candidateDiseases", names(s.candidateDiseases(), Disease::getNoiEnglish));
        body.put("suggestedFormulations",
                names(s.suggestedFormulations(), Formulation::getNameEnglish));
        body.put("inconclusive", s.isInconclusive());
        body.put("patientContext", patientContext);
        return body;
    }

    private static <T> List<String> names(List<T> items, java.util.function.Function<T, String> get) {
        if (items == null) {
            return List.of();
        }
        return items.stream()
                .filter(java.util.Objects::nonNull)
                .map(item -> {
                    try {
                        return get.apply(item);
                    } catch (RuntimeException e) {
                        // A detached lazy proxy. Skip the name rather than fail the
                        // whole explanation over a garnish.
                        log.warn("Could not read entity name for the AI payload: {}",
                                e.getClass().getSimpleName());
                        return null;
                    }
                })
                .filter(name -> name != null && !name.isBlank())
                .toList();
    }
}
