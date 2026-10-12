package com.siddhamind.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * The {@link RestClient} used for every call to siddhamind-ai.
 *
 * <p>One shared builder so the bearer token and the timeouts are configured in a
 * single place. Both adapters take the builder rather than a finished client,
 * which is what lets {@code MockRestServiceServer} bind to them in tests -
 * exercising the real request-building and JSON-decoding code against a mock
 * transport, instead of testing a mock of the adapter itself.
 *
 * <p>The timeout is set on the request factory, not merely hoped for. Without an
 * explicit read timeout the JDK's default is <em>infinite</em>: a Python service
 * that accepts the connection and then hangs would block a Tomcat worker
 * forever, and the "AI failure never breaks a verdict" guarantee would hold in
 * unit tests while failing in production.
 */
@Configuration
public class AiClientConfig {

    private static final Logger log = LoggerFactory.getLogger(AiClientConfig.class);

    @Bean
    @ConditionalOnMissingBean(RestClient.Builder.class)
    public RestClient.Builder aiRestClientBuilder(AiProperties props) {
        if (!props.isConfigured()) {
            log.info("siddhamind.ai.base-url is blank - AI calls are disabled, "
                    + "deterministic features are unaffected.");
        } else {
            log.info("AI service at {} (timeout {}s, token {})",
                    props.getBaseUrl(),
                    props.getTimeoutSeconds(),
                    props.getInternalToken().isBlank() ? "MISSING - calls will 401" : "set");
        }

        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout((int) props.timeout().toMillis());
        factory.setReadTimeout((int) props.timeout().toMillis());

        RestClient.Builder builder = RestClient.builder()
                .requestFactory(factory)
                .defaultHeader(HttpHeaders.ACCEPT, "application/json");

        if (!props.getInternalToken().isBlank()) {
            builder = builder.defaultHeader(
                    HttpHeaders.AUTHORIZATION, "Bearer " + props.getInternalToken());
        }
        return builder;
    }
}
