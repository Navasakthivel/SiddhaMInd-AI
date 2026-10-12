package com.siddhamind.seed;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Controls the Firestore seeder. Off by default - seeding is never implicit. */
@ConfigurationProperties(prefix = "siddhamind.seed")
public class SeedProperties {

    /** Run the seeder on startup. */
    private boolean enabled = false;

    /**
     * Seed even when the knowledge base already holds data.
     *
     * <p>Without this the seeder stops if {@code formulations} is non-empty, so a
     * stray {@code --siddhamind.seed.enabled=true} cannot silently revert edits an
     * admin made through the UI.
     */
    private boolean force = false;

    /** Classpath location of the seed file. */
    private String location = "seed/seed-data.json";

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }

    public boolean isForce() { return force; }
    public void setForce(boolean force) { this.force = force; }

    public String getLocation() { return location; }
    public void setLocation(String location) { this.location = location; }
}
