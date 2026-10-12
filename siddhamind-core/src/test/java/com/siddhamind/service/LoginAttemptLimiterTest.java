package com.siddhamind.service;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LoginAttemptLimiterTest {

    private final MutableClock clock = new MutableClock(Instant.parse("2026-10-05T10:00:00Z"));
    private final LoginAttemptLimiter limiter = new LoginAttemptLimiter(clock);

    private void fail(int n, String id) {
        for (int i = 0; i < n; i++) limiter.recordFailure(id);
    }

    @Test
    void locksOnTheFifthFailureForFifteenMinutes() {
        fail(4, "DOC-0002");
        assertFalse(limiter.isLocked("DOC-0002"));

        fail(1, "DOC-0002");
        assertTrue(limiter.isLocked("DOC-0002"));

        clock.advance(LoginAttemptLimiter.LOCK.minusSeconds(1));
        assertTrue(limiter.isLocked("DOC-0002"));
        clock.advance(Duration.ofSeconds(1));
        assertFalse(limiter.isLocked("DOC-0002"));
    }

    @Test
    void failuresSpreadBeyondTheWindowDoNotAccumulate() {
        fail(4, "DOC-0002");
        clock.advance(LoginAttemptLimiter.WINDOW.plusSeconds(1));
        fail(1, "DOC-0002");
        assertFalse(limiter.isLocked("DOC-0002"));
    }

    @Test
    void afterALockExpiresTheCountStartsAgain() {
        fail(5, "DOC-0002");
        clock.advance(LoginAttemptLimiter.LOCK.plusSeconds(1));

        fail(1, "DOC-0002");
        assertFalse(limiter.isLocked("DOC-0002"), "one failure after a lock must not re-lock");
    }

    @Test
    void successClearsTheCount() {
        fail(4, "STU-0001");
        limiter.recordSuccess("STU-0001");
        fail(4, "STU-0001");
        assertFalse(limiter.isLocked("STU-0001"));
    }

    @Test
    void keysAreCaseAndWhitespaceInsensitiveAndIndependent() {
        fail(5, " stu-0001 ");
        assertTrue(limiter.isLocked("STU-0001"));
        assertFalse(limiter.isLocked("STU-0002"));
    }

    @Test
    void nonexistentIdsLockExactlyLikeRealOnes() {
        // The limiter never consults the database, so a lock says nothing about
        // whether the account exists.
        fail(5, "DOC-9999");
        assertTrue(limiter.isLocked("DOC-9999"));
    }
}
