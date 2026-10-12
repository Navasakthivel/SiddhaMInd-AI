package com.siddhamind.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * Connection settings for siddhamind-ai. Bound from {@code siddhamind.ai.*}.
 */
@ConfigurationProperties(prefix = "siddhamind.ai")
public class AiProperties {

    /**
     * Base URL of the Python service. Blank disables every AI call: the HTTP
     * adapters do not register and {@link com.siddhamind.service.NoOpAiExplanationAdapter}
     * takes over, so the deterministic features keep working untouched.
     */
    private String baseUrl = "";

    /** Shared bearer token. Blank means the AI service will reject every call with 401. */
    private String internalToken = "";

    /**
     * Applied to both connect and read. Deliberately short: an explanation is a
     * garnish on a verdict that has already been computed, so waiting on it is
     * worse than going without.
     */
    private int timeoutSeconds = 60;

    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl == null ? "" : baseUrl.trim(); }

    public String getInternalToken() { return internalToken; }
    public void setInternalToken(String internalToken) {
        this.internalToken = internalToken == null ? "" : internalToken.trim();
    }

    public int getTimeoutSeconds() { return timeoutSeconds; }
    public void setTimeoutSeconds(int timeoutSeconds) { this.timeoutSeconds = timeoutSeconds; }

    public Duration timeout() { return Duration.ofSeconds(Math.max(1, timeoutSeconds)); }

    public boolean isConfigured() { return !baseUrl.isBlank(); }
}
