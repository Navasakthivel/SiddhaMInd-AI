package com.siddhamind.service;

/**
 * Thrown instead of attempting a sign-in or activation for an identifier that
 * {@link LoginAttemptLimiter} has locked. The controller answers it with 429.
 *
 * <p>Carries no account detail: the lock is keyed on the identifier typed, so an
 * unknown ID is locked and reported exactly like a real one.
 */
public class SignInLockedException extends RuntimeException {
    public SignInLockedException() {
        super("Too many attempts", null, false, false);
    }
}
