package com.siddhamind.config;

import org.flywaydb.core.api.configuration.FluentConfiguration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.flyway.FlywayConfigurationCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Points Flyway at a session-mode connection, separate from the runtime pool.
 *
 * <p>Flyway serialises concurrent migrations with {@code pg_advisory_lock}, which is
 * <b>session scoped</b>. Supabase's transaction pooler on :6543 hands each statement
 * to whichever backend is free, so the lock would be taken on one connection and
 * released on another - two instances starting together could then migrate the same
 * database simultaneously.
 *
 * <p>{@code MIGRATION_DB_URL} should therefore be the direct connection or the
 * session pooler, both on :5432. If it is unset the runtime DataSource is used and
 * this logs a warning rather than failing: a single-instance deployment will very
 * likely be fine, and refusing to start would be a worse default.
 */
@Configuration
public class FlywayConfig {

    private static final Logger log = LoggerFactory.getLogger(FlywayConfig.class);

    @Bean
    public FlywayConfigurationCustomizer migrationConnectionCustomizer(
            @Value("${MIGRATION_DB_URL:}") String migrationUrl) {
        return (FluentConfiguration config) -> {
            if (migrationUrl == null || migrationUrl.isBlank()) {
                log.warn("MIGRATION_DB_URL is not set - running migrations over the runtime "
                        + "connection. If that is the transaction pooler (:6543), Flyway's "
                        + "advisory lock is unreliable. See docs/SUPABASE_SETUP.md.");
                return;
            }
            if (!migrationUrl.startsWith("jdbc:")) {
                // A libpq URL copied from the Supabase dashboard is the likely cause.
                throw new IllegalStateException(
                        "MIGRATION_DB_URL must be a JDBC URL starting with 'jdbc:postgresql://'. "
                                + "Got: " + migrationUrl.replaceAll(":[^:@/]+@", ":****@"));
            }
            log.info("Running Flyway migrations over the dedicated migration connection");
            config.dataSource(migrationUrl, null, null);
        };
    }
}
