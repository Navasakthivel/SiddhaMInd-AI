package com.siddhamind.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.siddhamind.config.AiProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * Calls {@code POST /ingest/{id}} on siddhamind-ai.
 *
 * <p>The AI service validates the cheap failures synchronously before accepting
 * - a missing row, a missing PDF, missing Tesseract - so its 4xx responses carry
 * information an admin can act on directly. They are surfaced rather than
 * flattened into "failed", which is the difference between "put the file in
 * corpus/" and a shrug.
 */
@Component
@ConditionalOnExpression("!'${siddhamind.ai.base-url:}'.isBlank()")
public class HttpAiIngestAdapter implements AiIngestPort {

    private static final Logger log = LoggerFactory.getLogger(HttpAiIngestAdapter.class);

    private final RestClient client;
    private final AiProperties props;

    public HttpAiIngestAdapter(RestClient.Builder builder, AiProperties props) {
        this.client = builder.baseUrl(props.getBaseUrl()).build();
        this.props = props;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record IngestAccepted(String status, String title, String file, Integer totalPages) {}

    @Override
    public IngestTrigger trigger(Long sourceDocumentId) {
        if (sourceDocumentId == null) {
            return IngestTrigger.failed("No document selected.");
        }
        try {
            IngestAccepted accepted = client.post()
                    .uri("/ingest/{id}", sourceDocumentId)
                    .retrieve()
                    .body(IngestAccepted.class);

            String file = accepted == null ? "the document" : accepted.file();
            log.info("Ingestion queued for document {} ({})", sourceDocumentId, file);
            return IngestTrigger.accepted("Ingestion queued for " + file
                    + ". Progress appears here as it runs.");

        } catch (HttpClientErrorException.Conflict e) {
            return IngestTrigger.failed("That document is already being ingested.");

        } catch (HttpClientErrorException.NotFound e) {
            return IngestTrigger.failed("The AI service has no record of document "
                    + sourceDocumentId + ".");

        } catch (HttpClientErrorException.Unauthorized | HttpClientErrorException.Forbidden e) {
            log.warn("Ingest trigger rejected the internal token ({}). siddhamind-core and "
                    + "siddhamind-ai disagree on INTERNAL_API_TOKEN.", e.getStatusCode());
            return IngestTrigger.failed(
                    "The AI service rejected our credentials. Check INTERNAL_API_TOKEN "
                            + "matches on both services.");

        } catch (RestClientResponseException e) {
            // 400 (no PDF / bad path) and 503 (Tesseract or poppler missing) both
            // carry a 'detail' an admin can act on, so the body is passed through
            // rather than replaced with a generic message.
            log.warn("Ingest trigger for document {} returned {}: {}",
                    sourceDocumentId, e.getStatusCode(), e.getResponseBodyAsString());
            return IngestTrigger.failed("The AI service refused the request ("
                    + e.getStatusCode().value() + "): " + abbreviate(e.getResponseBodyAsString()));

        } catch (RuntimeException e) {
            log.warn("Ingest trigger for document {} failed: {}: {}",
                    sourceDocumentId, e.getClass().getSimpleName(), e.getMessage());
            return IngestTrigger.failed("The AI service could not be reached.");
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record IngestState(String status, Boolean running, Integer chunkCount, Integer totalPages,
                       Integer skippedPages, String error) {}

    @Override
    public IngestStatus status(Long sourceDocumentId) {
        if (sourceDocumentId == null) {
            return IngestStatus.unavailable("No document selected.");
        }
        try {
            IngestState state = client.get()
                    .uri("/ingest/{id}/status", sourceDocumentId)
                    .retrieve()
                    .body(IngestState.class);

            if (state == null) {
                return IngestStatus.unavailable("The AI service returned no status.");
            }
            return new IngestStatus(
                    true,
                    state.status() == null ? "UNKNOWN" : state.status(),
                    Boolean.TRUE.equals(state.running()),
                    state.chunkCount(),
                    state.totalPages(),
                    state.skippedPages(),
                    state.error(),
                    null);

        } catch (HttpClientErrorException.NotFound e) {
            return IngestStatus.unavailable("The AI service has no record of document "
                    + sourceDocumentId + ".");

        } catch (HttpClientErrorException.Unauthorized | HttpClientErrorException.Forbidden e) {
            log.warn("Ingest status rejected the internal token ({}).", e.getStatusCode());
            return IngestStatus.unavailable(
                    "The AI service rejected our credentials. Check INTERNAL_API_TOKEN "
                            + "matches on both services.");

        } catch (RestClientResponseException e) {
            log.warn("Ingest status for document {} returned {}",
                    sourceDocumentId, e.getStatusCode());
            return IngestStatus.unavailable("The AI service refused the request ("
                    + e.getStatusCode().value() + ").");

        } catch (RuntimeException e) {
            // Polled repeatedly, so this is logged at debug: a service that is
            // down would otherwise fill the log once per poll per document.
            log.debug("Ingest status for document {} failed: {}", sourceDocumentId, e.toString());
            return IngestStatus.unavailable("The AI service could not be reached.");
        }
    }

    @Override
    public boolean isAvailable() {
        return props.isConfigured();
    }

    private static String abbreviate(String body) {
        if (body == null || body.isBlank()) {
            return "no detail given";
        }
        String flat = body.replaceAll("\\s+", " ").trim();
        return flat.length() <= 240 ? flat : flat.substring(0, 240) + "...";
    }
}
