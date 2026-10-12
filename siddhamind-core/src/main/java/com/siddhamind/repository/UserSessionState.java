package com.siddhamind.repository;

/** The two columns AuthInterceptor re-checks on every authenticated request. */
public record UserSessionState(String status, int sessionVersion) {}
