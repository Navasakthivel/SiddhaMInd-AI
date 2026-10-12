# Round B3 — the last eight screens, then cleanup

Verified in real Chrome (`channel: 'chrome'`, headed), four roles, 1440 and 390.
**200/200 checks passed.** Re-run with `node e2e/roundB3.mjs`; raw output in
`results-roundB3.json`, screenshots in `e2e-screenshots/b3-1440/` and `b3-390/`.

| Gate | Result |
|---|---|
| `npm run build` | pass, no warnings other than the pre-existing chunk-size advisory |
| `mvn test` | 303 tests, 0 failures, 0 errors (run from deleted `target/*.class` and a wiped `surefire-reports`) |
| Browser checks | 200/200 across 8 role×viewport runs |
| Legacy tokens referenced | 0 |
| `sm-*` classes with no rule | 0 |
| CSS rules never applied | 0 |
| Bundled CSS | 57.60 kB → 26.53 kB (gzip 11.27 → 5.83) |

---

## Screens

**05 Admin dashboard** — five tiles rendered final (no count-up: a tile still
climbing shows a number that is not the real one), AI pill from the probed
`/assistant/status`, activity timeline, corpus table, and the two recent panels
fed by `recentChecks`/`recentDiagnoses`. Tile values checked against the same
`/api/admin/stats` the page loaded.

**06 User management** — Create-user modal, Suspend/Reinstate, Reset password.
Row order verified stable across a full Suspend → Reinstate cycle: the acted-on
account holds index 3 before, after the suspend and after the reinstate. The
screen never reorders or patches rows locally; it re-reads
`findAllByOrderByUserIdAsc()`, so a server-side regression would surface rather
than be masked.

**07 Corpus upload** — drag-and-drop, per-document status, Start indexing /
Retry. Two places the design asks for something the pipeline cannot support:

- *No percentage.* The pipeline writes its row exactly twice — `RUNNING` at the
  start, the final status at the end — and `indexed` is a boolean, not a page
  counter. The bar is indeterminate (`smIndet` sweeps; it does not fill).
  Asserted: no `\d{1,3}%` anywhere on the screen.
- *Three stages, not five.* The prototype draws Uploaded / OCR / Chunk / Embed /
  Indexed, but the server reports one undivided `RUNNING` covering the middle
  three. Lighting them in sequence would invent four transitions, so the middle
  step is named for the work it contains. Asserted: 7 steppers for 7 documents,
  every one with exactly 3 stages.

`stalled` gets its own state — a row left at `RUNNING` by a service that
restarted mid-ingest is byte-identical to one still working.

**09 Practitioner dashboard** — three quick actions plus the practitioner's own
diagnoses and safety checks from `/api/practitioner/dashboard` (20 and 16 rows
for `doctor@`). The old invented "awaiting sign-off" queue is asserted absent.

**15 Student dashboard** — institution and registration pills from the session,
study grid from `/api/formulary` (10 cards = `total` 10), past chats from
`/api/student/dashboard`. The fabricated "Kavitha R. · Year 3" and "1,284
entries" are asserted absent.

**18 Formulary** — server-side search over English, Tamil and SFI code. The
dosage-form filter is built from the dosage forms present in the results, not a
hardcoded list; asserted equal to the distinct values on the wire
(Chenthuram, Churanam, Kudineer, Parpam) and that picking one narrows to the
right count. Heavy-metal badge count matches the data (3).

**19 Formulation detail** — ingredients with sutthi notes, dose/anupanam/shelf
life, contraindications, and the `indications` added in Round B2 (its own query,
because `Formulation.indications` is LAZY with `open-in-view` false). Asserted:
every indicated noi is rendered, and no `p. null` where a page was never
transcribed.

**20 Assistant** — past-chats rail (≥900px) or strip (<900px), exactly one of
the two ever in the layout; citations as numbered cards; distinct panels for
*cited*, *not found in corpus*, server *error* and transport *offline*.

Two deliberate omissions, both asserted:
- **No match score.** The server strips it on purpose — it is an RRF fusion
  rank, and a number beside a source reads as confidence in the answer.
- **"Not found" is not an error.** An outage rendered as "the books do not cover
  this" would be a false negative about the corpus.

The typing reveal is presentation only: `/ask` is a single POST, the whole
answer is in hand before the first character appears, it is capped near 1.6s and
skipped entirely under `prefers-reduced-motion`.

---

## Cleanup

- **Legacy token bridge removed** from `tokens.css` (61 lines, 33 aliases). Every
  consumer was migrated to the palette first, using the bridge's own mapping, so
  nothing changed colour. `--risk-high` → `--red` was carried over literally.
- **`siddhamind.css` 730 → 149 lines**, **`v2.css` 277 → 221**. Both files are
  still referenced, so neither was deleted. Pruning was done with a brace-aware
  walker, not a regex — a regex loses track inside `@media` and deletes half a
  block.
- **Duplicate `.sm-card`** removed from `siddhamind.css`; it loaded after
  `tokens.css` and silently overrode the Round-B card surface.
- **Five dangling keyframe references** (`fadeUp`, `fadeIn`, `glowOnce`,
  `alertOnce`, `wave`) remapped onto the `smX` set. None of the five was defined
  anywhere in `src` — they had been dead since before this round, so those
  animations simply never ran.
- **Dead selectors** `sm-kbdset`, `sm-trigger-label`, `sm-drawer`, `is-active`,
  `is-dragover`, `sm-topbar` (the BUG-01 rule) and ~185 others deleted.
- **`sm-numeric`** removed from `DoshaRadial.jsx` — it never had a rule, and the
  element it was on already sets `tabular-nums`.

### One real bug the cleanup surfaced

`.sm-glass` is applied by the command palette and the toast viewport but **was
never defined**. The only rule that mentioned it was `.sm-drawer.sm-glass`,
which set a border on drawers alone. Both floating surfaces have therefore been
rendering fully transparent since Round A. Measured in Chrome before the fix:

```
background: rgba(0, 0, 0, 0)   backdrop-filter: none   box-shadow: none
```

Now defined in `v2.css`, scoped to floating surfaces per the v2 rule that glass
never touches a page or content surface, with an opaque `@supports` fallback.
Measured after:

```
background: rgba(250, 246, 236, 0.7)   backdrop-filter: blur(16px) saturate(1.4)
box-shadow: rgba(15, 42, 33, 0.16) 0 26px 60px
```

---

## Console and network

16 console errors and 24 network entries, all accounted for and none from an
authenticated screen:

- **16 × `GET /api/auth/me` 401** — the app's own boot check on the login page
  with no session (8 browser contexts × 2 page loads). Correct behaviour.
- **8 × `POST /api/auth/logout` ERR_ABORTED** — the harness closing each context
  while the logout is still in flight. A harness artefact.

## Things done to the environment

- **The backend was restarted.** The JVM on :8080 predated the Round B2 change
  and was serving `/api/formulary/{id}` without `indications`, which the source
  and the test suite both had. It is now running the current source, started
  with `.env` loaded.
- **`patient@siddhamind.in` was briefly left SUSPENDED** by an earlier iteration
  of the harness whose restore click went unconfirmed, which then blocked the
  PATIENT logins. It was reactivated through the app's own endpoint and sign-in
  re-verified. The harness now forces the status back through the API and
  re-reads it, so a failed click can no longer lock an account out.
- **`navasakthivel2005@gmail.com` (user 5) is SUSPENDED and was left that way** —
  it was already suspended before this run.

Final state: users 1–4 ACTIVE, all three non-admin seeded accounts verified able
to sign in.
