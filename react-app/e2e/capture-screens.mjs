/**
 * Capture every screen into <repo>/screenshot/.
 *
 *   node e2e/capture-screens.mjs
 *
 * Headless always — this exists to produce images, not to be watched.
 *
 * Three passes: desktop 1440x900 dark, mobile 390x844 dark, and a light-theme
 * pass covering the landing page and one dashboard per role.
 *
 * Determinism notes, because a screenshot of a half-loaded page is worse than
 * no screenshot:
 *
 *  - Theme is forced through localStorage in an init script, before React
 *    mounts. ThemeProvider resolves stored-choice → OS preference → dark, so
 *    setting the stored choice is the only way to be certain which theme is
 *    painted regardless of what the host OS prefers.
 *  - Every capture waits for networkidle and then a further settle delay, so
 *    smUp/smSlide entrances (0.6-0.8s) and the dosha ring sweep (1.4s) have
 *    finished. Full-page screenshots of a mid-animation page look broken.
 *  - The diagnosis and safety runs write real rows. That is expected and the
 *    task allows it. Nothing here suspends, edits or deletes a user.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const ROOT = path.resolve('..', 'screenshot')
const SETTLE = 1500

const ACCOUNTS = {
  ADMIN: ['admin@siddhamind.in', 'admin123'],
  PRACTITIONER: ['doctor@siddhamind.in', 'doctor123'],
  STUDENT: ['student@siddhamind.in', 'student123'],
  PATIENT: ['patient@siddhamind.in', 'patient123'],
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
}

const manifest = []
const problems = []

function dirFor(pass) {
  const d = path.join(ROOT, pass)
  fs.mkdirSync(d, { recursive: true })
  return d
}

async function newCtx(browser, pass, theme) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[pass === 'light' ? 'desktop' : pass],
    colorScheme: theme,
    deviceScaleFactor: 1,
  })
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('siddhamind:theme', t) } catch { /* private mode */ }
  }, theme)
  return ctx
}

async function signIn(page, role) {
  const [email, pw] = ACCOUNTS[role]
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#lg-email', email)
  await page.fill('#lg-pw', pw)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ])
  await page.waitForLoadState('networkidle')
}

/**
 * Screenshot + record what the page actually contained.
 *
 * NOT `fullPage: true`. Playwright captures a full page by scrolling and
 * stitching, and the Shell's sidebar and topbar are fixed — so on any page
 * taller than the viewport they get composited at the scroll offset and appear
 * painted down the middle of the image. Instead the viewport is grown to the
 * document height and a single ordinary frame is taken: one paint, fixed
 * elements where they belong.
 */
async function capture(page, pass, file, meta) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(SETTLE)

  // Toasts sit over the content and are not part of the screen being captured.
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('.sm-toast-close')) b.click()
    window.scrollTo(0, 0)
  }).catch(() => {})
  await page.waitForTimeout(350)

  const base = VIEWPORTS[pass === 'light' ? 'desktop' : pass]
  const height = await page.evaluate(() => Math.ceil(Math.max(
    document.documentElement.scrollHeight, document.body.scrollHeight)))
  const tall = Math.min(Math.max(height, base.height), 6000)
  if (tall !== base.height) {
    await page.setViewportSize({ width: base.width, height: tall })
    await page.waitForTimeout(500)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(250)
  }

  const out = path.join(dirFor(pass), `${file}.png`)
  await page.screenshot({ path: out })
  if (tall !== base.height) await page.setViewportSize(base)

  const body = await page.innerText('body').catch(() => '')
  const bad = []
  if (/\bundefined\b/.test(body)) bad.push('undefined')
  if (/\bNaN\b/.test(body)) bad.push('NaN')
  if (/Could not load|Something went wrong|Failed to/i.test(body)) bad.push('error state')
  if (body.trim().length < 60) bad.push('almost empty')
  if (bad.length) problems.push({ pass, file, issues: bad.join(', ') })

  const size = fs.statSync(out).size
  manifest.push({ pass, file, ...meta, kb: Math.round(size / 1024), issues: bad.join(', ') })
  // Count on disk as well as written: a previous run reported 28 mobile images
  // while only the last 3 survived, so "wrote it" and "it is there" are tracked
  // separately until that is understood.
  const onDisk = fs.readdirSync(dirFor(pass)).filter((f) => f.endsWith('.png')).length
  console.log(`  ${pass}/${file}.png  ${String(Math.round(size / 1024)).padStart(4)}kB` +
    `  [${onDisk} on disk]` + (bad.length ? `   <-- ${bad.join(', ')}` : ''))
}

const go = async (page, p) => page.goto(`${BASE}${p}`, { waitUntil: 'networkidle' })

// --------------------------------------------------------------- flows

/** Fills the eight-fold exam and submits, landing on 11 Diagnosis result. */
async function runDiagnosis(page) {
  await go(page, '/diagnosis-intake')
  await page.waitForTimeout(800)
  await page.fill('#pt-name', 'Screenshot Patient')
  const sets = page.locator('fieldset')
  for (let i = 0; i < await sets.count(); i += 1) {
    const chip = sets.nth(i).locator('button[aria-pressed]').first()
    if (await chip.count()) await chip.click()
  }
  await page.waitForFunction(
    (w) => document.querySelectorAll('[aria-pressed="true"]').length === w, 8, { timeout: 10000 },
  ).catch(() => {})
  await page.waitForTimeout(400)
}

/** Linga Chenthuram + Furosemide + Pregnancy — the known HIGH case. */
async function fillSafety(page) {
  await go(page, '/safety-checker')
  await page.waitForTimeout(800)
  const opts = await page.locator('#sf-form option').allTextContents()
  const idx = opts.findIndex((t) => /Linga Chenthuram/i.test(t))
  await page.selectOption('#sf-form', { index: idx > 0 ? idx : 1 })
  await page.fill('#sf-drug', 'Furosemide')
  await page.keyboard.press('Enter')
  const preg = page.locator('button[aria-pressed]', { hasText: /^Pregnancy$/ }).first()
  if (await preg.count()) await preg.click()
  await page.waitForTimeout(400)
}

/** Waits until the assistant has stopped thinking and something has rendered. */
async function waitForReply(page) {
  await page.waitForFunction(() => {
    const thinking = document.querySelector('[aria-label="Assistant is thinking"]')
    const cited = document.querySelectorAll('article').length > 0
    const panel = /Not found in corpus|could not be reached|could not answer/i
      .test(document.body.innerText)
    return !thinking && (cited || panel)
  }, null, { timeout: 90000 })
  await page.waitForTimeout(3000)   // typing reveal, capped ~1.6s
}

/** Resolves real record ids so the detail pages are not guesses. */
async function resolveIds(page) {
  const list = await page.evaluate(async () =>
    (await fetch('/api/formulary', { credentials: 'include' })).json())
  const linga = list.results.find((f) => /Linga Chenthuram/i.test(f.nameEnglish)) ?? list.results[0]
  const dis = await page.evaluate(async () =>
    (await fetch('/api/formulary/diseases', { credentials: 'include' })).json())
  return { formId: linga.formId, formName: linga.nameEnglish, diseaseId: dis.diseases[0].diseaseId }
}

// --------------------------------------------------------------- passes

/**
 * Runs one capture block in isolation.
 *
 * A single slow model call must not cost the other fifty-odd screenshots, so a
 * failure is recorded as a problem and the remaining blocks still run. The
 * failure is never swallowed silently — it lands in the final report.
 */
async function block(name, fn) {
  try {
    await fn()
  } catch (e) {
    const msg = String(e).split('\n')[0]
    problems.push({ pass: '-', file: name, issues: `block failed: ${msg}` })
    console.log(`  !! ${name}: ${msg}`)
  }
}

async function mainPass(browser, pass) {
  const theme = 'dark'
  console.log(`\n=== ${pass} (${VIEWPORTS[pass].width}x${VIEWPORTS[pass].height}, ${theme}) ===`)

  // ---- public, no session ----
  await block(`public, no session [${pass}]`, async () => {
    const ctx = await newCtx(browser, pass, theme)
    const page = await ctx.newPage()
    await go(page, '/');          await capture(page, pass, '01-landing', { page: 'Landing', role: '—', shows: 'Hero, kolam + herb line-art, modules, roles' })
    await go(page, '/login');     await capture(page, pass, '02-login', { page: 'Login', role: '—', shows: 'Sign-in form, role tabs, aside artwork' })
    await go(page, '/register');  await capture(page, pass, '03-register', { page: 'Register', role: '—', shows: 'Registration form, role radio group' })
    await ctx.close()
  })

  // ---- 04 access denied: a student opening an admin route ----
  await block(`04 access denied: a student opening an admin route [${pass}]`, async () => {
    const ctx = await newCtx(browser, pass, theme)
    const page = await ctx.newPage()
    await signIn(page, 'STUDENT')
    await go(page, '/reports')
    await capture(page, pass, '04-access-denied', { page: 'Access denied', role: 'STUDENT', shows: 'Student redirected from /reports' })
    await ctx.close()
  })

  // ---- ADMIN ----
  await block(`ADMIN [${pass}]`, async () => {
    const ctx = await newCtx(browser, pass, theme)
    const page = await ctx.newPage()
    await signIn(page, 'ADMIN')
    await go(page, '/admin-dashboard'); await capture(page, pass, '05-admin-dashboard', { page: 'Admin dashboard', role: 'ADMIN', shows: 'Stat tiles, AI status, activity, corpus, recent checks/diagnoses' })

    await go(page, '/user-management'); await capture(page, pass, '06-user-management', { page: 'User management', role: 'ADMIN', shows: 'Account table with role, status, actions' })
    const createBtn = page.locator('button', { hasText: 'Create user' }).first()
    if (await createBtn.count()) {
      await createBtn.click()
      await page.waitForTimeout(600)
      await capture(page, pass, '06b-user-management-create-modal', { page: 'User management — Create user modal', role: 'ADMIN', shows: 'Modal open over the table' })
      await page.keyboard.press('Escape').catch(() => {})
    }

    await go(page, '/corpus-upload'); await capture(page, pass, '07-corpus-upload', { page: 'Corpus upload', role: 'ADMIN', shows: 'Dropzone, per-document stage stepper' })
    await go(page, '/reports');       await capture(page, pass, '08-system-reports', { page: 'System reports', role: 'ADMIN', shows: 'Role bars, counts, activity audit' })

    // command palette + mobile drawer
    await go(page, '/formulary')
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(700)
    await capture(page, pass, '22-command-palette', { page: 'Command palette', role: 'ADMIN', shows: 'Ctrl+K palette listing the role’s screens' })
    await page.keyboard.press('Escape')

    if (pass === 'mobile') {
      await go(page, '/formulary')
      const burger = page.locator('button[aria-label="Open menu"]').first()
      if (await burger.count() && await burger.isVisible()) {
        await burger.click()
        await page.waitForTimeout(700)
        await capture(page, pass, '23-mobile-drawer', { page: 'Navigation drawer', role: 'ADMIN', shows: 'Off-canvas nav open' })
      }
    }
    await ctx.close()
  })

  // ---- PRACTITIONER: dashboard, diagnosis flow, safety flow ----
  await block(`PRACTITIONER: dashboard, diagnosis flow, safety flow [${pass}]`, async () => {
    const ctx = await newCtx(browser, pass, theme)
    const page = await ctx.newPage()
    await signIn(page, 'PRACTITIONER')
    const ids = await resolveIds(page)

    await go(page, '/practitioner-dashboard'); await capture(page, pass, '09-practitioner-dashboard', { page: 'Practitioner dashboard', role: 'PRACTITIONER', shows: 'Quick actions, own diagnoses and safety checks' })

    await runDiagnosis(page)
    await capture(page, pass, '10-diagnosis-intake', { page: 'Diagnosis intake', role: 'PRACTITIONER', shows: 'All eight exam cards answered' })
    await page.click('button[type="submit"]')
    // Wait for the destination AND its content. An unchecked waitForURL once
    // let the shutter fire on the intake form mid-submit.
    // 90s, not 45s: /api/diagnosis/compute blocks on the AI summary and the
    // backend's own AI_TIMEOUT_SECONDS defaults to 60. A wait shorter than the
    // server's gives up while the server is still legitimately working.
    await page.waitForURL('**/diagnosis-results', { timeout: 90000 })
    await page.waitForFunction(
      () => /Dosha balance|Dominant kutram/i.test(document.body.innerText),
      null, { timeout: 30000 })
    await page.waitForTimeout(2200)   // ring sweep is 1.4s
    await capture(page, pass, '11-diagnosis-result', { page: 'Diagnosis result', role: 'PRACTITIONER', shows: 'Three kutram rings, settled percentages, candidates' })

    await go(page, '/diagnosis-history'); await capture(page, pass, '12-diagnosis-history', { page: 'Diagnosis history', role: 'PRACTITIONER', shows: 'Past examinations for this practitioner' })

    await fillSafety(page)
    await capture(page, pass, '13-safety-checker', { page: 'Safety checker', role: 'PRACTITIONER', shows: 'Linga Chenthuram + Furosemide + Pregnancy selected' })
    await page.click('button[type="submit"]')
    await page.waitForURL('**/safety-result', { timeout: 90000 })
    await page.waitForFunction(
      () => /HIGH RISK|ELEVATED|NORMAL/.test(document.body.innerText),
      null, { timeout: 30000 })
    await page.waitForTimeout(1200)
    await capture(page, pass, '14-safety-result', { page: 'Safety result (HIGH)', role: 'PRACTITIONER', shows: 'HIGH verdict, fired rules, dashed heavy-metal ceiling' })

    await go(page, `/formulary/${ids.formId}`)
    await capture(page, pass, '19-formulation-detail', { page: `Formulation detail (${ids.formName})`, role: 'PRACTITIONER', shows: 'Ingredients, sutthi, dose, indications, contraindications' })
    await ctx.close()
  })

  // ---- STUDENT: dashboard, knowledge screens, assistant ----
  await block(`STUDENT: dashboard, knowledge screens, assistant [${pass}]`, async () => {
    const ctx = await newCtx(browser, pass, theme)
    const page = await ctx.newPage()
    await signIn(page, 'STUDENT')
    const ids = await resolveIds(page)

    await go(page, '/student-dashboard'); await capture(page, pass, '15-student-dashboard', { page: 'Student dashboard', role: 'STUDENT', shows: 'Institution pills, study grid, past chats' })
    await go(page, '/ingredients');       await capture(page, pass, '16a-ingredients', { page: 'Ingredients', role: 'STUDENT', shows: 'Raw drugs, toxicity class, sutthi flag' })
    await go(page, '/diseases');          await capture(page, pass, '16b-diseases', { page: 'Diseases (Noi)', role: 'STUDENT', shows: 'Noi cards with kutram and preparation counts' })
    await go(page, `/disease/${ids.diseaseId}`); await capture(page, pass, '16c-disease-detail', { page: 'Disease detail', role: 'STUDENT', shows: 'One noi and the preparations indicated for it' })
    await go(page, '/formulary');         await capture(page, pass, '18-formulary', { page: 'Formulary', role: 'STUDENT', shows: 'Search, dosage-form filter, heavy-metal badges' })
    await go(page, '/profile');           await capture(page, pass, '21-profile', { page: 'Profile', role: 'STUDENT', shows: 'Account details and notifications' })

    // 20 Assistant: a cited answer, then the not-found state
    await go(page, '/assistant')
    await capture(page, pass, '20a-assistant-empty', { page: 'Assistant (opening)', role: 'STUDENT', shows: 'Empty state, status pill, suggested questions' })

    await page.fill('textarea[aria-label="Message"]', 'What is the dose of Thiripala Chooranam?')
    await page.click('button[aria-label="Send"]')
    await waitForReply(page)
    await capture(page, pass, '20b-assistant-answer', { page: 'Assistant (answer)', role: 'STUDENT', shows: 'Answer with numbered citation cards, or the offline panel' })

    await page.fill('textarea[aria-label="Message"]', 'What is the capital city of Iceland?')
    await page.click('button[aria-label="Send"]')
    await waitForReply(page)
    await capture(page, pass, '20c-assistant-not-found', { page: 'Assistant (not in corpus)', role: 'STUDENT', shows: 'Refusal panel when the corpus does not cover the question' })
    await ctx.close()
  })

  // ---- PATIENT ----
  await block(`PATIENT [${pass}]`, async () => {
    const ctx = await newCtx(browser, pass, theme)
    const page = await ctx.newPage()
    await signIn(page, 'PATIENT')
    await go(page, '/patient-dashboard')
    await capture(page, pass, '17-patient-dashboard', { page: 'Patient dashboard', role: 'PATIENT', shows: 'Heavy-metal ingredients with ceilings, plain language' })
    await ctx.close()
  })
}

/** Landing plus one dashboard per role, in light theme. */
async function lightPass(browser) {
  console.log('\n=== light (1440x900) ===')
  const theme = 'light'
  {
    const ctx = await newCtx(browser, 'light', theme)
    const page = await ctx.newPage()
    await go(page, '/')
    await capture(page, 'light', '01-landing', { page: 'Landing', role: '—', shows: 'Light theme hero' })
    await ctx.close()
  }
  const dashboards = [
    ['ADMIN', '/admin-dashboard', '05-admin-dashboard', 'Admin dashboard'],
    ['PRACTITIONER', '/practitioner-dashboard', '09-practitioner-dashboard', 'Practitioner dashboard'],
    ['STUDENT', '/student-dashboard', '15-student-dashboard', 'Student dashboard'],
    ['PATIENT', '/patient-dashboard', '17-patient-dashboard', 'Patient dashboard'],
  ]
  for (const [role, route, file, label] of dashboards) {
    const ctx = await newCtx(browser, 'light', theme)
    const page = await ctx.newPage()
    await signIn(page, role)
    await go(page, route)
    await capture(page, 'light', file, { page: label, role, shows: `Light theme ${label.toLowerCase()}` })
    await ctx.close()
  }
}

// --------------------------------------------------------------- main
/**
 * Fail before the browser starts if the stack is not up.
 *
 * A previous run spent six minutes producing nothing but
 * ERR_CONNECTION_REFUSED because the dev server had died underneath it. Better
 * to say so in one second.
 */
async function preflight() {
  const checks = [
    ['react-app', `${BASE}/`],
    ['core', 'http://localhost:8080/siddhamind/internal/health'],
    ['ai', 'http://localhost:8000/health'],
  ]
  const bad = []
  for (const [name, url] of checks) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!r.ok) bad.push(`${name} -> HTTP ${r.status}`)
    } catch (e) {
      bad.push(`${name} -> ${String(e.message ?? e).slice(0, 60)}`)
    }
  }
  if (bad.length) {
    console.error('stack is not ready:\n  ' + bad.join('\n  '))
    console.error('\nstart it with:  python scripts/run.py --no-browser')
    process.exit(1)
  }
  console.log('preflight: react-app, core and ai all responding')
}

await preflight()
fs.mkdirSync(ROOT, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  await mainPass(browser, 'desktop')
  await mainPass(browser, 'mobile')
  await lightPass(browser)
} finally {
  await browser.close()
}

fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`\n${manifest.length} screenshots written to ${ROOT}`)
if (problems.length) {
  console.log(`\n${problems.length} page(s) with issues:`)
  for (const p of problems) console.log(`  ${p.pass}/${p.file}: ${p.issues}`)
} else {
  console.log('no page showed undefined, NaN, an error state or an empty body')
}
