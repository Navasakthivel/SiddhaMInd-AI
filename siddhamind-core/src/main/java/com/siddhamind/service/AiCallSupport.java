package com.siddhamind.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.util.Optional;
import java.util.function.Supplier;

/**
 * The failure boundary for every call to siddhamind-ai.
 *
 * <p>Nothing from the AI service may reach a caller as an exception. The safety
 * and diagnosis engines have already produced their result by the time an
 * explanation is requested; letting a timeout propagate would turn a correct
 * verdict into a 500, which is a strictly worse outcome than showing the verdict
 * without its prose.
 *
 * <p>Logged at WARN, not ERROR, and the distinction is deliberate. An AI outage
 * is an expected operating condition for this system, not a defect in Java - the
 * feature is designed to work without it. ERROR is reserved for things that
 * actually need someone paged.
 *
 * <p>401 is the exception to that reasoning and is called out separately. A
 * network blip resolves itself; a token mismatch never does, and it is silent
 * from the user's side - every explanation simply stops appearing, with the
 * deterministic output continuing to look completely normal. That needs to be
 * distinguishable in a log.
 */
final class AiCallSupport {

    private static final Logger log = LoggerFactory.getLogger(AiCallSupport.class);

    private AiCallSupport() {}

    /**
     * Runs a call, converting every possible failure into {@link Optional#empty()}.
     *
     * @param what human-readable operation name, used in log messages
     */
    static <T> Optional<T> guard(String what, Supplier<T> call) {
        try {
            return Optional.ofNullable(call.get());

        } catch (HttpClientErrorException.Unauthorized | HttpClientErrorException.Forbidden e) {
            log.warn("AI {} rejected the internal token ({}). siddhamind-core and "
                            + "siddhamind-ai disagree on INTERNAL_API_TOKEN - this will not "
                            + "recover on its own and every AI feature stays silently off "
                            + "until both sides are set to the same value.",
                    what, e.getStatusCode());

        } catch (RestClientResponseException e) {
            // 4xx and 5xx that are not auth: a bad payload, a missing key on the
            // AI side, an unhandled error there.
            log.warn("AI {} returned {}: {}", what, e.getStatusCode(),
                    abbreviate(e.getResponseBodyAsString()));

        } catch (ResourceAccessException e) {
            // Connection refused, DNS failure, read timeout. The service is down
            // or too slow; both are outages rather than bugs.
            log.warn("AI {} unreachable: {}", what, rootMessage(e));

        } catch (RestClientException e) {
            // Response arrived but could not be decoded - wrong content type, or
            // JSON that does not fit the expected shape.
            log.warn("AI {} returned an unusable response: {}: {}",
                    what, e.getClass().getSimpleName(), rootMessage(e));

        } catch (RuntimeException e) {
            // Nothing is allowed past this point. A NullPointerException in
            // response mapping must not become a 500 on a page whose real content
            // was computed correctly before the call was made.
            log.warn("AI {} failed unexpectedly: {}: {}",
                    what, e.getClass().getSimpleName(), e.getMessage());
        }
        return Optional.empty();
    }

    private static String rootMessage(Throwable t) {
        Throwable cause = t;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }
        return cause.getClass().getSimpleName() + ": " + cause.getMessage();
    }

    private static String abbreviate(String body) {
        if (body == null || body.isBlank()) {
            return "<empty body>";
        }
        String flat = body.replaceAll("\\s+", " ").trim();
        return flat.length() <= 200 ? flat : flat.substring(0, 200) + "...";
    }
}
