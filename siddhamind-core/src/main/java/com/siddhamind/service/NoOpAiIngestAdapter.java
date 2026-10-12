package com.siddhamind.service;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Default {@link AiIngestPort}: no AI service configured, no startup failure.
 *
 * <p>{@link AdminService} takes a plain (non-optional) {@link AiIngestPort}
 * constructor argument. Without this fallback, leaving {@code
 * siddhamind.ai.base-url} blank (the properties file's own documented way to
 * disable AI: "Set AI_SERVICE_URL= (empty)") left no bean to satisfy that
 * dependency and Spring refused to start the whole application. Corpus upload
 * itself does not depend on the AI service - only "Index" and its status
 * polling did, and those already have graceful "unavailable" answers below.
 * Mirrors {@link NoOpAiExplanationAdapter} and {@link NoOpAiQueryAdapter}.
 */
@Configuration
public class NoOpAiIngestAdapter {

    private static final String REASON =
            "The AI ingestion service is not configured (siddhamind.ai.base-url is blank).";

    @Bean
    @ConditionalOnMissingBean(AiIngestPort.class)
    public AiIngestPort noOpAiIngestPort() {
        return new AiIngestPort() {
            @Override
            public IngestTrigger trigger(Long sourceDocumentId) {
                return IngestTrigger.failed(REASON);
            }

            @Override
            public IngestStatus status(Long sourceDocumentId) {
                return IngestStatus.unavailable(REASON);
            }

            @Override
            public boolean isAvailable() {
                return false;
            }
        };
    }
}
