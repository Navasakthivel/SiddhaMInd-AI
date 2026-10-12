# SiddhaMind AI

Clinical decision support for Siddha medicine: a searchable formulary, a
rule-based drug-safety checker, Envagai Thervu (eight-fold) diagnosis, and an
assistant that answers only from a scanned Tamil pharmacopoeia — with the book,
page and verse it came from.

**The rules decide; the model only explains.** Every verdict is produced by a
deterministic engine reading the database. The language model is asked to phrase
that verdict afterwards, and if it is unreachable the verdict still stands. The
assistant answers only from indexed passages; when the corpus is silent it says
so rather than guessing. A dose that is not in the source never comes from a
model.

---

## Architecture

Three services. Postgres is Supabase and is not run locally.

| Service | Stack | Port | Role |
|---|---|---|---|
| `siddhamind-core` | Spring Boot 3.5.6, Java 21 | `8080` (context `/siddhamind`) | REST API, session auth, RBAC, rule engines, Flyway migrations |
| `siddhamind-ai` | FastAPI, Python 3.11+ | `8000` | OCR + chunking + embedding, hybrid retrieval, explanation |
| `react-app` | React 18, Vite 5 | `5173` | The user interface |

```
browser ──► react-app :5173 ──/api──► siddhamind-core :8080/siddhamind
                                            │
                                            ├──► Supabase Postgres (pgvector)
                                            └──► siddhamind-ai :8000
```

**`siddhamind-core` serves JSON only.** It has no server-rendered pages. A
request without a session gets `401`; a session whose role is not permitted gets
`403`. `/api/**` carries a JSON error body, everything else a bare status.

Authorisation lives in one place, `AuthInterceptor.RULES`. `/api` is stripped
from the path before matching, so the API and any future non-API route are
governed by the same table — two copies of an authorisation decision are two
things that can disagree, and the one that disagrees quietly is the dangerous
one.

### Key libraries

- **core** — Spring Web, Validation, Data JPA, Actuator, `spring-security-crypto`
  (BCrypt), PostgreSQL driver, Flyway (`flyway-core` + `flyway-database-postgresql`)
- **ai** — FastAPI 0.115, Uvicorn, Pydantic 2, asyncpg, pgvector, pypdf,
  pdf2image, OpenCV (headless), pytesseract, NumPy
- **web** — React 18.3, React Router 6, Framer Motion 11, Phosphor Icons,
  Vite 5, Playwright (e2e)

---

## Setup

### Prerequisites

Java 21 · Maven 3.9+ · Python 3.11+ · Node 20+ · Tesseract (with the Tamil
language pack) · Poppler (for `pdf2image`) · a Supabase Postgres project with
`pgvector` enabled.

### 1. Configure

```bash
cp .env.example .env
```

Then fill it in. `.env.example` documents every key; the ones you cannot skip:

| Key | What it is |
|---|---|
| `JAVA_DB_URL` | Supabase **transaction pooler** (`:6543`) JDBC URL — what the app runs on |
| `FLYWAY_DB_URL` | Supabase **session** connection (`:5432`) — migrations need `pg_advisory_lock`, which the pooler does not support |
| `AI_DB_DSN` | asyncpg DSN for the AI service |
| `INTERNAL_API_TOKEN` | Shared secret between core and ai. **Both sides must match** — if they disagree, every AI feature silently turns off |
| `TESSDATA_DIR` | Directory holding `tam.traineddata` / `eng.traineddata`. Exported as `TESSDATA_PREFIX`. This repo ships them in `tessdata/` |
| `UPLOAD_DIR` | Defaults to `../uploads` |

`.env` is gitignored and must never be committed. See
[`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md) for getting the two URLs.

### 2. Install

```bash
python -m venv .venv && .venv/Scripts/activate      # Windows
pip install -r siddhamind-ai/requirements.txt
cd react-app && npm install && cd ..
```

---

## Running

### All three at once (recommended)

```bash
python scripts/run.py
```

Starts ai → core → react-app in that order, waits for each to report healthy,
and opens Chrome at <http://localhost:5173>. The React client starts last
because its job is to proxy `/api` to Java: a Vite server that came up first
would spend its first seconds answering the browser with proxy errors.

Useful flags: `--no-browser`, `--no-web` (core + ai only — note there is then
**no UI at all**, since `:8080` serves JSON), `--core-port`, `--web-port`,
`--timeout`.

### Individually

```bash
# core  (needs .env loaded into the real environment; Spring does not read .env)
cd siddhamind-core && mvn spring-boot:run

# ai
uvicorn app.main:app --reload --port 8000     # from siddhamind-ai/

# web
cd react-app && npm run dev
```

### Docker

```bash
docker compose up --build
```

Brings up redis, ai, core and react-app. The AI image installs
`tesseract-ocr-tam` and `tesseract-ocr-eng` itself, so `tessdata/` is **not**
mounted — it is only for running outside Docker.

---

## Demo accounts

Seeded by `DatabaseSeeder` from `siddhamind-core/src/main/resources/seed/seed-data.json`.

| Sign in with | Password | Role | Login tab |
|---|---|---|---|
| `admin@siddhamind.in` | `admin123` | ADMIN | Admin |
| `DOC-0001` | `doctor123` | PRACTITIONER | Doctor |
| `STU-0001` | `student123` | STUDENT | Student |
| `patient@siddhamind.in` | `patient123` | PATIENT | Patient |

How each role gets in:

- **Admin** — the seeded account above, email + password. Never self-registerable.
- **Patient** — registers at `/register` (email, password of at least 8 characters),
  then signs in with email + password. This is the only account type the public
  registration endpoint creates.
- **Doctor / Student** — created by an admin in *User management*. The server
  issues a login ID (`DOC-0002`, `STU-0002`, …) and a six-digit activation code,
  shown to the admin **once**. The user opens `/activate`, enters the ID and code,
  and must choose a password (at least 8 characters) before anything else. After
  that they sign in with ID + password. *Reset password* issues a new code the
  same way and signs them out everywhere.

Five failed attempts on one ID or email lock it for 15 minutes (HTTP 429).
Suspending or resetting an account ends that user's open sessions immediately.

---

## Roles and screens

Four roles. The sidebar and the command palette (`Ctrl`/`Cmd`+`K`) both draw
from one filtered list, so neither can offer a screen the server would refuse.

| # | Screen | Route | ADMIN | PRACTITIONER | STUDENT | PATIENT |
|---|---|---|:-:|:-:|:-:|:-:|
| 01 | Landing | `/` | — public — |||
| 02 | Login | `/login` | — public — |||
| 03 | Register | `/register` | — public — |||
| 04 | Access denied | `/access-denied` | — public — |||
| 05 | Admin dashboard | `/admin-dashboard` | ✅ | | | |
| 06 | User management | `/user-management` | ✅ | | | |
| 07 | Corpus upload | `/corpus-upload` | ✅ | | | |
| 08 | System reports | `/reports` | ✅ | | | |
| 09 | Practitioner dashboard | `/practitioner-dashboard` | ✅ | ✅ | | |
| 10 | Diagnosis intake | `/diagnosis-intake` | ✅ | ✅ | | |
| 11 | Diagnosis result | `/diagnosis-results` | ✅ | ✅ | | |
| 12 | Diagnosis history | `/diagnosis-history` | ✅ | ✅ | | |
| 13 | Safety checker | `/safety-checker` | ✅ | ✅ | ✅ | |
| 14 | Safety result | `/safety-result` | ✅ | ✅ | ✅ | |
| 15 | Student dashboard | `/student-dashboard` | ✅ | | ✅ | |
| 16a | Ingredients | `/ingredients` | ✅ | ✅ | ✅ | ✅ |
| 16b | Diseases (Noi) | `/diseases` | ✅ | ✅ | ✅ | ✅ |
| 16c | Disease detail | `/disease/:id` | ✅ | ✅ | ✅ | ✅ |
| 17 | Patient dashboard | `/patient-dashboard` | ✅ | | | ✅ |
| 18 | Formulary | `/formulary` | ✅ | ✅ | ✅ | ✅ |
| 19 | Formulation detail | `/formulary/:id` | ✅ | ✅ | ✅ | ✅ |
| 20 | Assistant | `/assistant` | ✅ | ✅ | ✅ | ✅ |
| 21 | Profile | `/profile` | ✅ | ✅ | ✅ | ✅ |

23 screens across 25 routes (`/landing` aliases `/`, and `/formulary-detail`
aliases `/formulary/:id`).

### Clinical display rules

Four rules the UI must never break, each asserted in the browser by the e2e
suite rather than trusted:

1. **A verdict never fades in.** Opacity is 1 from the first frame; it may
   animate by scale only. A verdict read mid-transition is a verdict misread.
2. **Dosha percentages are settled on frame one.** The rings may sweep; the
   digits never count up — a percentage mid-count is a different reading of the
   patient than the engine produced.
3. **The heavy-metal bar is never filled.** The track is dashed and empty with a
   ceiling marker, because the ceiling is a limit, not a measured dose.
4. **Reduced motion is honoured** — `prefers-reduced-motion` renders the
   finished state, statically.

---

## Testing

```bash
cd siddhamind-core && mvn test          # 254 tests
cd react-app && npm run build           # production bundle
cd react-app && node e2e/roundC.mjs     # full browser regression (headless)
```

The e2e suite runs **headless by default**. To watch it:

```bash
cd react-app && HEADED=1 node e2e/roundC.mjs
```

`HEADED` is read once in `e2e/lib.mjs`, which every script launches through, so
the setting is in one place. It drives **real Chrome** (`channel: 'chrome'` —
the bundled Chromium cannot be downloaded here, and the system browser is the
one the app is actually used in) across all
screens × 4 roles × 1440×900 and 390×844: rendering against live API data, role
denials, sidebar/palette contents, console purity, theme, mobile overflow, the
account lifecycle and the four clinical rules. It needs core + ai + web running.

Results land in `react-app/e2e/results-roundC.json`; the report is
[`react-app/e2e/REPORT.md`](react-app/e2e/REPORT.md) and the matrix is
regenerated with `node e2e/summarise.mjs`.

The suite creates and then deactivates a throwaway `roundc.probe.*` account, and
its teardown asserts all four seeded accounts are left ACTIVE.

---

## Documentation

| Doc | Covers |
|---|---|
| [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md) | Getting the pooler and session URLs, enabling pgvector |
| [`docs/INGESTION.md`](docs/INGESTION.md) | OCR → chunk → embed pipeline, the `corpus/test-sample.pdf` fixture |
| [`docs/RETRIEVAL.md`](docs/RETRIEVAL.md) | Hybrid retrieval and citation |
| [`react-app/e2e/REPORT.md`](react-app/e2e/REPORT.md) | Latest full browser regression |
| `docs/history/` | Superseded reports and e2e scripts, kept for reference |

## Layout

```
siddhamind-core/     Spring Boot API, Flyway migrations, seed data
siddhamind-ai/       FastAPI OCR / retrieval / explanation service
react-app/           React client (src/, e2e/, public/fonts)
corpus/              Source PDFs + the committed test fixture
uploads/             Runtime upload target
tessdata/            Tesseract language packs (non-Docker runs)
design/              The HTML prototype every screen is built against
docs/                Setup and pipeline documentation
scripts/             run.py (whole stack), verify-supabase.sh, fixture tools
```

---

*Education and decision support. Not a prescription.*
