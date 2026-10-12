# Supabase Postgres setup

Project ref `xtcqdbirjwypxbhwibmh`, region `ap-northeast-2`. pgvector is already
enabled on the instance.

---

## 1. The three connection strings, and why they differ

Supabase exposes the same database three ways. They are **not** interchangeable
here — each is chosen for a specific constraint.

| Variable | Endpoint | Port | Mode | Used by |
|---|---|---|---|---|
| `JAVA_DB_URL` | `aws-1-ap-northeast-2.pooler.supabase.com` | 6543 | transaction | Spring Boot runtime |
| `PYTHON_DB_URL` | pooler `:5432`, or `db.<ref>.supabase.co` | 5432 | session | ingestion + retrieval |
| `MIGRATION_DB_URL` | same host as `PYTHON_DB_URL`, JDBC form | 5432 | session | Flyway only |

Get the passwords from **Project Settings → Database → Connection string**.

### Two things that will bite you before anything connects

**Quote every URL that contains `&`.** Unquoted, `set -a; . ./.env` treats `&` as
"run in background" and truncates the value at the first one. `JAVA_DB_URL` ends
up **empty**, and the startup guard then reports it as never set — pointing you at
a missing variable rather than a quoting bug. `PYTHON_DB_URL` survives only
because it happens to contain no `&`, which makes the failure look selective and
even more confusing.

**Percent-encode the password.** `@ → %40`, `#` → `%23`, `&` → `%26`, `/` → `%2F`,
`:` → `%3A`, `+` → `%2B`, `%` → `%25`. An unencoded `@` leaves the URL ambiguous
about where the credentials end; Python's `urlparse` splits on the last one and
gets it right, but libpq and several other clients do not. The JDBC driver and
asyncpg both decode the escapes back.

### The pooler hostname prefix is not derivable from the region

It is `aws-0-…` **or** `aws-1-…` depending on which pooler cluster your project
landed on. This project is on **`aws-1`**. Copy the host from the dashboard rather
than assuming. The wrong prefix fails with:

```
FATAL: (ENOTFOUND) tenant/user postgres.<project-ref> not found
```

which reads like a bad username and is really a wrong host — the username is fine.
A quick way to tell the project itself is healthy:
`curl -s -o /dev/null -w '%{http_code}' https://<ref>.supabase.co/rest/v1/` should
return **401** (alive, needs an API key), not a DNS failure.

### Why Java uses the transaction pooler

A web app opens and closes connections constantly. PgBouncer in transaction mode
multiplexes many clients onto few Postgres backends, which is what Supabase's
connection limits require.

The cost: **server-side prepared statements do not work.** A statement prepared on
one backend is invisible when the next query lands on another. Hence
`prepareThreshold=0` in the JDBC URL — this is required, not tuning. Omit it and
you get intermittent `prepared statement "S_1" does not exist` errors under load.

### Why Python uses a session connection

Ingestion writes chunks in large batches and asyncpg relies on prepared statements
throughout. On a transaction pooler that breaks, so the code detects port 6543 and
disables the statement cache — but a session connection is faster and simpler.

> **IPv6 warning.** The direct host `db.xtcqdbirjwypxbhwibmh.supabase.co` resolves
> to an **IPv6 address only** — there is no A record. Verified from this machine:
>
> ```
> db.xtcqdbirjwypxbhwibmh.supabase.co  ->  2406:da12:1f1:f800:b740:76a1:7457:e1ea
> ```
>
> If your network or Docker host is IPv4-only, that connection will simply hang.
> Use the **session pooler** instead — `aws-1-ap-northeast-2.pooler.supabase.com:5432`.
> It is IPv4, still session-mode, and behaves identically for this workload.
> `.env.example` defaults to the session pooler for exactly this reason.

### Why Flyway needs its own connection

Flyway serialises concurrent migrations with `pg_advisory_lock`, which is **session
scoped**. Through a transaction pooler the lock would be acquired on one backend and
released on another, so two instances starting together could migrate the same
database simultaneously.

`MIGRATION_DB_URL` must be a **JDBC** URL (`jdbc:postgresql://...`) on port 5432.
If it is unset, migrations fall back to the runtime connection and log a warning —
survivable for a single instance, not for two.

## 2. Fill in `.env`

```bash
cp .env.example .env
```

Replace `YOUR_DB_PASSWORD` in all three URLs, and generate the internal token:

```bash
openssl rand -hex 32
```

## 3. First run — migrate and seed

```bash
cd siddhamind-core
mvn -B package -DskipTests
java -jar target/siddhamind-core.jar --seed
```

Flyway applies `V1__baseline_schema.sql` (22 tables, 25 foreign keys, the pgvector
`doc_chunks` table and its HNSW index), then the seeder loads the Siddha reference
data. Both are idempotent — Flyway records what it applied, and the seeder matches
reference rows by their `slug` natural key.

Seeding stops if `formulations` already has rows. Add
`--siddhamind.seed.force=true` to overwrite.

## 4. Verify

```bash
curl http://localhost:8080/siddhamind/internal/health
```

```json
{
  "service": "siddhamind-core",
  "postgres": {
    "status": "UP",
    "latencyMs": 180,
    "database": "PostgreSQL",
    "version": "17.x",
    "pgvector": { "installed": true, "version": "0.8.0", "embeddingDimension": 1024 },
    "schema": { "users": 4, "formulations": 10, "sourceDocuments": 6, "docChunks": 0, "seeded": true }
  },
  "status": "UP"
}
```

`embeddingDimension: 1024` is the check that matters — it confirms
`doc_chunks.embedding` matches what bge-m3 produces. A mismatch is otherwise
invisible until an ingestion run fails partway through.

Then the Python service:

```bash
cd siddhamind-ai
pip install -r requirements.txt
uvicorn app.main:app --reload
curl http://localhost:8000/health
```

Demo logins (BCrypt hashed; change before exposing anything):

| Email | Password | Role |
|---|---|---|
| `admin@siddhamind.in` | `admin123` | ADMIN |
| `doctor@siddhamind.in` | `doctor123` | PRACTITIONER |
| `student@siddhamind.in` | `student123` | STUDENT |
| `patient@siddhamind.in` | `patient123` | PATIENT |

---

## Embedding dimension

`doc_chunks.embedding` is `vector(1024)`, matching **BAAI/bge-m3**, whose dense
vector is 1024-d. `intfloat/multilingual-e5-large` is also 1024-d, so either model
fits without a migration.

A model of a different width (e.g. `all-MiniLM-L6-v2` at 384) needs an
`ALTER TABLE` and a full re-index — the column width is fixed at creation. The
Python service compares `EMBEDDING_DIM` against the live column at startup and
refuses to proceed on a mismatch.

pgvector caps HNSW indexes at 2000 dimensions, so 1024 is comfortably inside.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `JAVA_DB_URL is not set` | `.env` not loaded | Export it, or run through docker compose |
| `prepared statement "S_1" does not exist` | `prepareThreshold=0` missing | Add it to `JAVA_DB_URL` |
| Python connection hangs, never errors | IPv6-only direct host on an IPv4 network | Switch `PYTHON_DB_URL` to the session pooler |
| `password authentication failed` | Pooler needs `postgres.<project-ref>` | Not bare `postgres` — check the username |
| `Schema-validation: missing table` | Flyway did not run | Check startup logs; confirm `MIGRATION_DB_URL` |
| `extension "vector" is not available` | pgvector not enabled | Dashboard → Database → Extensions → enable `vector` |
| `MIGRATION_DB_URL must be a JDBC URL` | libpq URL copied from the dashboard | Prefix `jdbc:`, move user/password into query params |
| Flyway hangs on startup | Advisory lock through the transaction pooler | Point `MIGRATION_DB_URL` at port 5432 |

---

## What changed from Firestore

| Firestore | Postgres |
|---|---|
| Composite doc ID `{ingredient}_{drug}` for O(1) pair lookup | `UNIQUE (ingredient_id, drug_id)` + one join for all pairs |
| Embedded `ingredients[]` array to avoid joins | `formulation_ingredients` with real FKs |
| Contraindications as a subcollection | `contraindications` with `ON DELETE CASCADE` |
| Full-collection read + in-memory substring filter | `LIKE` against an index |
| 5 hand-declared composite indexes | Ordinary btree indexes, no declaration needed |
| No unique constraint on email (app-level check) | `UNIQUE (email)` — the race is closed |
| No foreign keys; dangling refs possible | 25 FKs; a referenced ingredient cannot be deleted |
| Chunks in Qdrant, metadata in Firestore | Both in Postgres — one transaction, no cross-store drift |
