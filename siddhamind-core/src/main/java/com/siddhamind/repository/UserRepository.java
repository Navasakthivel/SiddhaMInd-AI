package com.siddhamind.repository;

import com.siddhamind.entity.User;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {

    /**
     * Overridden purely to carry the role graph.
     *
     * <p>{@code User.role} is LAZY and {@code open-in-view} is false, so a User
     * loaded by the inherited {@code findAll()} reaches the view as an
     * uninitialised proxy and the admin user list throws
     * {@code LazyInitializationException} while rendering {@code u.role.roleName}.
     * Every query here that returns a User returns it with the role attached.
     */
    @Override
    @EntityGraph(attributePaths = "role")
    List<User> findAll();

    /**
     * Emails are stored lowercased, so the unique index serves this directly.
     * The role is fetched eagerly here because login needs the role name immediately.
     */
    @EntityGraph(attributePaths = "role")
    Optional<User> findByEmail(String email);

    @EntityGraph(attributePaths = "role")
    List<User> findByRole_RoleName(String roleName);

    /**
     * The admin user list, in a stable order.
     *
     * <p>{@code findAll()} has no ORDER BY, so Postgres is free to return rows in
     * whatever order the heap gives it - and after an UPDATE the modified row comes
     * back last. Suspending an account therefore made its row jump to the bottom of
     * the table the admin was looking at, so a second action on "the row I just
     * clicked" landed on a different user. Ordering by the primary key makes the
     * list stable across writes.
     */
    @EntityGraph(attributePaths = "role")
    List<User> findAllByOrderByUserIdAsc();

    long countByRole_RoleName(String roleName);

    boolean existsByEmail(String email);

    /** Login IDs are stored uppercased, so callers normalise before looking up. */
    @EntityGraph(attributePaths = "role")
    Optional<User> findByLoginId(String loginId);

    boolean existsByLoginId(String loginId);

    /**
     * Next login-ID number. Native because these are plain Postgres sequences,
     * not JPA id generators: nextval() never returns a value twice, even across a
     * rolled-back insert, which is what "never reused" requires. See V5.
     */
    /**
     * Single-use guard for activation codes, run by set-password: clears the code
     * only if it is still the one this session activated with and has not expired.
     * Of two set-password calls on the same code, exactly one sees 1 here.
     */
    @Modifying
    @Query("UPDATE User u SET u.activationCodeHash = NULL, u.activationExpiresAt = NULL "
            + "WHERE u.userId = :userId AND u.activationCodeHash = :expectedHash "
            + "AND u.activationExpiresAt > :now")
    int consumeActivationCode(@Param("userId") Long userId,
                              @Param("expectedHash") String expectedHash,
                              @Param("now") Instant now);

    /**
     * Status and session version only - one narrow read per authenticated request,
     * without loading the entity or its role.
     */
    @Query("SELECT new com.siddhamind.repository.UserSessionState(u.status, u.sessionVersion) "
            + "FROM User u WHERE u.userId = :userId")
    Optional<UserSessionState> findSessionState(@Param("userId") Long userId);

    @Query(value = "SELECT nextval('practitioner_login_id_seq')", nativeQuery = true)
    long nextPractitionerLoginNumber();

    @Query(value = "SELECT nextval('student_login_id_seq')", nativeQuery = true)
    long nextStudentLoginNumber();
}
