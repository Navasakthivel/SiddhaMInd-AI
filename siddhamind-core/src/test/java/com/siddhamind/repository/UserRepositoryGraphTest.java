package com.siddhamind.repository;

import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.EntityGraph;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Guards the fetch plan of every user-loading query.
 *
 * <p>{@code User.role} is {@code LAZY} and {@code spring.jpa.open-in-view} is
 * {@code false}, so the Hibernate session is already closed by the time a
 * template dereferences {@code u.role.roleName}. Any query that returns a User
 * destined for a view must therefore initialise the role itself, or the page
 * throws {@code LazyInitializationException} at render time.
 *
 * <p>This is the failure that took {@code /admin/users} down: {@code allUsers()}
 * called the inherited {@code JpaRepository.findAll()}, the one query on this
 * repository that did not declare the graph its three siblings did.
 *
 * <p>Reflection rather than a database round-trip: booting a Spring context here
 * would need a live Supabase connection, and a fetch-plan regression should fail
 * the build offline.
 */
class UserRepositoryGraphTest {

    /** Queries that hand a User to a view, and so must arrive with role loaded. */
    private static final List<String> VIEW_FACING_QUERIES =
            List.of("findAll", "findByEmail", "findByRole_RoleName", "findAllByOrderByUserIdAsc");

    @Test
    void everyViewFacingQueryFetchesRole() {
        for (String name : VIEW_FACING_QUERIES) {
            Method query = declaredQuery(name);
            assertNotNull(query, () ->
                    "UserRepository must declare " + name + "() so it can carry an "
                            + "@EntityGraph. Inheriting it from JpaRepository leaves "
                            + "User.role as an uninitialised proxy.");

            EntityGraph graph = query.getAnnotation(EntityGraph.class);
            assertNotNull(graph, () ->
                    name + "() has no @EntityGraph, so User.role stays a lazy proxy "
                            + "and rendering it throws LazyInitializationException "
                            + "once the transaction closes.");

            assertTrue(Arrays.asList(graph.attributePaths()).contains("role"), () ->
                    name + "() declares @EntityGraph "
                            + Arrays.toString(graph.attributePaths())
                            + ", which does not include \"role\".");
        }
    }

    private static Method declaredQuery(String name) {
        return Arrays.stream(UserRepository.class.getDeclaredMethods())
                .filter(m -> m.getName().equals(name) && m.getParameterCount() <= 1)
                .findFirst()
                .orElse(null);
    }
}
