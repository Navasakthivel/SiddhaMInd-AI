import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Lists or hard-deletes user accounts in the Supabase database, with their rows.
 *
 * Run with the pgjdbc jar Maven already has (no install needed):
 *
 *   java -cp ~/.m2/repository/org/postgresql/postgresql/42.7.7/postgresql-42.7.7.jar \
 *        scripts/PruneUsers.java list
 *   ...  scripts/PruneUsers.java delete-except 1,2,3,4,5 [--reset-sequences] [--dry-run]
 *   ...  scripts/PruneUsers.java delete-emails a@example.invalid,b@example.invalid [--reset-sequences]
 *
 * Connects with MIGRATION_DB_URL (the session connection), read from the
 * environment or, failing that, the repo's .env. The URL is never printed.
 *
 * Everything happens in ONE transaction, which is rolled back - nothing
 * deleted - if anything unexpected turns up:
 *   - a demo account (admin/doctor/student/patient@siddhamind.in) is a target
 *   - a target's email is not a test address (@example.invalid), unless
 *     --allow-any-email is given
 *   - a foreign key to users exists that this tool does not know how to clean
 *   - a target uploaded a source document (deleting would orphan the corpus row)
 *   - the number of users deleted differs from the number targeted
 * Child rows are deleted explicitly, deepest first, rather than left to
 * ON DELETE CASCADE / SET NULL, so the log shows exactly what went.
 *
 * --reset-sequences runs only AFTER a successful commit: setval() is not
 * transactional and would survive a rollback. Each login-ID sequence is set to
 * the highest number still in use (floor 1, since 0001 is the demo account), so
 * the next ID handed out is one past it and can never collide with a live one.
 */
public class PruneUsers {

    static final Set<String> DEMO = Set.of("admin@siddhamind.in", "doctor@siddhamind.in",
            "student@siddhamind.in", "patient@siddhamind.in");

    /** Every FK to users this tool cleans up, as "table.column". */
    static final Set<String> KNOWN_USER_FKS = Set.of("safety_checks.user_id",
            "diagnosis_sessions.practitioner_id", "source_documents.uploaded_by",
            "chat_sessions.user_id", "activity_logs.user_id", "notifications.user_id");

    /** Child deletes, deepest first. ? is the array of target user ids. */
    static final String[][] DELETES = {
            {"chat_message_citations", "DELETE FROM chat_message_citations WHERE message_id IN (SELECT m.message_id FROM chat_messages m JOIN chat_sessions c ON c.chat_id = m.chat_id WHERE c.user_id = ANY(?))"},
            {"chat_messages", "DELETE FROM chat_messages WHERE chat_id IN (SELECT chat_id FROM chat_sessions WHERE user_id = ANY(?))"},
            {"chat_sessions", "DELETE FROM chat_sessions WHERE user_id = ANY(?)"},
            {"safety_check_findings", "DELETE FROM safety_check_findings WHERE check_id IN (SELECT check_id FROM safety_checks WHERE user_id = ANY(?))"},
            {"safety_checks", "DELETE FROM safety_checks WHERE user_id = ANY(?)"},
            {"diagnosis_candidates", "DELETE FROM diagnosis_candidates WHERE session_id IN (SELECT session_id FROM diagnosis_sessions WHERE practitioner_id = ANY(?))"},
            {"diagnosis_suggestions", "DELETE FROM diagnosis_suggestions WHERE session_id IN (SELECT session_id FROM diagnosis_sessions WHERE practitioner_id = ANY(?))"},
            {"diagnosis_sessions", "DELETE FROM diagnosis_sessions WHERE practitioner_id = ANY(?)"},
            {"activity_logs", "DELETE FROM activity_logs WHERE user_id = ANY(?)"},
            {"notifications", "DELETE FROM notifications WHERE user_id = ANY(?)"},
    };

    record UserRow(long id, String email, String loginId, String role, String status) {
        @Override public String toString() {
            return String.format("%4d  %-48s %-10s %-13s %s", id, email,
                    loginId == null ? "-" : loginId, role, status);
        }
    }

    static class Abort extends RuntimeException { Abort(String m) { super(m); } }

    public static void main(String[] args) throws Exception {
        if (args.length == 0) usage();
        String mode = args[0];
        List<String> flags = List.of(args).subList(1, args.length);
        boolean dryRun = flags.contains("--dry-run");
        boolean resetSeq = flags.contains("--reset-sequences");
        boolean anyEmail = flags.contains("--allow-any-email");

        try (Connection c = DriverManager.getConnection(dbUrl())) {
            switch (mode) {
                case "list" -> listUsers(c, "All users").forEach(System.out::println);
                case "delete-except", "delete-emails" -> {
                    if (args.length < 2 || args[1].startsWith("--")) usage();
                    int deleted = delete(c, mode, args[1], anyEmail, dryRun);
                    if (resetSeq && !dryRun) resetSequences(c);
                    System.out.println();
                    listUsers(c, "Users now").forEach(System.out::println);
                    System.out.println(dryRun ? "DRY RUN - rolled back, nothing deleted."
                            : "Deleted " + deleted + " user(s).");
                }
                default -> usage();
            }
        } catch (Abort a) {
            System.out.println("ROLLED BACK - " + a.getMessage());
            System.exit(2);
        }
    }

    static int delete(Connection c, String mode, String arg, boolean anyEmail, boolean dryRun)
            throws SQLException {
        c.setAutoCommit(false);
        try {
            // Lock every user row first so nothing changes underneath the checks.
            List<UserRow> all = listUsers(c, null, " FOR UPDATE OF u");
            List<UserRow> targets = new ArrayList<>();
            if (mode.equals("delete-except")) {
                Set<Long> keep = new TreeSet<>();
                for (String s : arg.split(",")) keep.add(Long.parseLong(s.trim()));
                for (UserRow u : all) if (!keep.contains(u.id())) targets.add(u);
                System.out.println("Keeping ids " + keep + ":");
                all.stream().filter(u -> keep.contains(u.id())).forEach(u -> System.out.println("  " + u));
            } else {
                Set<String> emails = new TreeSet<>();
                for (String s : arg.split(",")) if (!s.isBlank()) emails.add(s.trim().toLowerCase());
                for (UserRow u : all) if (emails.contains(u.email())) targets.add(u);
            }

            System.out.println("\nTo delete (" + targets.size() + "):");
            targets.forEach(u -> System.out.println("  " + u));
            if (targets.isEmpty()) { c.rollback(); return 0; }

            for (UserRow u : targets) {
                if (DEMO.contains(u.email())) throw new Abort("demo account targeted: " + u.email());
                if (!anyEmail && !u.email().endsWith("@example.invalid")) {
                    throw new Abort("not a test address: " + u.email() + " (id " + u.id() + ")");
                }
            }

            Set<String> fks = userForeignKeys(c);
            Set<String> unknown = new TreeSet<>(fks);
            unknown.removeAll(KNOWN_USER_FKS);
            if (!unknown.isEmpty()) throw new Abort("unexpected foreign keys to users: " + unknown);

            Long[] ids = targets.stream().map(UserRow::id).toArray(Long[]::new);
            java.sql.Array idArray = c.createArrayOf("bigint", ids);

            try (PreparedStatement ps = c.prepareStatement(
                    "SELECT count(*) FROM source_documents WHERE uploaded_by = ANY(?)")) {
                ps.setArray(1, idArray);
                try (ResultSet rs = ps.executeQuery()) {
                    rs.next();
                    if (rs.getLong(1) > 0) throw new Abort(rs.getLong(1) + " source document(s) uploaded by a target");
                }
            }

            System.out.println("\nRelated rows deleted:");
            for (String[] d : DELETES) {
                try (PreparedStatement ps = c.prepareStatement(d[1])) {
                    ps.setArray(1, idArray);
                    System.out.printf("  %-24s %d%n", d[0], ps.executeUpdate());
                }
            }
            int deleted;
            try (PreparedStatement ps = c.prepareStatement("DELETE FROM users WHERE user_id = ANY(?)")) {
                ps.setArray(1, idArray);
                deleted = ps.executeUpdate();
            }
            System.out.printf("  %-24s %d%n", "users", deleted);
            if (deleted != targets.size()) {
                throw new Abort("deleted " + deleted + " users but targeted " + targets.size());
            }

            if (dryRun) c.rollback(); else c.commit();
            return deleted;
        } catch (RuntimeException | SQLException e) {
            c.rollback();
            throw e;
        } finally {
            c.setAutoCommit(true);
        }
    }

    /** After commit only - see the class comment. */
    static void resetSequences(Connection c) throws SQLException {
        System.out.println("\nSequences:");
        for (String[] s : new String[][]{{"DOC", "practitioner_login_id_seq"}, {"STU", "student_login_id_seq"}}) {
            String sql = "SELECT setval('" + s[1] + "', GREATEST(1, COALESCE((SELECT MAX(SUBSTRING(login_id FROM 5)::BIGINT) "
                    + "FROM users WHERE login_id LIKE '" + s[0] + "-%'), 1)))";
            try (PreparedStatement ps = c.prepareStatement(sql); ResultSet rs = ps.executeQuery()) {
                rs.next();
                System.out.printf("  %-28s next ID %s-%04d%n", s[1], s[0], rs.getLong(1) + 1);
            }
        }
    }

    static Set<String> userForeignKeys(Connection c) throws SQLException {
        String sql = "SELECT cl.relname || '.' || a.attname FROM pg_constraint con "
                + "JOIN pg_class cl ON cl.oid = con.conrelid "
                + "JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey) "
                + "WHERE con.contype = 'f' AND con.confrelid = 'public.users'::regclass";
        Set<String> out = new TreeSet<>();
        try (PreparedStatement ps = c.prepareStatement(sql); ResultSet rs = ps.executeQuery()) {
            while (rs.next()) out.add(rs.getString(1));
        }
        return out;
    }

    static List<UserRow> listUsers(Connection c, String title) throws SQLException {
        return listUsers(c, title, "");
    }

    static List<UserRow> listUsers(Connection c, String title, String lock) throws SQLException {
        String sql = "SELECT u.user_id, u.email, u.login_id, r.role_name, u.status FROM users u "
                + "JOIN roles r ON r.role_id = u.role_id ORDER BY u.user_id" + lock;
        List<UserRow> out = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement(sql); ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                out.add(new UserRow(rs.getLong(1), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getString(5)));
            }
        }
        if (title != null) System.out.println(title + " (" + out.size() + "):");
        return out;
    }

    static String dbUrl() throws Exception {
        String url = System.getenv("MIGRATION_DB_URL");
        if (url == null || url.isBlank()) {
            Map<String, String> env = new LinkedHashMap<>();
            Path dir = Path.of("").toAbsolutePath();
            while (dir != null && !Files.exists(dir.resolve(".env"))) dir = dir.getParent();
            if (dir == null) throw new IllegalStateException("MIGRATION_DB_URL not set and no .env found");
            for (String line : Files.readAllLines(dir.resolve(".env"))) {
                int eq = line.indexOf('=');
                if (eq > 0 && !line.startsWith("#")) env.put(line.substring(0, eq).trim(), line.substring(eq + 1).trim());
            }
            url = env.get("MIGRATION_DB_URL");
        }
        if (url != null && url.length() > 1 && (url.startsWith("\"") || url.startsWith("'"))) {
            url = url.substring(1, url.length() - 1);
        }
        if (url == null || !url.startsWith("jdbc:")) throw new IllegalStateException("MIGRATION_DB_URL must be a JDBC URL");
        return url;
    }

    static void usage() {
        System.out.println("usage: PruneUsers list | delete-except <ids> | delete-emails <emails> "
                + "[--reset-sequences] [--dry-run] [--allow-any-email]");
        System.exit(1);
    }
}
