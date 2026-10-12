import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'

export const BASE = 'http://localhost:5173'
export const SHOTS = 'e2e-screenshots'

/**
 * Headless unless HEADED says otherwise.
 *
 *   node e2e/roundC.mjs             # headless, no windows
 *   HEADED=1 node e2e/roundC.mjs    # watch it run
 *
 * Every script launches through here so the setting is one line, not one per
 * file. `channel: 'chrome'` stays: this machine cannot download Playwright's
 * bundled Chromium, so the system Chrome is the only browser available - and
 * it is also the browser the app is actually used in, which is worth more than
 * a pinned build.
 *
 * Headless is the default because a visible window is slow, steals focus, and
 * - on the evidence of this suite - is what was dying mid-run with "Target
 * page, context or browser has been closed". Nothing the suite measures needs
 * a window: viewport, prefers-reduced-motion and prefers-color-scheme are all
 * context options, and screenshots and document.getAnimations() work either way.
 */
export const HEADED = !['', '0', 'false', 'no'].includes(
  String(process.env.HEADED ?? '').toLowerCase())

export function launchBrowser(options = {}) {
  return chromium.launch({ channel: 'chrome', headless: !HEADED, ...options })
}

/**
 * The four seeded demo accounts. `id` is what goes in the login form: an email
 * for admin and patient, the issued login ID for doctor and student. `email`
 * stays the real address, which is what the admin user list shows.
 */
export const ACCOUNTS = [
  { role: 'ADMIN',        id: 'admin@siddhamind.in',   email: 'admin@siddhamind.in',   password: 'admin123'   },
  { role: 'PRACTITIONER', id: 'DOC-0001',              email: 'doctor@siddhamind.in',  password: 'doctor123'  },
  { role: 'STUDENT',      id: 'STU-0001',              email: 'student@siddhamind.in', password: 'student123' },
  { role: 'PATIENT',      id: 'patient@siddhamind.in', email: 'patient@siddhamind.in', password: 'patient123' },
]

export const ROLES = ACCOUNTS.map((a) => a.role)

const ALL = ['ADMIN', 'PRACTITIONER', 'STUDENT', 'PATIENT']
const PRAC = ['PRACTITIONER', 'ADMIN']
const CLIN = ['ADMIN', 'PRACTITIONER', 'STUDENT']

/**
 * All 23 numbered screens.
 *
 * `roles` mirrors nav.js, which in turn mirrors AuthInterceptor.RULES - the
 * interceptor strips /api and matches the remainder against the same table the
 * pages use, so one list governs both. A screen listed here with the wrong
 * roles would make this suite agree with a bug rather than catch it, so the
 * matrix is cross-checked against nav.js by roundC.mjs before anything runs.
 *
 * `auth: false` marks the four pre-auth screens. `dynamic` marks a path that
 * needs a real record id resolved from the API at run time.
 */
export const SCREENS = [
  { id: '01', name: 'Landing',              path: '/',                      auth: false },
  { id: '02', name: 'Login',                path: '/login',                 auth: false },
  { id: '03', name: 'Register',             path: '/register',              auth: false },
  { id: '04', name: 'Access denied',        path: '/access-denied',         auth: false },

  { id: '05', name: 'Admin dashboard',      path: '/admin-dashboard',       roles: ['ADMIN'] },
  { id: '06', name: 'User management',      path: '/user-management',       roles: ['ADMIN'] },
  { id: '07', name: 'Corpus upload',        path: '/corpus-upload',         roles: ['ADMIN'] },
  { id: '08', name: 'System reports',       path: '/reports',               roles: ['ADMIN'] },
  { id: '09', name: 'Practitioner dash',    path: '/practitioner-dashboard', roles: PRAC },
  { id: '10', name: 'Diagnosis intake',     path: '/diagnosis-intake',      roles: PRAC },
  { id: '11', name: 'Diagnosis result',     path: '/diagnosis-results',     roles: PRAC, mayBeEmpty: true },
  { id: '12', name: 'Diagnosis history',    path: '/diagnosis-history',     roles: PRAC },
  { id: '13', name: 'Safety checker',       path: '/safety-checker',        roles: CLIN },
  { id: '14', name: 'Safety result',        path: '/safety-result',         roles: CLIN, mayBeEmpty: true },
  { id: '15', name: 'Student dashboard',    path: '/student-dashboard',     roles: ['STUDENT', 'ADMIN'] },
  { id: '16a', name: 'Ingredients',         path: '/ingredients',           roles: ALL },
  { id: '16b', name: 'Diseases',            path: '/diseases',              roles: ALL },
  { id: '16c', name: 'Disease detail',      path: '/disease/:id',           roles: ALL, dynamic: 'disease' },
  { id: '17', name: 'Patient dashboard',    path: '/patient-dashboard',     roles: ['PATIENT', 'ADMIN'] },
  { id: '18', name: 'Formulary',            path: '/formulary',             roles: ALL },
  { id: '19', name: 'Formulation detail',   path: '/formulary/:id',         roles: ALL, dynamic: 'formulation' },
  { id: '20', name: 'Assistant',            path: '/assistant',             roles: ALL },
  { id: '21', name: 'Profile',              path: '/profile',               roles: ALL },
]

/** Screens that require a session. */
export const AUTHED = SCREENS.filter((s) => s.auth !== false)

export const allowedFor = (role) => AUTHED.filter((s) => s.roles.includes(role))
export const deniedFor = (role) => AUTHED.filter((s) => !s.roles.includes(role))

/**
 * Sidebar entries per role, mirroring nav.js NAV_ITEMS.
 *
 * Separate from SCREENS because not every screen is in the sidebar: profile,
 * the two result screens and the detail pages are routed but off-nav, and a
 * sidebar that listed them would be wrong in the other direction.
 */
export const NAV_LABELS = {
  ADMIN: ['Admin dashboard', 'User management', 'Corpus', 'System reports',
          'Practitioner view', 'Student view', 'Home',
          'New examination', 'Diagnosis history', 'Safety checker',
          'Formulary', 'Ingredients', 'Diseases (Noi)', 'Assistant'],
  PRACTITIONER: ['Dashboard', 'New examination', 'Diagnosis history', 'Safety checker',
                 'Formulary', 'Ingredients', 'Diseases (Noi)', 'Assistant'],
  STUDENT: ['Dashboard', 'Safety checker', 'Formulary', 'Ingredients', 'Diseases (Noi)', 'Assistant'],
  PATIENT: ['Home', 'Formulary', 'Ingredients', 'Diseases (Noi)', 'Assistant'],
}

/**
 * Text that must never reach a rendered page.
 *
 * Word-bounded regexes, not substrings. A naive case-insensitive
 * `includes('nan')` flagged the formulation "Nandukkal Parpam" as a rendered
 * NaN — the matcher was wrong, not the screen. `NaN` and `undefined` are
 * matched case-sensitively for the same reason.
 *
 * The bracketed entries are the static prototype's own placeholder copy; the
 * named ones are fabrications that shipped in earlier rounds and were removed.
 * Any of them reappearing means a screen regressed to demo content.
 */
export const FORBIDDEN_TEXT = [
  { label: 'NaN', re: /\bNaN\b/ },
  { label: 'undefined', re: /\bundefined\b/ },
  { label: '[placeholder]', re: /\[placeholder\]/i },
  { label: '[… from record]', re: /\[[a-z ]*from record\]/i },
  { label: '[page] / [verse]', re: /\[(page|verse|n)\]/i },
  { label: 'lorem ipsum', re: /lorem ipsum/i },
  { label: 'Kavitha (fabricated student)', re: /\bKavitha\b/i },
  { label: 'Year 3 (fabricated)', re: /\bYear 3\b/i },
  { label: '1,284 (fabricated count)', re: /\b1,284\b/ },
  { label: 'Dr. Anitha (fabricated)', re: /\bDr\.?\s*Anitha\b/i },
  { label: 'Corpus v2.4 (fabricated)', re: /Corpus v2\.4/i },
  { label: 'awaiting sign-off (fabricated queue)', re: /awaiting sign-off/i },
  { label: 'prototype template syntax', re: /hint-placeholder|<sc-(for|if)|\{\{\s*\w/ },
]

/** Returns the labels of every forbidden pattern present in `text`. */
export const forbiddenIn = (text) =>
  FORBIDDEN_TEXT.filter((f) => f.re.test(text)).map((f) => f.label)

/** Collects console + network problems for one page, for the whole run. */
export function attachCollectors(page, state) {
  page.on('console', (msg) => {
    const type = msg.type()
    if (type !== 'error' && type !== 'warning') return
    state.console.push({
      screen: state.screen, type, text: msg.text(),
      location: msg.location()?.url ? `${msg.location().url}:${msg.location().lineNumber}` : '',
    })
  })
  page.on('pageerror', (err) => {
    state.console.push({ screen: state.screen, type: 'pageerror', text: String(err?.stack || err), location: '' })
  })
  page.on('requestfailed', (req) => {
    state.network.push({
      screen: state.screen, url: req.url(),
      method: req.method(), failure: req.failure()?.errorText ?? 'unknown',
    })
  })
  page.on('response', (res) => {
    if (res.status() >= 400) {
      state.network.push({
        screen: state.screen, url: res.url(),
        method: res.request().method(), failure: `HTTP ${res.status()}`,
      })
    }
  })
}

export async function shot(page, dir, name) {
  const out = path.join(SHOTS, dir)
  fs.mkdirSync(out, { recursive: true })
  const file = path.join(out, `${name}.png`)
  // Route transitions, the tab pill and the strength bars all animate for up
  // to ~0.6s; a shot taken inside that window shows two pages overlapping.
  await page.waitForTimeout(900)
  await page.screenshot({ path: file, fullPage: false })
  return file
}

/** The login tab an identifier belongs on. Admin and Patient both take an email. */
export function tabFor(identifier, role) {
  if (/^DOC-/i.test(identifier)) return 'Doctor'
  if (/^STU-/i.test(identifier)) return 'Student'
  return role === 'PATIENT' ? 'Patient' : 'Admin'
}

/**
 * Signs in through the real form: picks the tab the identifier belongs on,
 * then fills Login.jsx's #lg-id / #lg-pw.
 */
export async function login(page, identifier, password, role) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: tabFor(identifier, role), exact: true }).click()
  await page.fill('#lg-id', identifier)
  await page.fill('#lg-pw', password)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 25000 }),
    page.click('button[type="submit"]'),
  ])
  await page.waitForLoadState('networkidle')
}

export const loginAs = (page, role) => {
  const a = ACCOUNTS.find((x) => x.role === role)
  return login(page, a.id, a.password, a.role)
}

/**
 * Reads the live API with the browser's own session cookie.
 *
 * Through the vite proxy on :5173, NOT directly at :8080. JSESSIONID is set on
 * the :5173 origin with its path rewritten to /, so a cross-origin fetch to
 * :8080 carries no cookie and answers 401 - which looks exactly like the app
 * being broken when it is the probe that is wrong.
 */
export async function apiJson(page, endpoint) {
  return page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'include' })
    if (!r.ok) return { __status: r.status }
    return r.json()
  }, endpoint)
}

export async function apiPost(page, endpoint, body) {
  return page.evaluate(async ([url, payload]) => {
    const r = await fetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    let data = null
    try { data = await r.json() } catch { /* 204 */ }
    return { status: r.status, data }
  }, [endpoint, body])
}

/**
 * Hard-deletes test accounts (and their rows) from the database, then resets
 * the login-ID sequences, via scripts/PruneUsers.java - the same tool used for
 * manual cleanups. There is no delete endpoint in the API, so this goes to the
 * database directly over MIGRATION_DB_URL from the repo's .env.
 *
 * The tool refuses - and rolls back the whole transaction - if any address is
 * a demo account or not an @example.invalid test address, so a bug here cannot
 * delete a real user. Returns { ok, deleted, output }.
 */
export function deleteTestUsers(emails) {
  if (!emails.length) return { ok: true, deleted: 0, output: '' }
  const repo = path.resolve(import.meta.dirname, '..', '..')
  const jar = path.join(os.homedir(), '.m2', 'repository', 'org', 'postgresql',
    'postgresql', '42.7.7', 'postgresql-42.7.7.jar')
  const r = spawnSync('java', ['-cp', jar, path.join('scripts', 'PruneUsers.java'),
    'delete-emails', emails.join(','), '--reset-sequences'],
  { cwd: repo, encoding: 'utf8', timeout: 120000 })
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.split(/\r?\n/)
    .filter((l) => !l.startsWith('WARNING')).join('\n')
  const m = output.match(/Deleted (\d+) user/)
  return { ok: r.status === 0 && Boolean(m), deleted: m ? Number(m[1]) : 0, output }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}
