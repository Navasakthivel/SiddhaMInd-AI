package com.siddhamind.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.ForeignKey;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "users")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "user_id")
    private Long userId;

    @Column(name = "full_name", nullable = false, length = 120)
    private String fullName;

    /** Stored lowercased; the DB unique constraint therefore also enforces case-insensitive uniqueness. */
    @Column(nullable = false, unique = true, length = 120)
    private String email;

    /** BCrypt. 100 chars leaves room beyond BCrypt's 60 for a future algorithm change. */
    @Column(name = "password_hash", nullable = false, length = 100)
    private String passwordHash;

    @Column(length = 20)
    private String phone;

    /**
     * A real association, not the bare {@code role_id} Long the original carried.
     * LAZY because the role name is only needed at login and on the profile page.
     */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "role_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_users_role"))
    private Role role;

    @Column(name = "reg_number", length = 50)
    private String regNumber;

    @Column(length = 200)
    private String institution;

    @Column(nullable = false, length = 20)
    private String status = "ACTIVE";

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "last_login")
    private Instant lastLogin;

    /** DOC-0001 / STU-0001 for practitioners and students; null for admin and patient. */
    @Column(name = "login_id", unique = true, length = 20)
    private String loginId;

    /** True from account creation (or admin reset) until the user sets their own password. */
    @Column(name = "must_set_password", nullable = false)
    private boolean mustSetPassword;

    /** BCrypt of the one-time activation code. Null once used, or when none is outstanding. */
    @Column(name = "activation_code_hash", length = 100)
    private String activationCodeHash;

    @Column(name = "activation_expires_at")
    private Instant activationExpiresAt;

    /**
     * Incremented by suspend, admin reset and set-password. A session whose
     * recorded value differs is revoked by AuthInterceptor. See V6.
     */
    @Column(name = "session_version", nullable = false)
    private int sessionVersion;

    public User() {}

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }

    public String getFullName() { return fullName; }
    public void setFullName(String fullName) { this.fullName = fullName; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }

    public String getPasswordHash() { return passwordHash; }
    public void setPasswordHash(String passwordHash) { this.passwordHash = passwordHash; }

    public String getPhone() { return phone; }
    public void setPhone(String phone) { this.phone = phone; }

    public Role getRole() { return role; }
    public void setRole(Role role) { this.role = role; }

    /** Convenience for templates and the session, which compare against the name. */
    public String getRoleName() { return role == null ? null : role.getRoleName(); }

    public String getRegNumber() { return regNumber; }
    public void setRegNumber(String regNumber) { this.regNumber = regNumber; }

    public String getInstitution() { return institution; }
    public void setInstitution(String institution) { this.institution = institution; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }

    public Instant getLastLogin() { return lastLogin; }
    public void setLastLogin(Instant lastLogin) { this.lastLogin = lastLogin; }

    public String getLoginId() { return loginId; }
    public void setLoginId(String loginId) { this.loginId = loginId; }

    public boolean isMustSetPassword() { return mustSetPassword; }
    public void setMustSetPassword(boolean mustSetPassword) { this.mustSetPassword = mustSetPassword; }

    public String getActivationCodeHash() { return activationCodeHash; }
    public void setActivationCodeHash(String activationCodeHash) { this.activationCodeHash = activationCodeHash; }

    public Instant getActivationExpiresAt() { return activationExpiresAt; }
    public void setActivationExpiresAt(Instant activationExpiresAt) { this.activationExpiresAt = activationExpiresAt; }

    public int getSessionVersion() { return sessionVersion; }
    public void setSessionVersion(int sessionVersion) { this.sessionVersion = sessionVersion; }

    /** Ends every session opened before this call, once saved. */
    public void revokeSessions() { this.sessionVersion++; }
}
