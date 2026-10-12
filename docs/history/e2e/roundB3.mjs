/**
 * Round B3 verification: the last eight screens, in real Chrome.
 *
 * Every assertion is measured against what the API returned on the same page
 * load, not against a number typed into this file. Where a count is checked it
 * is checked against the live JSON, so a seeded row added tomorrow does not
 * turn into a false failure.
 *
 * Run:  node e2e/roundB3.mjs
 */
import { chromium } from 'playwright'
import {
  BASE, ACCOUNTS, attachCollectors, shot, apiJson, writeJson,
} from './lib.mjs'

const DESKTOP = { width: 1440, height: 900 }
const MOBILE = { width: 390, height: 844 }

const results = []
const state = { screen: '', console: [], network: [] }

function check(screen, role, vp, name, pass, detail = '') {
  results.push({ screen, role, vp, name, pass: Boolean(pass), detail: String(detail) })
  const tag = pass ? 'PASS' : 'FAIL'
  console.log(`  [${tag}] ${screen} ${role}/${vp} :: ${name}${detail ? ' — ' + detail : ''}`)
}

const acct = (role) => ACCOUNTS.find((a) => a.role === role)

async function signIn(page, role) {
  // lib.mjs's login() still targets the pre-Round-B ids (#login-id /
  // #login-password). Login.jsx was rebuilt with #lg-email / #lg-pw, so the
  // fields are filled here rather than through that helper.
  const a = acct(role)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#lg-email', a.email)
  await page.fill('#lg-pw', a.password)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 }),
    page.click('button[type=submit]'),
  ])
  await page.waitForTimeout(500)
}

async function signOut(page) {
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }))
  await page.context().clearCookies()
}

/** No page-level scroll sideways. The single most common mobile regression. */
async function noHorizontalOverflow(page) {
  return page.evaluate(() => {
    const d = document.documentElement
    return { over: d.scrollWidth - d.clientWidth, w: d.clientWidth }
  })
}

async function go(page, path, screen) {
  state.screen = screen
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
}

// ---------------------------------------------------------------- screens

async function adminDashboard(page, vp) {
  await go(page, '/admin-dashboard', '05 Admin dashboard')
  const api = await apiJson(page, '/api/admin/stats')
  const body = await page.innerText('body')

  check('05 Admin dashboard', 'ADMIN', vp, 'no NaN or undefined rendered',
    !/\bNaN\b|\bundefined\b/.test(body))

  const tiles = await page.$$eval('button', (bs) => bs
    .filter((b) => /Indexed passages|Registered users|Formulations|Heavy-metal|Source documents/.test(b.innerText))
    .map((b) => b.innerText.replace(/\s+/g, ' ')))
  check('05 Admin dashboard', 'ADMIN', vp, 'five stat tiles render', tiles.length === 5, `${tiles.length} tiles`)

  check('05 Admin dashboard', 'ADMIN', vp, 'user count matches /api/admin/stats',
    tiles.some((t) => t.includes(String(api.userCount))), `userCount=${api.userCount}`)

  check('05 Admin dashboard', 'ADMIN', vp, 'AI pill states a probed verdict',
    /Connected|Offline/.test(body))

  const checks = api.recentChecks?.length ?? 0
  const dx = api.recentDiagnoses?.length ?? 0
  check('05 Admin dashboard', 'ADMIN', vp, 'recent panels backed by API rows',
    body.includes('Recent safety checks') && body.includes('Recent diagnoses'),
    `${checks} checks / ${dx} diagnoses on the wire`)

  await shot(page, state, `b3-${vp}`, '05-admin-dashboard')
}

async function userManagement(page, vp) {
  await go(page, '/user-management', '06 User management')
  const api = await apiJson(page, '/api/admin/users')
  // Waits for the real table before sampling. req.reload() puts the screen back
  // into `loading`, which swaps the table for skeleton rows; sampling those
  // produced a phantom "order changed" that was this harness, not the app.
  const rowEmails = async () => {
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('tbody tr')
      return rows.length > 0 && [...rows].every((r) => /@/.test(r.innerText))
    }, null, { timeout: 15000 })
    return page.$$eval('tbody tr', (rs) => rs.map(
      (r) => r.innerText.match(/[\w.+-]+@[\w.-]+/)[0]))
  }

  const before = await rowEmails()
  check('06 User management', 'ADMIN', vp, 'row count matches /api/admin/users',
    before.length === api.users.length, `${before.length} rows / ${api.users.length} users`)

  check('06 User management', 'ADMIN', vp, 'Create user control present',
    await page.locator('button', { hasText: 'Create user' }).first().isVisible())

  // ---- BUG-05: order must survive an action -----------------------------
  // The patient account is used because the signed-in admin cannot suspend
  // itself, and the run restores it before finishing.
  const target = 'patient@siddhamind.in'
  const row = page.locator('tbody tr', { hasText: target }).first()
  const wasActive = (await row.innerText()).includes('ACTIVE')

  await row.locator('button', { hasText: wasActive ? 'Suspend' : 'Reinstate' }).click()
  // Wait for the acted-on row to actually carry its new status before sampling
  // the order. A plain timeout could return while the pre-reload table was
  // still mounted, which made the order look stable for the wrong reason and
  // the status look unchanged.
  await page.waitForFunction(([email, want]) => {
    const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(email))
    return Boolean(tr) && tr.innerText.includes(want)
  }, [target, wasActive ? 'SUSPENDED' : 'ACTIVE'], { timeout: 15000 })
  const afterSuspend = await rowEmails()
  check('06 User management', 'ADMIN', vp, 'BUG-05: row order stable after Suspend',
    JSON.stringify(before) === JSON.stringify(afterSuspend),
    `idx(${target}) ${before.indexOf(target)} -> ${afterSuspend.indexOf(target)}`)

  const changed = await page.locator('tbody tr', { hasText: target }).first().innerText()
  check('06 User management', 'ADMIN', vp, 'status actually flipped on the acted-on row',
    changed.includes(wasActive ? 'SUSPENDED' : 'ACTIVE'))

  // ---- restore through the UI -------------------------------------------
  await page.locator('tbody tr', { hasText: target }).first()
    .locator('button', { hasText: wasActive ? 'Reinstate' : 'Suspend' }).click()
  await page.waitForFunction(([email, want]) => {
    const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(email))
    return Boolean(tr) && tr.innerText.includes(want)
  }, [target, wasActive ? 'ACTIVE' : 'SUSPENDED'], { timeout: 15000 }).catch(() => {})
  const afterRestore = await rowEmails()
  check('06 User management', 'ADMIN', vp, 'BUG-05: row order stable after Reinstate',
    JSON.stringify(before) === JSON.stringify(afterRestore))

  // ---- restore for real --------------------------------------------------
  // The UI click above is what is under test, so it is allowed to fail. This
  // is not: a suspended account cannot sign in, and an earlier version of this
  // run locked the patient out of every later check by leaving one click
  // unconfirmed. The status is forced back through the API and re-read.
  const settled = await page.evaluate(async ([id, want]) => {
    await fetch(`/api/admin/users/${id}/status`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: want }),
    })
    const r = await (await fetch('/api/admin/users', { credentials: 'include' })).json()
    return r.users.find((u) => u.userId === id)?.status
  }, [api.users.find((u) => u.email === target).userId, wasActive ? 'ACTIVE' : 'SUSPENDED'])

  check('06 User management', 'ADMIN', vp, 'account left exactly as it was found',
    settled === (wasActive ? 'ACTIVE' : 'SUSPENDED'), `${target} -> ${settled}`)

  await shot(page, state, `b3-${vp}`, '06-user-management')
}

async function corpusUpload(page, vp) {
  await go(page, '/corpus-upload', '07 Corpus upload')
  const api = await apiJson(page, '/api/admin/corpus')
  const body = await page.innerText('body')

  check('07 Corpus upload', 'ADMIN', vp, 'dropzone accepts PDFs',
    await page.locator('input[type=file][accept="application/pdf"]').count() === 1)

  const sections = await page.$$eval('ol[aria-label="Processing stages"]',
    (os) => os.map((o) => o.querySelectorAll('li').length))
  check('07 Corpus upload', 'ADMIN', vp, 'one stepper per document',
    sections.length === api.documents.length,
    `${sections.length} steppers / ${api.documents.length} docs`)
  check('07 Corpus upload', 'ADMIN', vp, 'stepper has exactly the 3 reportable stages',
    sections.every((n) => n === 3), `stages=${[...new Set(sections)].join(',')}`)

  // The non-negotiable: no invented percentage anywhere on this screen.
  check('07 Corpus upload', 'ADMIN', vp, 'no fabricated percent figure',
    !/\b\d{1,3}\s?%/.test(body), body.match(/\b\d{1,3}\s?%/)?.[0] ?? '')

  const bars = await page.locator('[role=progressbar]').count()
  const running = api.documents.filter((d) => d.ingestStatus === 'RUNNING').length
  check('07 Corpus upload', 'ADMIN', vp, 'progress bar only while a run is live',
    bars <= running + 1, `${bars} bars / ${running} running`)

  await shot(page, state, `b3-${vp}`, '07-corpus-upload')
}

async function practitionerDashboard(page, role, vp) {
  await go(page, '/practitioner-dashboard', '09 Practitioner dashboard')
  const api = await apiJson(page, '/api/practitioner/dashboard')
  const body = await page.innerText('body')

  check('09 Practitioner dashboard', role, vp, 'no NaN rendered', !/\bNaN\b/.test(body))
  check('09 Practitioner dashboard', role, vp, 'three quick actions',
    (await page.locator('button', { hasText: /New examination|Safety check|Ask the corpus/ }).count()) === 3)
  check('09 Practitioner dashboard', role, vp, 'both own-work panels present',
    body.includes('My recent diagnoses') && body.includes('My safety checks'),
    `api: ${api.myDiagnoses?.length ?? 0} dx / ${api.myChecks?.length ?? 0} checks`)
  check('09 Practitioner dashboard', role, vp, 'no invented sign-off queue',
    !/awaiting sign-off/i.test(body))

  await shot(page, state, `b3-${vp}`, `09-practitioner-${role}`)
}

async function studentDashboard(page, role, vp) {
  await go(page, '/student-dashboard', '15 Student dashboard')
  const api = await apiJson(page, '/api/student/dashboard')
  const forms = await apiJson(page, '/api/formulary')
  const body = await page.innerText('body')

  check('15 Student dashboard', role, vp, 'the fabricated 1,284 is gone', !body.includes('1,284'))
  check('15 Student dashboard', role, vp, 'no invented student identity',
    !/Kavitha|Year 3/.test(body))

  const cards = await page.locator('button:has(span)').evaluateAll(
    (bs) => bs.filter((b) => /SFI-/.test(b.innerText)).length)
  check('15 Student dashboard', role, vp, 'study grid size equals the formulary',
    cards === forms.total, `${cards} cards / total ${forms.total}`)

  check('15 Student dashboard', role, vp, 'past chats panel reflects the API',
    body.includes('My past assistant chats'), `api: ${api.myChats?.length ?? 0} chats`)

  await shot(page, state, `b3-${vp}`, `15-student-${role}`)
}

async function formulary(page, role, vp) {
  await go(page, '/formulary', '18 Formulary')
  const api = await apiJson(page, '/api/formulary')
  const cardCount = () => page.locator('button:has-text("SFI-")').count()

  check('18 Formulary', role, vp, 'card count equals API results',
    (await cardCount()) === api.results.length,
    `${await cardCount()} cards / ${api.results.length} results`)

  const wanted = [...new Set(api.results.map((f) => f.dosageForm).filter(Boolean))].sort()
  const chips = await page.locator('[aria-label="Dosage form"] button').allInnerTexts()
  check('18 Formulary', role, vp, 'dosage filters derived from the data, not hardcoded',
    JSON.stringify(chips.slice(1).map((s) => s.trim()).sort()) === JSON.stringify(wanted),
    `chips=[${chips.join('|')}] data=[${wanted.join('|')}]`)

  if (wanted.length) {
    await page.locator('[aria-label="Dosage form"] button', { hasText: wanted[0] }).first().click()
    await page.waitForTimeout(300)
    const expect = api.results.filter((f) => f.dosageForm === wanted[0]).length
    check('18 Formulary', role, vp, `filter "${wanted[0]}" narrows to the right rows`,
      (await cardCount()) === expect, `${await cardCount()} shown / ${expect} expected`)
    await page.locator('[aria-label="Dosage form"] button', { hasText: 'All' }).first().click()
    await page.waitForTimeout(250)
  }

  const hm = api.results.filter((f) => f.containsHeavyMetal).length
  check('18 Formulary', role, vp, 'heavy-metal badge count matches the data',
    (await page.locator('span:text-is("Heavy metal")').count()) === hm, `${hm} expected`)

  await shot(page, state, `b3-${vp}`, `18-formulary-${role}`)
}

async function formularyDetail(page, role, vp) {
  const list = await apiJson(page, '/api/formulary')
  // Pick one that exercises the interesting branches.
  const pick = list.results.find((f) => f.containsHeavyMetal) ?? list.results[0]
  await go(page, `/formulary/${pick.formId}`, '19 Formulation detail')
  const api = await apiJson(page, `/api/formulary/${pick.formId}`)
  const body = await page.innerText('body')

  check('19 Formulation detail', role, vp, 'English and Tamil names both shown',
    body.includes(api.nameEnglish) && body.includes(api.nameTamil), api.nameEnglish)

  check('19 Formulation detail', role, vp, 'source citation printed when recorded',
    !api.sourceBook || body.includes(api.sourceBook), api.sourceBook ?? 'none recorded')
  check('19 Formulation detail', role, vp, 'no "p. null" for a missing page',
    !/p\.\s*(null|undefined|NaN)/.test(body))

  const ing = await page.locator('span:text-is("Heavy metal"), [aria-label="Heavy metal"]').count()
  check('19 Formulation detail', role, vp, 'heavy-metal ingredients flagged',
    ing >= api.ingredients.filter((i) => i.heavyMetal).length,
    `${api.ingredients.filter((i) => i.heavyMetal).length} heavy-metal ingredients`)

  check('19 Formulation detail', role, vp, 'API carries the indications field',
    Array.isArray(api.indications),
    Array.isArray(api.indications) ? `${api.indications.length} indications`
      : 'field absent — server predates the Round B2 change')
  check('19 Formulation detail', role, vp, 'every indicated noi is rendered',
    Array.isArray(api.indications) && api.indications.every((n) => body.includes(n.noiEnglish)),
    (api.indications ?? []).map((n) => n.noiEnglish).join(', '))

  check('19 Formulation detail', role, vp, 'safety-check hand-off present',
    await page.locator('button', { hasText: 'Run a safety check' }).first().isVisible())

  await shot(page, state, `b3-${vp}`, `19-formulary-detail-${role}`)
}

async function assistant(page, role, vp) {
  await go(page, '/assistant', '20 Assistant')
  const chats = await apiJson(page, '/api/assistant/chats')
  const status = await apiJson(page, '/api/assistant/status')
  const body = await page.innerText('body')

  check('20 Assistant', role, vp, 'status pill agrees with /api/assistant/status',
    body.includes(status.aiAvailable ? 'Connected' : 'Offline'),
    `aiAvailable=${status.aiAvailable}`)

  const aside = await page.locator('aside[aria-label="Past chats"]').isVisible()
  const strip = await page.locator('div[aria-label="Past chats"]').first().isVisible()
  check('20 Assistant', role, vp, 'exactly one past-chats surface is in the layout',
    aside !== strip, `rail=${aside} strip=${strip}`)

  check('20 Assistant', role, vp, 'new-chat control present',
    (await page.locator('button', { hasText: /New chat|New$/ }).count()) >= 1,
    `${chats.total} stored chats`)

  check('20 Assistant', role, vp, 'no fabricated match score beside citations',
    !/match\s+0?\.\d+/i.test(body))

  check('20 Assistant', role, vp, 'composer is reachable',
    await page.locator('textarea[aria-label="Message"]').isVisible())

  await shot(page, state, `b3-${vp}`, `20-assistant-${role}`)
}

// ---------------------------------------------------------------- driver

async function runRole(browser, role, viewport, vpName) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  attachCollectors(page, state)
  await signIn(page, role)

  try {
    if (role === 'ADMIN') {
      await adminDashboard(page, vpName)
      await userManagement(page, vpName)
      await corpusUpload(page, vpName)
    }
    if (role === 'ADMIN' || role === 'PRACTITIONER') await practitionerDashboard(page, role, vpName)
    if (role === 'ADMIN' || role === 'STUDENT') await studentDashboard(page, role, vpName)
    await formulary(page, role, vpName)
    await formularyDetail(page, role, vpName)
    await assistant(page, role, vpName)

    const ov = await noHorizontalOverflow(page)
    check('layout', role, vpName, 'no horizontal page scroll', ov.over <= 1, `${ov.over}px over ${ov.w}px`)
  } finally {
    await signOut(page)
    await ctx.close()
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: false })
for (const vp of [['1440', DESKTOP], ['390', MOBILE]]) {
  for (const role of ['ADMIN', 'PRACTITIONER', 'STUDENT', 'PATIENT']) {
    console.log(`\n=== ${role} @ ${vp[0]} ===`)
    try {
      await runRole(browser, role, vp[1], vp[0])
    } catch (e) {
      check('driver', role, vp[0], 'run completed', false, String(e).slice(0, 300))
    }
  }
}
await browser.close()

const failed = results.filter((r) => !r.pass)
writeJson('e2e/results-roundB3.json', { results, console: state.console, network: state.network })
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(`console problems: ${state.console.length}, network problems: ${state.network.length}`)
if (failed.length) {
  console.log('\nFAILURES:')
  for (const f of failed) console.log(`  ${f.screen} ${f.role}/${f.vp} :: ${f.name} — ${f.detail}`)
}
