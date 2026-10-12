package com.siddhamind.repository;

/**
 * Marker for the repository package.
 *
 * <p>Every interface here is a Spring Data JPA repository. The Firestore version
 * needed 15 hand-written DAO classes with manual future handling, snapshot
 * hydration and in-memory filtering; Postgres and derived queries remove all of it.
 *
 * <p>Two queries that Firestore could not express natively are now plain SQL:
 * {@code FormulationRepository.search} (substring, previously a full-collection read
 * filtered in memory) and every {@code countBy...} (previously an aggregate call).
 */
final class Repositories {
    private Repositories() {}
}
