package com.siddhamind.seed;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Static checks on V5 and the seed file.
 *
 * <p>No database runs under {@code mvn test}, so V5 itself is executed by Flyway
 * on startup only. These guard the properties that matter if someone edits it:
 * uniqueness is a database constraint, the demo IDs are assigned, and 0001 stays
 * reserved so the first admin-created account cannot collide with the demo one.
 */
class LoginIdMigrationTest {

    private static String v5() throws IOException {
        try (InputStream in = LoginIdMigrationTest.class
                .getResourceAsStream("/db/migration/V5__login_ids_and_activation.sql")) {
            assertNotNull(in, "V5 migration missing from the classpath");
            // Normalised so a CRLF checkout on Windows does not fail the checks below.
            return new String(in.readAllBytes(), StandardCharsets.UTF_8).replace("\r\n", "\n");
        }
    }

    @Test
    void loginIdsAreUniqueAtTheDatabase() throws IOException {
        assertTrue(v5().contains("CONSTRAINT uq_users_login_id UNIQUE (login_id)"));
    }

    @Test
    void addsEveryColumnTheEntityMaps() throws IOException {
        String sql = v5();
        for (String column : new String[] {"login_id", "must_set_password",
                "activation_code_hash", "activation_expires_at"}) {
            assertTrue(sql.contains("ADD COLUMN " + column), column);
        }
        assertTrue(sql.contains("must_set_password     BOOLEAN     NOT NULL DEFAULT FALSE"));
    }

    @Test
    void theDemoAccountsKeepTheirPasswordsAndGetTheFirstIds() throws IOException {
        String sql = v5();
        assertTrue(sql.contains("SET login_id = 'DOC-0001', must_set_password = FALSE\n WHERE email = 'doctor@siddhamind.in'"));
        assertTrue(sql.contains("SET login_id = 'STU-0001', must_set_password = FALSE\n WHERE email = 'student@siddhamind.in'"));
        assertTrue(!sql.contains("password_hash ="), "V5 must not touch any password");
    }

    @Test
    void bothSequencesReserveTheDemoNumber() throws IOException {
        String sql = v5();
        assertTrue(sql.contains("setval('practitioner_login_id_seq',\n              GREATEST(1,"));
        assertTrue(sql.contains("setval('student_login_id_seq',\n              GREATEST(1,"));
    }

    @Test
    void theSeederAssignsTheSameDemoIds() throws IOException {
        SeedData data;
        try (InputStream in = getClass().getResourceAsStream("/seed/seed-data.json")) {
            data = new ObjectMapper().readValue(in, SeedData.class);
        }
        for (SeedData.UserSeed u : data.users()) {
            switch (u.email()) {
                case "doctor@siddhamind.in" -> assertEquals("DOC-0001", u.loginId());
                case "student@siddhamind.in" -> assertEquals("STU-0001", u.loginId());
                default -> assertNull(u.loginId(), u.email() + " signs in by email");
            }
        }
    }
}
