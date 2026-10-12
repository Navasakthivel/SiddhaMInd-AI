import { chromium } from 'playwright'
import { BASE, attachCollectors, shot, writeJson } from './lib.mjs'

const results = { console: [], network: [], roles: {}, reducedMotion: {}, mobile: {}, findings: [] }
const state = { screen: 'boot', console: results.console, network: results.network }
const note = (severity, area, text) => results.findings.push({ severity, area, text })

import fs from 'node:fs'
fs.mkdirSync('e2e-screenshots/_failures', { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: false })

async function signIn(page, email, pw) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-id', email)
  await page.fill('#login-password', pw)
  await page.click('button.sm-btn-status')
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 })
  await page.waitForLoadState('networkidle')
  await page.locator('body').click({ position: { x: 4, y: 4 } }).catch(() => {})
}

/* ══════════════════════════════ ADMIN: toasts ══════════════════════════════ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage(); attachCollectors(page, state)
  try {
  const R = {}; results.roles.ADMIN = R
  state.screen = 'ADMIN/user-management'
  await signIn(page, 'admin@siddhamind.in', 'admin123')
  await page.goto(`${BASE}/user-management`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)

  // Act on the PATIENT account: the doctor/student accounts are used by later
  // blocks in this same run, and a suspended account cannot sign in.
  const TARGET_EMAIL = 'patient@siddhamind.in'

  // Re-query the row every time. adminUsers() returns no ORDER BY, so after an
  // update Postgres hands the modified row back last and the row moves - a
  // locator captured before the click points at a different user afterwards.
  const rowFor = async (email) => {
    const rows = page.locator('.sm-table-row')
    const n = await rows.count()
    for (let i = 0; i < n; i += 1) {
      if ((await rows.nth(i).innerText()).includes(email)) return rows.nth(i)
    }
    return null
  }
  const statusOf = async (email) => page.evaluate(async (e) => {
    const r = await fetch('/api/admin/users', { credentials: 'include' })
    const j = await r.json()
    return j.users.find((u) => u.email === e)?.status ?? null
  }, email)
  const orderOf = async () => page.evaluate(async () => {
    const r = await fetch('/api/admin/users', { credentials: 'include' })
    return (await r.json()).users.map((u) => u.email)
  })

  R.statusBefore = await statusOf(TARGET_EMAIL)
  R.listOrderBefore = await orderOf()

  let row = await rowFor(TARGET_EMAIL)
  if (!row) { R.error = 'target row not found'; note('HIGH', 'ADMIN user-management', 'target row not found') }
  else {
    R.buttonLabelBefore = await row.locator('button').first().innerText().catch(() => null)
    await row.locator('button').first().click()
    await page.waitForTimeout(1000)
    R.toast1 = await page.locator('.sm-toast').first().innerText().catch(() => null)
    R.toast1Class = await page.locator('.sm-toast').first().getAttribute('class').catch(() => null)
    R.shot1 = await shot(page, state, 'admin', '08-toast-suspend')
    R.statusAfterFirst = await statusOf(TARGET_EMAIL)
    R.listOrderAfter = await orderOf()
    R.rowOrderChanged = JSON.stringify(R.listOrderBefore) !== JSON.stringify(R.listOrderAfter)

    await page.waitForTimeout(5200)
    R.toastAutoDismissed = (await page.locator('.sm-toast').count()) === 0

    row = await rowFor(TARGET_EMAIL)   // fresh locator: the row may have moved
    R.buttonLabelAfter = await row?.locator('button').first().innerText().catch(() => null)
    await row?.locator('button').first().click()
    await page.waitForTimeout(1000)
    R.toast2 = await page.locator('.sm-toast').first().innerText().catch(() => null)
    R.shot2 = await shot(page, state, 'admin', '09-toast-reactivate')
    R.statusAfterSecond = await statusOf(TARGET_EMAIL)

    if (!R.toast1 || !R.toast2) note('HIGH', 'ADMIN user-management', 'expected two toasts, got ' + JSON.stringify([R.toast1, R.toast2]))
    if (R.statusAfterSecond !== R.statusBefore) {
      note('HIGH', 'ADMIN user-management', `account not restored: ${R.statusBefore} -> ${R.statusAfterSecond}`)
      // Leave the environment as we found it regardless of what the UI did.
      await page.evaluate(async (e) => {
        const r = await fetch('/api/admin/users', { credentials: 'include' })
        const u = (await r.json()).users.find((x) => x.email === e)
        if (u) await fetch(`/api/admin/users/${u.userId}/status`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ACTIVE' }),
        })
      }, TARGET_EMAIL)
    }
  }

  } catch (e) {
    const where = String(e?.message || e).split(String.fromCharCode(10))[0]
    note('HARNESS', state.screen, `step failed: ${where}`)
    try {
      const R2 = results.roles[Object.keys(results.roles).pop()]
      if (R2) { R2.harnessError = where; R2.urlAtFailure = page.url() }
      await page.screenshot({ path: `e2e-screenshots/_failures/${state.screen.replace(/[^a-z0-9]/gi, '_')}.png` })
    } catch { /* nothing more to record */ }
  }
  await ctx.close()
}

/* ═════════════════ PRACTITIONER: verdict + dosha rendering ═════════════════ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage(); attachCollectors(page, state)
  try {
  const R = {}; results.roles.PRACTITIONER = R
  await signIn(page, 'doctor@siddhamind.in', 'doctor123')

  /* ---- safety check: form 10 (Thiripala Churanam) + Warfarin = MAJOR ---- */
  state.screen = 'PRACTITIONER/safety-checker'
  await page.goto(`${BASE}/safety-checker`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  R.safetyControls = await page.evaluate(() => ({
    selects: [...document.querySelectorAll('select')].map((s) => ({ name: s.name, options: s.options.length })),
    inputs: [...document.querySelectorAll('input')].map((i) => ({ name: i.name, type: i.type })),
  }))
  const sel = page.locator('select').first()
  await sel.selectOption({ index: 1 }).catch(() => {})
  R.chosenFormulation = await sel.inputValue().catch(() => null)
  const drugInput = page.locator('input[type="text"]').first()
  await drugInput.fill('Warfarin')
  R.safetySubmitEnabled = await page.locator('button[type="submit"]').first().isEnabled().catch(() => null)
  await shot(page, state, 'practitioner', '08-safety-form')

  // Sample the verdict's computed opacity from the instant it exists.
  await page.evaluate(() => {
    window.__opacitySamples = []
    const tick = () => {
      const badge = document.querySelector('.sm-risk-badge')
      const head = document.querySelector('.sm-verdict-headline')
      const card = document.querySelector('.sm-verdict-card')
      if (badge || head) {
        window.__opacitySamples.push({
          t: Math.round(performance.now()),
          badge: badge ? parseFloat(getComputedStyle(badge).opacity) : null,
          headline: head ? parseFloat(getComputedStyle(head).opacity) : null,
          card: card ? parseFloat(getComputedStyle(card).opacity) : null,
          cardTransform: card ? getComputedStyle(card).transform : null,
        })
      }
      if (window.__opacitySamples.length < 60) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.locator('button[type="submit"], .sm-btn-primary').first().click()
  await page.waitForTimeout(450)
  R.safetyToast = await page.locator('.sm-toast').first().innerText().catch(() => null)
  await page.waitForTimeout(1400)
  R.verdictUrl = new URL(page.url()).pathname
  R.opacitySamples = await page.evaluate(() => window.__opacitySamples ?? [])
  R.verdictText = await page.locator('.sm-verdict-card').innerText().catch(() => null)
  R.shotVerdict = await shot(page, state, 'practitioner', '09-verdict')
  const badgeOps = R.opacitySamples.map((s) => s.badge).filter((v) => v !== null)
  R.verdictMinBadgeOpacity = badgeOps.length ? Math.min(...badgeOps) : null
  R.verdictOpacityGated = badgeOps.length ? Math.min(...badgeOps) < 0.99 : null
  if (R.verdictOpacityGated) {
    note('CRITICAL', 'PRACTITIONER safety-result', `risk badge animated opacity (min ${R.verdictMinBadgeOpacity}) - violates constraint 1`)
  }

  /* ---- diagnosis: dosha arcs sweep, digits final ---- */
  state.screen = 'PRACTITIONER/diagnosis-intake'
  await page.goto(`${BASE}/diagnosis-intake`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  // The form has no name attributes; the first required text input is the
  // patient name, and every select must be answered before submit enables.
  await page.locator('input[type="text"]').first().fill('E2E Test Patient')
  const selects = page.locator('select')
  const sc = await selects.count()
  for (let i = 0; i < sc; i += 1) {
    await selects.nth(i).selectOption({ index: 1 }).catch(() => {})
  }
  await page.waitForTimeout(300)
  R.submitEnabled = await page.locator('button[type="submit"]').first().isEnabled()
  R.selectCount = sc
  await shot(page, state, 'practitioner', '10-diagnosis-form')
  // Start sampling BEFORE submit so the first painted frame is captured.
  await page.evaluate(() => {
    window.__dosha = []
    const tick = () => {
      const arcs = [...document.querySelectorAll('.sm-dosha-ring-wrap svg circle')].slice(1)
      const vals = [...document.querySelectorAll('.sm-dosha-ring-value')]
      if (vals.length) {
        window.__dosha.push({
          t: Math.round(performance.now()),
          offsets: arcs.map((c) => parseFloat(getComputedStyle(c).strokeDashoffset) || 0),
          digits: vals.map((v) => v.textContent.trim()),
          digitOpacity: vals.map((v) => parseFloat(getComputedStyle(v).opacity)),
        })
      }
      if (window.__dosha.length < 70) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(400)
  R.diagnosisToast = await page.locator('.sm-toast').first().innerText().catch(() => null)
  R.shotDoshaEarly = await shot(page, state, 'practitioner', '11-dosha-EARLY')
  await page.waitForTimeout(1200)
  R.shotDoshaSettled = await shot(page, state, 'practitioner', '12-dosha-SETTLED')
  R.doshaSamples = await page.evaluate(() => window.__dosha ?? [])
  R.doshaUrl = new URL(page.url()).pathname

  if (R.doshaSamples.length) {
    const first = R.doshaSamples[0], last = R.doshaSamples[R.doshaSamples.length - 1]
    R.doshaFirstDigits = first.digits
    R.doshaLastDigits = last.digits
    R.doshaDigitsStableFromFirstFrame = JSON.stringify(first.digits) === JSON.stringify(last.digits)
    R.doshaDigitOpacityMin = Math.min(...R.doshaSamples.flatMap((s) => s.digitOpacity))
    R.doshaFirstOffsets = first.offsets
    R.doshaLastOffsets = last.offsets
    R.doshaArcsSwept = JSON.stringify(first.offsets) !== JSON.stringify(last.offsets)
    if (!R.doshaDigitsStableFromFirstFrame) {
      note('CRITICAL', 'PRACTITIONER diagnosis-results', `dosha digits changed during animation: ${JSON.stringify(first.digits)} -> ${JSON.stringify(last.digits)} - violates constraint 2`)
    }
    if (R.doshaDigitOpacityMin < 0.99) {
      note('CRITICAL', 'PRACTITIONER diagnosis-results', `dosha digits animated opacity (min ${R.doshaDigitOpacityMin})`)
    }
    if (!R.doshaArcsSwept) note('LOW', 'PRACTITIONER diagnosis-results', 'arcs did not visibly sweep (already at final offset on first sample)')
  }

  /* ---- 1.9 reload on a deep route ---- */
  state.screen = 'PRACTITIONER/reload'
  await page.goto(`${BASE}/diagnosis-intake`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  R.reloadLandedOn = new URL(page.url()).pathname
  R.reloadBouncedToLogin = R.reloadLandedOn === '/login'
  R.shotReload = await shot(page, state, 'practitioner', '13-after-reload')
  if (R.reloadBouncedToLogin) note('HIGH', 'PRACTITIONER reload', 'deep-route reload bounced to /login')


  } catch (e) {
    const where = String(e?.message || e).split(String.fromCharCode(10))[0]
    note('HARNESS', state.screen, `step failed: ${where}`)
    try {
      const R2 = results.roles[Object.keys(results.roles).pop()]
      if (R2) { R2.harnessError = where; R2.urlAtFailure = page.url() }
      await page.screenshot({ path: `e2e-screenshots/_failures/${state.screen.replace(/[^a-z0-9]/gi, '_')}.png` })
    } catch { /* nothing more to record */ }
  }
  await ctx.close()
}

/* ══════════════════════ STUDENT: safety check + empty state ════════════════ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage(); attachCollectors(page, state)
  try {
  const R = {}; results.roles.STUDENT = R
  state.screen = 'STUDENT/safety'
  await signIn(page, 'student@siddhamind.in', 'student123')
  const dashText = await page.locator('body').innerText()
  R.pastChecksEmptyState = /past checks are not listed yet/i.test(dashText)
  R.noFabricatedCount = !/3 saved|1,284/.test(dashText)
  R.shotDash = await shot(page, state, 'student', '08-dashboard')

  await page.goto(`${BASE}/safety-checker`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.locator('select').first().selectOption({ index: 1 }).catch(() => {})
  await page.locator('input[type="text"]').first().fill('Warfarin').catch(() => {})
  await page.locator('button[type="submit"], .sm-btn-primary').first().click()
  await page.waitForTimeout(500)
  R.toast = await page.locator('.sm-toast').first().innerText().catch(() => null)
  R.shotToast = await shot(page, state, 'student', '09-safety-toast')
  await page.waitForTimeout(1300)
  R.landedOn = new URL(page.url()).pathname

  } catch (e) {
    const where = String(e?.message || e).split(String.fromCharCode(10))[0]
    note('HARNESS', state.screen, `step failed: ${where}`)
    try {
      const R2 = results.roles[Object.keys(results.roles).pop()]
      if (R2) { R2.harnessError = where; R2.urlAtFailure = page.url() }
      await page.screenshot({ path: `e2e-screenshots/_failures/${state.screen.replace(/[^a-z0-9]/gi, '_')}.png` })
    } catch { /* nothing more to record */ }
  }
  await ctx.close()
}

/* ═══════════════════════════ PATIENT: what is real ═════════════════════════ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage(); attachCollectors(page, state)
  try {
  const R = {}; results.roles.PATIENT = R
  state.screen = 'PATIENT/formulary'
  await signIn(page, 'patient@siddhamind.in', 'patient123')
  R.landedOn = new URL(page.url()).pathname
  // Only three screens are reachable: formulary, formulary-detail, assistant.
  const rows = await page.locator('.sm-formula-list a, .sm-formula-row').count()
  R.formularyRows = rows
  R.shotFormulary = await shot(page, state, 'patient', '08-formulary')
  if (rows > 0) {
    await page.locator('.sm-formula-list a, .sm-formula-row').first().click()
    await page.waitForTimeout(1000)
    R.detailUrl = new URL(page.url()).pathname
    R.detailHasIngredients = (await page.locator('body').innerText()).includes('Composition')
    R.shotDetail = await shot(page, state, 'patient', '09-formulary-detail')
  }
  // The assistant is reachable but the AI service is down in this environment.
  await page.goto(`${BASE}/assistant`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  R.assistantStatusText = await page.locator('body').innerText().then((t) => t.slice(0, 200)).catch(() => null)
  R.shotAssistant = await shot(page, state, 'patient', '10-assistant')

  } catch (e) {
    const where = String(e?.message || e).split(String.fromCharCode(10))[0]
    note('HARNESS', state.screen, `step failed: ${where}`)
    try {
      const R2 = results.roles[Object.keys(results.roles).pop()]
      if (R2) { R2.harnessError = where; R2.urlAtFailure = page.url() }
      await page.screenshot({ path: `e2e-screenshots/_failures/${state.screen.replace(/[^a-z0-9]/gi, '_')}.png` })
    } catch { /* nothing more to record */ }
  }
  await ctx.close()
}

/* ═══════════════════ 2.1 reduced motion (desktop viewport) ═════════════════ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const page = await ctx.newPage(); attachCollectors(page, state)
  try {
  const R = results.reducedMotion
  state.screen = 'reduced-motion'
  await signIn(page, 'doctor@siddhamind.in', 'doctor123')

  // palette: should appear without transform travel
  await page.keyboard.press('Control+K')
  await page.waitForSelector('.sm-palette', { timeout: 5000 })
  R.paletteOpens = true
  R.paletteTransformSamples = await page.evaluate(() => new Promise((res) => {
    const out = []
    const el = document.querySelector('.sm-palette')
    let i = 0
    const tick = () => {
      out.push(getComputedStyle(el).transform)
      if (++i < 12) requestAnimationFrame(tick); else res(out)
    }
    tick()
  }))
  R.paletteStatic = new Set(R.paletteTransformSamples).size === 1
  R.shotPalette = await shot(page, state, 'reduced-motion', '01-palette')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // dosha: arcs must already be at final offset on the first frame
  await page.goto(`${BASE}/diagnosis-intake`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await page.locator('input[type="text"]').first().fill('Reduced Motion')
  const sels = page.locator('select'); const n = await sels.count()
  for (let i = 0; i < n; i += 1) await sels.nth(i).selectOption({ index: 1 }).catch(() => {})
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    window.__rm = []
    const tick = () => {
      const arcs = [...document.querySelectorAll('.sm-dosha-ring-wrap svg circle')].slice(1)
      if (arcs.length) window.__rm.push(arcs.map((c) => parseFloat(getComputedStyle(c).strokeDashoffset) || 0))
      if (window.__rm.length < 40) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(1600)
  const rm = await page.evaluate(() => window.__rm ?? [])
  R.doshaSamples = rm.slice(0, 5)
  R.doshaStatic = rm.length > 1 ? JSON.stringify(rm[0]) === JSON.stringify(rm[rm.length - 1]) : null
  R.shotDosha = await shot(page, state, 'reduced-motion', '02-dosha')
  if (R.doshaStatic === false) note('HIGH', 'reduced-motion', 'dosha arcs still animate under prefers-reduced-motion')
  if (!R.paletteStatic) note('HIGH', 'reduced-motion', 'palette still transforms under prefers-reduced-motion')

  } catch (e) {
    const where = String(e?.message || e).split(String.fromCharCode(10))[0]
    note('HARNESS', state.screen, `step failed: ${where}`)
    try {
      const R2 = results.roles[Object.keys(results.roles).pop()]
      if (R2) { R2.harnessError = where; R2.urlAtFailure = page.url() }
      await page.screenshot({ path: `e2e-screenshots/_failures/${state.screen.replace(/[^a-z0-9]/gi, '_')}.png` })
    } catch { /* nothing more to record */ }
  }
  await ctx.close()
}

/* ══════════════════════ 2.3 mobile drawer (390x844) ════════════════════════ */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage(); attachCollectors(page, state)
  try {
  const R = results.mobile
  state.screen = 'mobile'
  await signIn(page, 'doctor@siddhamind.in', 'doctor123')
  R.landedOn = new URL(page.url()).pathname
  R.shotDash = await shot(page, state, 'mobile', '01-dashboard')

  R.topbarVisible = await page.locator('.sm-topbar').isVisible().catch(() => false)
  R.paletteTriggerVisible = await page.locator('.sm-palette-trigger').isVisible().catch(() => false)
  R.themeToggleVisible = await page.locator('.sm-topbar-actions .sm-icon-btn').last().isVisible().catch(() => false)

  // open drawer
  await page.locator('#sm-hamburger').click()
  await page.waitForTimeout(500)
  R.drawerOpen = await page.locator('#sm-drawer').isVisible().catch(() => false)
  R.drawerHasGlass = await page.locator('#sm-drawer').evaluate((el) => el.classList.contains('sm-glass')).catch(() => false)
  R.drawerBackdropFilter = await page.locator('#sm-drawer').evaluate((el) => getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter).catch(() => null)
  R.shotDrawer = await shot(page, state, 'mobile', '02-drawer-open')

  // Escape closes
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  R.closesOnEscape = !(await page.locator('#sm-drawer').isVisible().catch(() => false))

  // backdrop click closes
  await page.locator('#sm-hamburger').click()
  await page.waitForTimeout(400)
  await page.locator('#sm-drawer-backdrop').click({ position: { x: 380, y: 700 }, force: true }).catch(() => {})
  await page.waitForTimeout(500)
  R.closesOnBackdrop = !(await page.locator('#sm-drawer').isVisible().catch(() => false))
  R.shotClosed = await shot(page, state, 'mobile', '03-drawer-closed')

  // theme toggle should be reachable HERE (it lives in the mobile topbar)
  if (R.themeToggleVisible) {
    await page.locator('.sm-topbar-actions .sm-icon-btn').last().click()
    await page.waitForTimeout(400)
    R.themeAfterClick = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    R.shotThemeMobile = await shot(page, state, 'mobile', '04-theme-toggled')
  }
  if (!R.closesOnEscape) note('MEDIUM', 'mobile drawer', 'Escape did not close the drawer')
  if (!R.closesOnBackdrop) note('MEDIUM', 'mobile drawer', 'backdrop click did not close the drawer')

  } catch (e) {
    const where = String(e?.message || e).split(String.fromCharCode(10))[0]
    note('HARNESS', state.screen, `step failed: ${where}`)
    try {
      const R2 = results.roles[Object.keys(results.roles).pop()]
      if (R2) { R2.harnessError = where; R2.urlAtFailure = page.url() }
      await page.screenshot({ path: `e2e-screenshots/_failures/${state.screen.replace(/[^a-z0-9]/gi, '_')}.png` })
    } catch { /* nothing more to record */ }
  }
  await ctx.close()
}

await browser.close()
writeJson('e2e/results-actions.json', results)
console.log('actions run complete ->', results.findings.length, 'findings')
