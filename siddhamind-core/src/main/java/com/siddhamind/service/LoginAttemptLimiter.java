package com.siddhamind.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-identifier brute-force lock for sign-in and activation.
 *
 * <p>{@value #MAX_FAILURES} failures inside {@link #WINDOW} lock that identifier
 * for {@link #LOCK}. Keyed on the identifier typed, not on whether an account
 * exists, so an unknown ID locks exactly like a real one and the lock itself
 * reveals nothing. A six-digit activation code has a million values; five
 * guesses per quarter hour puts exhausting one ID out of reach for the code's
 * seven-day life.
 *
 * <p>In-memory and per instance. Correct for the single-instance deployment this
 * project runs; behind a load balancer each instance would keep its own count and
 * the effective limit would multiply by the instance count - move it to Redis
 * (already in docker-compose) if that changes.
 */
@Component
public class LoginAttemptLimiter {

    public static final int MAX_FAILURES = 5;
    public static final Duration WINDOW = Duration.ofMinutes(15);
    public static final Duration LOCK = Duration.ofMinutes(15);

    /** Above this many tracked identifiers, expired entries are swept on the next failure. */
    private static final int SWEEP_THRESHOLD = 10_000;

    private record Attempts(int failures, Instant windowStart, Instant lockedUntil) {}

    private final ConcurrentHashMap<String, Attempts> attempts = new ConcurrentHashMap<>();
    private final Clock clock;

    @Autowired
    public LoginAttemptLimiter() {
        this(Clock.systemUTC());
    }

    public LoginAttemptLimiter(Clock clock) {
        this.clock = clock;
    }

    public boolean isLocked(String identifier) {
        Attempts a = attempts.get(key(identifier));
        return a != null && a.lockedUntil() != null && clock.instant().isBefore(a.lockedUntil());
    }

    public void recordFailure(String identifier) {
        Instant now = clock.instant();
        attempts.compute(key(identifier), (k, a) -> {
            if (a == null || now.isAfter(a.windowStart().plus(WINDOW))
                    || (a.lockedUntil() != null && !now.isBefore(a.lockedUntil()))) {
                // Fresh window: no history, the old window lapsed, or a lock expired.
                a = new Attempts(0, now, null);
            }
            int failures = a.failures() + 1;
            Instant lockedUntil = failures >= MAX_FAILURES ? now.plus(LOCK) : null;
            return new Attempts(failures, a.windowStart(), lockedUntil);
        });
        if (attempts.size() > SWEEP_THRESHOLD) {
            sweep(now);
        }
    }

    public void recordSuccess(String identifier) {
        attempts.remove(key(identifier));
    }

    private void sweep(Instant now) {
        attempts.entrySet().removeIf(e -> {
            Attempts a = e.getValue();
            boolean lockOver = a.lockedUntil() == null || !now.isBefore(a.lockedUntil());
            return lockOver && now.isAfter(a.windowStart().plus(WINDOW));
        });
    }

    /** dOc-0001 and DOC-0001 are the same account, so they share a counter. */
    private static String key(String identifier) {
        return identifier == null ? "" : identifier.trim().toLowerCase(Locale.ROOT);
    }
}
