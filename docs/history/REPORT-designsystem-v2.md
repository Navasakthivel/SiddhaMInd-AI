# SiddhaMind AI — Design System v2 browser verification

**Run date:** 2026-09-23 · **Browser:** real Google Chrome (headed, `channel: "chrome"`)
**Viewports:** 1440×900 desktop, 390×844 mobile
**Screenshots:** `react-app/e2e-screenshots/` (109 files)
**Raw data:** `e2e/results-desktop.json`, `e2e/results-actions.json`, `e2e/results-clinical.json`
**Scripts:** `e2e/run-desktop.mjs`, `e2e/run-actions.mjs`, `e2e/run-clinical.mjs`, `e2e/lib.mjs`

> Playwright's bundled Chromium could not be downloaded (network timeout to
> `storage.googleapis.com`). The runs therefore drive the **installed Google Chrome**
> via `channel: "chrome"`, which is closer to the brief than bundled Chromium anyway.

---

## 1. BUG-01 — the theme toggle and palette trigger are invisible on desktop  🔴 HIGH

**The one real UI defect found.** Both new v2 controls were placed in `Shell.jsx`'s
`<header className="sm-topbar">`. `siddhamind.css:28` declares:

```css
.sm-topbar { display: none; }          /* line 28 */
@media (max-width: 640px) {
  .sm-topbar { display: flex; }        /* line 112 — mobile only */
}
```

So at **any viewport wider than 640px** the topbar is not rendered, and with it:

| Control | Desktop (1440×900) | Mobile (390×844) |
|---|---|---|
| Theme toggle (light/dark) | **invisible, unclickable** | visible, works (`themeAfterClick: "dark"`) |
| Command palette trigger | **invisible** | visible |

Consequences:
- **Light mode is unreachable by clicking on desktop.** The only ways in are OS
  preference or a manual `localStorage` write. Every desktop light-mode screenshot in
  this run had to be produced by setting `data-theme` programmatically.
- Palette **keyboard** access still works everywhere (`Ctrl/Cmd+K` is a `window`
  listener), but the discoverable affordance is gone, and "focus returns to the
  trigger" on Escape cannot work — `focusReturned: false` for all four roles, because
  there is no visible element to return focus to.

Not fixed, per instruction. Fix direction is a judgement call — either move the two
controls into `.sm-rail`, or give `.sm-topbar-actions` its own always-visible
container. **Which of those you want is your call.**

**Related, lower severity (BUG-02, MEDIUM):** `.sm-topbar` hardcodes
`background: linear-gradient(180deg, #12132a, #0d0e1f)` — a dark-only value that does
not respond to `data-theme`. On mobile light mode the topbar stays dark. See
`e2e-screenshots/mobile/04-theme-toggled.png`.

---

## 2. Per-role × per-screen results

Legend: ✅ OK · ⚠️ issue · ❌ fail. "Console" = errors/warnings attributable to that screen.

### ADMIN (`admin@siddhamind.in`)
| Screen | Render | Console | Notes |
|---|---|---|---|
| `/login` | ✅ | clean | context panel + sliding role pill both present |
| `/admin-dashboard` | ✅ | clean | real data; no `undefined`/`NaN`; no fabricated strings |
| `/user-management` | ✅ | clean | toasts verified — see §4 |
| `/corpus-upload` | ✅ | clean | |
| `/practitioner-dashboard` | ✅ | clean | |
| `/student-dashboard` | ✅ | clean | |
| `/diagnosis-intake` | ✅ | clean | |
| `/diagnosis-results` | ✅ | clean | empty state (no reading in session) |
| `/safety-checker` | ✅ | clean | |
| `/safety-result` | ✅ | clean | empty state |
| `/formulary` | ✅ | clean | |
| `/formulary-detail` | ✅ | clean | |
| `/assistant` | ✅ | clean | |
| forbidden route | **n/a** | — | **ADMIN has no forbidden React route** — every `NAV_ITEMS` entry includes ADMIN, so step 1.7 is not applicable to this role. Reported rather than faked. |

### PRACTITIONER (`doctor@siddhamind.in`)
All 8 allowed routes ✅, console clean, no overflow.
`/access-denied` (via `/admin-dashboard`) ✅ — see §5.

### STUDENT (`student@siddhamind.in`)
All 6 allowed routes ✅, console clean.
`/access-denied` (via `/admin-dashboard`) ✅.

### PATIENT (`patient@siddhamind.in`)
All 3 allowed routes ✅ (`/formulary`, `/formulary-detail`, `/assistant`), console clean.
`/access-denied` ✅. Lands on `/formulary` after sign-in (`routeForRole` default) ✅.

---

## 3. Real-data cross-check (§1.3)

Every visible figure cross-checked against the live API in the same browser session.

| Role | `/api/auth/me` name | Rendered on screen | `/api/formulary` total | `undefined` | `NaN` | Fabricated strings |
|---|---|---|---|---|---|---|
| ADMIN | System Administrator | n/a¹ | 10 | no | no | none |
| PRACTITIONER | Dr. Meenakshi Sundaram | ✅ yes | 10 | no | no | none |
| STUDENT | Navasakthivel S M | ✅ yes | 10 | no | no | none |
| PATIENT | Public User | n/a¹ | 10 | no | no | none |

¹ AdminDashboard ("Corpus & platform health") and the formulary list legitimately do
not display a user name. Not a defect.

**Confirmed fixed in the browser:**
- StudentDashboard renders `"What would you like to do, Navasakthivel?"`,
  `FORMULATIONS YOU CAN STUDY 10`, `CONDITIONS THE CHECKER SCREENS 8`,
  `ASSISTANT Unavailable`. The old `Kavitha R. · Year 3`, `3 saved` and `1,284 entries`
  are **absent** (asserted explicitly).
- PractitionerDashboard renders `FORMULATIONS IN CORPUS 10` — the previous `NaN` is gone.

**BUG-03 — MEDIUM — institution missing until reload.** StudentDashboard's subtitle
falls back to generic copy immediately after sign-in even though `/api/auth/me` returns
`institution: "Govt Siddha Medical College, Palayamkottai"`. Cause: `Login.jsx` seeds
the context with the **login** response, which `AuthApiController.login` builds from
`describe(user)` — `userId`/`name`/`email`/`role` only. `institution` only arrives on
the later `/api/auth/me`. Cosmetic and self-healing on reload.

**BUG-04 — LOW — greeting reads "Good afternoon, Dr.".** `firstName` is
`name.split(' ')[0]`, and the seeded name is `"Dr. Meenakshi Sundaram"`.
Real data, just an awkward split.

---

## 4. Toasts (§1.8) — ✅ PASS

| Action | Toast text | Tone class | Result |
|---|---|---|---|
| ADMIN suspend | `Public User suspended` | `sm-toast sm-glass sm-toast--success` | ✅ |
| ADMIN reactivate | `Public User reactivated` | success | ✅ |
| Auto-dismiss | — | — | ✅ gone after ~5.2s |
| STUDENT safety check | `Safety check complete` | success | ✅, then navigates to `/safety-result` |
| PRACTITIONER safety check | `Safety check complete` | success | ✅ |

Button label flips `Suspend` → `Reinstate` correctly; DB status verified via API
(`ACTIVE → SUSPENDED → ACTIVE`).

**BUG-05 — MEDIUM — the acted-on row jumps position.** `adminUsers()` has no
`ORDER BY`, so after an update Postgres returns the modified row last and the list
re-renders in a different order (`rowOrderChanged: true`, observed order `3,4,5,1,2`).
The row you just clicked moves, so a second click lands on a different user. This bit
the harness and would bite a real admin doing two actions in a row.

> **Test side-effect, disclosed:** an early harness iteration suspended
> `doctor@siddhamind.in` and failed to restore it (because of BUG-05). I restored it to
> `ACTIVE` via the app's own endpoint and re-verified. `navasakthivel2005@gmail.com`
> was **already** `SUSPENDED` before this run — pre-existing, left untouched.

---

## 5. AccessDenied (§1.7) — ✅ PASS

| Check | PRACTITIONER | STUDENT | PATIENT |
|---|---|---|---|
| Forbidden URL lands on `/access-denied` | ✅ | ✅ | ✅ |
| Shows **this** role's name | ✅ | ✅ | ✅ |
| Old hardcoded "Student" gone | ✅ | ✅ | ✅ |
| Names the attempted path | ✅ | ✅ | ✅ |
| Patient column present | ✅ | ✅ | ✅ |
| "Prescribe a formula" removed | ✅ | ✅ | ✅ |
| "Override a HIGH verdict" removed | ✅ | ✅ | ✅ |
| "Back to my dashboard" → reachable | ✅ `/practitioner-dashboard` | ✅ `/student-dashboard` | ✅ `/formulary` |

---

## 6. Command palette role-scoping (§1.4) — ✅ PASS (critical check)

| Role | Items listed | Expected | Forbidden leaked | Allowed missing |
|---|---|---|---|---|
| ADMIN | 12 | 12 | **0** | 0 |
| PRACTITIONER | 8 | 8 | **0** | 0 |
| STUDENT | 6 | 6 | **0** | 0 |
| PATIENT | 3 | 3 | **0** | 0 |

Cross-checked against `AuthInterceptor.RULES`. **No role can see a screen it cannot open.**

Behaviour: opens on Ctrl+K ✅ · fuzzy `"frmly"` → `/formulary`, `/formulary-detail` ✅
(subsequence matching works) · arrow keys move selection ✅ · Enter navigates ✅ ·
Escape closes ✅ · **focus return ❌ — blocked by BUG-01** (no visible trigger to
return to).

---

## 7. Clinical rendering constraints — ✅ PASS

### Constraint 1 — verdict never opacity-gated
Sampled via `requestAnimationFrame` from before submit through settle
(`e2e/run-clinical.mjs`):

| Element | Minimum computed opacity |
|---|---|
| `.sm-risk-badge` | **1** |
| `.sm-verdict-headline` | **1** |
| `.sm-verdict-card` | **1** |
| card `transform` | `matrix(0.985, …)` → scale only |

The card animates **scale**, never opacity. ✅ `e2e-screenshots/clinical/verdict.png`

*Caveat, stated honestly:* only **1** sample frame contained the badge — the rAF budget
expired shortly after the element appeared. That frame is the first frame the badge
existed and it showed opacity 1, but this is one frame of evidence, not a curve. The
dosha evidence below is much stronger.

### Constraint 2 — dosha digits settled, rings may sweep
| Measurement | Value |
|---|---|
| Digits, first sampled frame | `["100%", "0%", "0%"]` |
| Digits, last sampled frame | `["100%", "0%", "0%"]` — **identical** |
| Digit opacity, minimum across all frames | **1** |
| Arc `stroke-dashoffset` first → last | `327 → 0` (changed) |
| Arcs visibly swept | **true** |

**Exactly the intended behaviour:** the ring animates, the number does not, and the
digits are at full opacity and final value on the first painted frame. ✅
`dosha-EARLY.png` / `dosha-SETTLED.png` (~220ms apart).

---

## 8. Reduced motion (§2.1) — ⚠️ PARTIAL PASS

| Check | Result |
|---|---|
| Palette opens under `reducedMotion: 'reduce'` | ✅ |
| Palette `transform` across 12 frames | `["none" ×12]` — **genuinely static**, not shortened ✅ |
| Theme switch | ✅ no transition |
| Page navigation | ✅ no slide |
| **Dosha arcs under reduced motion** | **NOT MEASURED** — see below |

The reduced-motion dosha probe did not collect samples (the intake form's inputs have
**no `type` attribute**, so the harness selector missed them in that block;
`rmDoshaStatic: null`). `DoshaRadial.jsx` branches on `useReducedMotion()` to start the
arc at its final offset, and the code path is straightforward, but **this specific
assertion is unverified in-browser.** It is the one gap in this report.

---

## 9. Mobile 390×844 (§2.3) — ✅ PASS

| Check | Result |
|---|---|
| Topbar visible | ✅ |
| Palette trigger visible | ✅ (visible here, unlike desktop — BUG-01) |
| Theme toggle visible and functional | ✅ → `data-theme="dark"` |
| Drawer opens via hamburger | ✅ |
| Drawer carries `.sm-glass` | ✅ |
| Computed `backdrop-filter` | `blur(20px) saturate(1.5)` ✅ |
| Escape closes drawer | ✅ |
| Backdrop click closes drawer | ✅ |

---

## 10. Console and network — verbatim

**Console errors/warnings across the entire run — exactly one distinct message:**

```
[error] ADMIN/login (and the equivalent on each role's /login)
Failed to load resource: the server responded with a status of 401 (Unauthorized)
```

**Network non-2xx — 8 occurrences, all the same call:**

```
HTTP 401   GET http://localhost:5173/api/auth/me   (on <ROLE>/login, ×2 per role)
```

**This is expected, not a defect.** `AuthProvider` asks `/api/auth/me` once on mount;
before sign-in the honest answer is 401, and `auth.jsx` treats it as "signed out", not
an error. It appears twice per role because React `StrictMode` double-invokes effects
in development. It would not occur in a production build.

**Zero** `pageerror`, zero React warnings, zero 4xx/5xx on any authenticated screen.

---

## 11. Theme, flash, and layout sweep

| Check | Result |
|---|---|
| `data-theme` at `DOMContentLoaded` vs after settle | identical for all four roles → **no flash of wrong theme** ✅ |
| Choice persisted to `localStorage` | ✅ `siddhamind:theme` |
| Survives reload | ✅ |
| Horizontal overflow, any screen either theme | **none detected** ✅ |
| Empty-body / unstyled screens | **none** ✅ |
| Dropped-CSS-rule sweep (§2.2) | every allowed route screenshotted in **both** themes (`route-light-*.png`, `route-dark-*.png`); no unstyled or overlapping regions spotted |

**Deep-route reload (§1.9):** reloading `/diagnosis-intake` mid-session restores the
session and stays on the route — **does not bounce to `/login`** ✅

---

## 12. PATIENT — honest scope statement (§1.8)

As the brief anticipated: **there is no real, backend-connected action for PATIENT to
exercise.** Per `nav.js`, PATIENT reaches only `/formulary`, `/formulary-detail` and
`/assistant`.

- Formulary browse and detail: real ✅ (4 rows rendered, detail shows Composition)
- Assistant: reachable, but `siddhamind-ai` is **not running** in this environment
  (nothing on `:8000`), so any question returns "unavailable" — correct behaviour, but
  not an action that exercises the toast/verdict paths.
- Safety checker is **not** a patient capability (`roles: ADMIN, PRACTITIONER, STUDENT`).

So PATIENT has read-only screens and nothing that writes. Reported rather than invented.

---

## Verdict summary

| Item | Status |
|---|---|
| Light-mode legibility | ⚠️ **Renders correctly and tokens resolve, but see the question below** |
| Reduced-motion compliance | ⚠️ PARTIAL — palette/theme/nav verified static; dosha arc unverified |
| Command palette role-scoping | ✅ **PASS** — 0 leaks across all 4 roles |
| Verdict rendering without opacity gating | ✅ PASS (1-frame sample — see caveat) |
| Dosha rendering without opacity gating | ✅ **PASS** — strong evidence |
| Toast correctness | ✅ PASS |
| Desktop discoverability of new controls | ❌ **FAIL — BUG-01** |

### Open bugs, not fixed
| ID | Sev | Where | Summary |
|---|---|---|---|
| BUG-01 | HIGH | `Shell.jsx` + `siddhamind.css:28,112` | Theme toggle & palette trigger inside `.sm-topbar`, which is `display:none` above 640px. Light mode unreachable by click on desktop; palette focus-return impossible. |
| BUG-02 | MED | `siddhamind.css:32` | `.sm-topbar` hardcodes a dark gradient; ignores `data-theme`. |
| BUG-03 | MED | `Login.jsx` / `AuthApiController.login` | Login response lacks `institution`; student subtitle shows fallback until reload. |
| BUG-04 | LOW | `PractitionerDashboard.jsx` | Greeting renders "Good afternoon, Dr." |
| BUG-05 | MED | `AdminService.allUsers()` | No `ORDER BY`; the row just acted on jumps to the end of the list. |

### One thing I could not judge — please decide
**Light-mode legibility of risk badges.** The tokens resolve correctly and the
re-tuned values are applied (`--risk-high: #c22f27` etc. confirmed in the built CSS),
and the screenshots render. But the only verdict I could produce in the final clinical
run was **`NORMAL` / 0 findings** — formulation index 9 + Warfarin matched no rule, so
**no HIGH or MODERATE badge was ever painted in light mode during this run.** I did not
want to assert "HIGH is legible in light mode" from a badge I never saw.

To settle it I need one HIGH-risk verdict captured in light mode. The seeded pair that
produces `HIGH` is **form_id 10 (Thiripala Churanam) + Warfarin** (MAJOR, via Turmeric).
Want me to re-run just that one case and screenshot the HIGH badge in both themes?
