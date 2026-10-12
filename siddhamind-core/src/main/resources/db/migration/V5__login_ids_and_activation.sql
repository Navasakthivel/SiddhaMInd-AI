-- Login model v2: practitioners and students sign in with an admin-issued login ID
-- (DOC-0001, STU-0001, ...) and a one-time activation code, then set their own
-- password. Admins and patients keep signing in by email.
--
-- login_id is NULL for ADMIN and PATIENT. A UNIQUE constraint on a nullable column
-- permits any number of NULLs in Postgres, which is exactly the semantics wanted.

ALTER TABLE users ADD COLUMN login_id              VARCHAR(20);
ALTER TABLE users ADD COLUMN must_set_password     BOOLEAN     NOT NULL DEFAULT FALSE;
-- BCrypt of the 6-digit code. The plaintext is shown to the admin once and never stored.
ALTER TABLE users ADD COLUMN activation_code_hash  VARCHAR(100);
ALTER TABLE users ADD COLUMN activation_expires_at TIMESTAMPTZ;

ALTER TABLE users ADD CONSTRAINT uq_users_login_id UNIQUE (login_id);
ALTER TABLE users ADD CONSTRAINT ck_users_login_id_format
    CHECK (login_id IS NULL OR login_id ~ '^(DOC|STU)-[0-9]{4,}$');

-- One sequence per prefix. nextval() is non-transactional: a value handed out is
-- never handed out again, even if the INSERT that used it rolls back, so an ID
-- can never be reused or raced between two admins creating accounts at once.
CREATE SEQUENCE practitioner_login_id_seq AS BIGINT MINVALUE 1 START WITH 1;
CREATE SEQUENCE student_login_id_seq      AS BIGINT MINVALUE 1 START WITH 1;

-- The demo accounts keep their current passwords and need no activation.
UPDATE users SET login_id = 'DOC-0001', must_set_password = FALSE
 WHERE email = 'doctor@siddhamind.in';
UPDATE users SET login_id = 'STU-0001', must_set_password = FALSE
 WHERE email = 'student@siddhamind.in';

-- Any other existing practitioner or student (self-registered under the old model)
-- would otherwise be locked out, since email sign-in is now refused for those
-- roles. Give them IDs after 0001 in user_id order; they keep their passwords.
-- The CASE avoids LPAD, which truncates rather than widens past four digits.
WITH numbered AS (
    SELECT u.user_id, ROW_NUMBER() OVER (ORDER BY u.user_id) + 1 AS n
      FROM users u JOIN roles r ON r.role_id = u.role_id
     WHERE r.role_name = 'PRACTITIONER' AND u.login_id IS NULL
)
UPDATE users SET login_id = 'DOC-' || CASE WHEN numbered.n < 10000
                                           THEN LPAD(numbered.n::TEXT, 4, '0')
                                           ELSE numbered.n::TEXT END
  FROM numbered WHERE users.user_id = numbered.user_id;

WITH numbered AS (
    SELECT u.user_id, ROW_NUMBER() OVER (ORDER BY u.user_id) + 1 AS n
      FROM users u JOIN roles r ON r.role_id = u.role_id
     WHERE r.role_name = 'STUDENT' AND u.login_id IS NULL
)
UPDATE users SET login_id = 'STU-' || CASE WHEN numbered.n < 10000
                                           THEN LPAD(numbered.n::TEXT, 4, '0')
                                           ELSE numbered.n::TEXT END
  FROM numbered WHERE users.user_id = numbered.user_id;

-- Move each sequence past everything assigned above. 0001 is always reserved for
-- the demo account (GREATEST(1, ...)), so on a fresh database the seeder can still
-- give it DOC-0001 / STU-0001 and the first admin-created account gets 0002.
-- setval(seq, v) makes the next nextval() return v + 1.
SELECT setval('practitioner_login_id_seq',
              GREATEST(1, COALESCE((SELECT MAX(SUBSTRING(login_id FROM 5)::BIGINT)
                                      FROM users WHERE login_id LIKE 'DOC-%'), 1)));
SELECT setval('student_login_id_seq',
              GREATEST(1, COALESCE((SELECT MAX(SUBSTRING(login_id FROM 5)::BIGINT)
                                      FROM users WHERE login_id LIKE 'STU-%'), 1)));
