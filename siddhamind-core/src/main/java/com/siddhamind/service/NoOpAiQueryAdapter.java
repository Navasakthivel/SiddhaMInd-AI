package com.siddhamind.service;

import com.siddhamind.dto.RagAnswer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * Default {@link AiQueryPort}: no AI service configured, no startup failure.
 *
 * <p>{@link AiProperties}'s own Javadoc and {@code AiAdapterWiringTest} both
 * document that a blank {@code siddhamind.ai.base-url} disables every AI call
 * while "the deterministic features keep working untouched." That promise
 * silently didn't hold for the assistant: {@link AssistantService} takes a
 * plain (non-optional) {@link AiQueryPort} constructor argument, and with no
 * fallback bean registered, Spring failed to start the whole application the
 * moment {@code AI_SERVICE_URL} was left blank - exactly the deployment mode
 * the properties file documents as supported ("Set AI_SERVICE_URL= (empty) to
 * force that"). This mirrors {@link NoOpAiExplanationAdapter} so the assistant
 * degrades to "unavailable" instead of the app refusing to boot.
 */
@Configuration
public class NoOpAiQueryAdapter {

    @Bean
    @ConditionalOnMissingBean(AiQueryPort.class)
    public AiQueryPort noOpAiQueryPort() {
        return new AiQueryPort() {
            @Override
            public RagAnswer ask(String question, List<String> bookNames, List<Long> documentIds) {
                return RagAnswer.unavailable(
                        "The AI service is not configured (siddhamind.ai.base-url is blank).");
            }

            @Override
            public boolean isAvailable() {
                return false;
            }
        };
    }
}
