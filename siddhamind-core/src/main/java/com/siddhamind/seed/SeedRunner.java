package com.siddhamind.seed;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * Runs the seeder at startup when {@code siddhamind.seed.enabled=true}, or when the
 * application is launched with a {@code --seed} argument:
 *
 * <pre>
 *   mvn spring-boot:run -Dspring-boot.run.arguments=--seed
 *   java -jar siddhamind-core.jar --seed
 *   java -jar siddhamind-core.jar --seed --siddhamind.seed.force=true
 * </pre>
 *
 * <p>Seeding never happens implicitly. The original re-ran data.sql on every boot,
 * which was safe only because every statement was INSERT IGNORE.
 */
@Component
public class SeedRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SeedRunner.class);

    private final SeedProperties props;
    private final DatabaseSeeder seeder;

    public SeedRunner(SeedProperties props, DatabaseSeeder seeder) {
        this.props = props;
        this.seeder = seeder;
    }

    @Override
    public void run(ApplicationArguments args) {
        boolean requested = props.isEnabled() || args.containsOption("seed")
                || args.getNonOptionArgs().contains("seed");
        if (!requested) {
            return;
        }

        log.info("Seeding from {} (force={})", props.getLocation(), props.isForce());
        try {
            log.info("Seed result: {}", seeder.seed());
        } catch (Exception e) {
            // The whole seed is one transaction, so a failure leaves nothing behind
            // and a corrected re-run starts clean.
            log.error("Seeding failed, nothing was committed: {}", e.getMessage(), e);
        }
    }
}
