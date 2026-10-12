package com.siddhamind;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class SiddhaMindApplication {

    public static void main(String[] args) {
        // Checked before Spring starts. Without it the failure surfaces as
        // "Failed to determine suitable jdbc url" from deep inside DataSource
        // auto-configuration, which does not say which variable is missing.
        String jdbcUrl = System.getenv("JAVA_DB_URL");
        if (jdbcUrl == null || jdbcUrl.isBlank()) {
            System.err.println("""

                    JAVA_DB_URL is not set.

                    siddhamind-core needs the Supabase transaction pooler connection:
                      jdbc:postgresql://aws-0-<region>.pooler.supabase.com:6543/postgres\
                    ?user=postgres.<project-ref>&password=<password>&sslmode=require&prepareThreshold=0

                    Copy .env.example to .env and fill it in, or export the variable.
                    See docs/SUPABASE_SETUP.md.
                    """);
            System.exit(1);
        }
        SpringApplication.run(SiddhaMindApplication.class, args);
    }
}
