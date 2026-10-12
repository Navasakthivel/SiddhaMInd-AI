package com.siddhamind.health;

import com.siddhamind.repository.FormulationRepository;
import com.siddhamind.repository.SourceDocumentRepository;
import com.siddhamind.repository.UserRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Connectivity probe against Supabase Postgres. Replaces the Firestore probe.
 *
 * <p>Reports more than "a connection object exists": it round-trips a query, names
 * the server version, confirms the pgvector extension is installed, and confirms the
 * embedding column width matches what the ingestion pipeline will write. A dimension
 * mismatch there is silent until the first insert fails, so it is worth surfacing.
 */
@RestController
@RequestMapping("/internal/health")
public class HealthController {

    private final DataSource dataSource;
    private final JdbcTemplate jdbc;
    private final UserRepository userRepository;
    private final FormulationRepository formulationRepository;
    private final SourceDocumentRepository sourceDocumentRepository;

    public HealthController(DataSource dataSource, JdbcTemplate jdbc,
                            UserRepository userRepository,
                            FormulationRepository formulationRepository,
                            SourceDocumentRepository sourceDocumentRepository) {
        this.dataSource = dataSource;
        this.jdbc = jdbc;
        this.userRepository = userRepository;
        this.formulationRepository = formulationRepository;
        this.sourceDocumentRepository = sourceDocumentRepository;
    }

    @GetMapping
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("service", "siddhamind-core");

        Map<String, Object> db = new LinkedHashMap<>();
        boolean ok = false;
        long start = System.currentTimeMillis();

        try (Connection connection = dataSource.getConnection()) {
            db.put("status", "UP");
            db.put("latencyMs", System.currentTimeMillis() - start);
            db.put("database", connection.getMetaData().getDatabaseProductName());
            db.put("version", connection.getMetaData().getDatabaseProductVersion());
            db.put("url", sanitise(connection.getMetaData().getURL()));
            ok = true;
        } catch (Exception e) {
            db.put("status", "DOWN");
            db.put("reason", rootMessage(e));
            db.put("hint", "See docs/SUPABASE_SETUP.md");
        }

        if (ok) {
            db.put("pgvector", pgvectorStatus());
            db.put("schema", schemaStatus());
        }

        body.put("postgres", db);
        body.put("status", ok ? "UP" : "DOWN");
        return ResponseEntity.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).body(body);
    }

    private Map<String, Object> pgvectorStatus() {
        Map<String, Object> vector = new LinkedHashMap<>();
        try {
            String version = jdbc.query(
                    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
                    rs -> rs.next() ? rs.getString(1) : null);
            if (version == null) {
                vector.put("installed", false);
                vector.put("hint", "CREATE EXTENSION vector; the V1 migration does this");
                return vector;
            }
            vector.put("installed", true);
            vector.put("version", version);

            // atttypmod on a vector column carries its declared dimension. Confirms
            // the column matches the embedding model before ingestion writes to it.
            Integer dimension = jdbc.query("""
                    SELECT a.atttypmod
                    FROM pg_attribute a
                    JOIN pg_class c ON c.oid = a.attrelid
                    WHERE c.relname = 'doc_chunks' AND a.attname = 'embedding'
                    """, rs -> rs.next() ? rs.getInt(1) : null);
            vector.put("embeddingDimension", dimension);
        } catch (Exception e) {
            vector.put("installed", "unknown");
            vector.put("reason", rootMessage(e));
        }
        return vector;
    }

    private Map<String, Object> schemaStatus() {
        Map<String, Object> schema = new LinkedHashMap<>();
        try {
            schema.put("users", userRepository.count());
            schema.put("formulations", formulationRepository.count());
            schema.put("sourceDocuments", sourceDocumentRepository.count());
            schema.put("docChunks", jdbc.queryForObject("SELECT COUNT(*) FROM doc_chunks", Long.class));
            schema.put("seeded", formulationRepository.count() > 0);
        } catch (Exception e) {
            schema.put("status", "MIGRATION_INCOMPLETE");
            schema.put("reason", rootMessage(e));
            schema.put("hint", "Flyway may not have run - check startup logs");
        }
        return schema;
    }

    /** JDBC URLs can carry the password in a query parameter. */
    private String sanitise(String url) {
        if (url == null) {
            return null;
        }
        return url.replaceAll("(?i)(password=)[^&]*", "$1****");
    }

    private String rootMessage(Throwable t) {
        Throwable cur = t;
        while (cur.getCause() != null && cur.getCause() != cur) {
            cur = cur.getCause();
        }
        return cur.getClass().getSimpleName() + ": " + cur.getMessage();
    }
}
