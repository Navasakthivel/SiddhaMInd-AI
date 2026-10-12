package com.siddhamind.service;

import com.siddhamind.dto.DiagnosisScores;
import com.siddhamind.dto.SafetyVerdict;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Optional;

/**
 * Default {@link AiExplanationPort}: no AI, no failure.
 *
 * <p>Steps aside automatically once Phase 6 registers a real adapter bean.
 */
@Configuration
public class NoOpAiExplanationAdapter {

    @Bean
    @ConditionalOnMissingBean(AiExplanationPort.class)
    public AiExplanationPort noOpAiExplanationPort() {
        return new AiExplanationPort() {
            @Override
            public Optional<String> explainSafety(SafetyVerdict verdict) {
                return Optional.empty();
            }

            @Override
            public Optional<String> explainDiagnosis(DiagnosisScores scores, String patientContext) {
                return Optional.empty();
            }

            @Override
            public boolean isAvailable() {
                return false;
            }
        };
    }
}
