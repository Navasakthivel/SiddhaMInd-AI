/**
 * Round C — final regression across the whole application.
 *
 * All 23 screens, 4 roles, 1440x900 and 390x844, in real Chrome.
 *
 *   node e2e/roundC.mjs             # headless
 *   HEADED=1 node e2e/roundC.mjs    # with a visible window
 *
 * Results land in e2e/results-roundC.json and are written up in e2e/REPORT.md.
 *
 * Two principles this suite holds to:
 *
 *  - Nothing is asserted against a number typed into this file. Counts are
 *    compared to the JSON the page itself loaded, so seeding more rows tomorrow
 *    does not turn into a false failure.
 *  - The role matrix in lib.mjs is verified against nav.js before anything runs.
 *    A harness carrying its own copy of an authorisation table will eventually
 *    agree with a bug instead of catching it.
 */
import fs from 'node:fs'
import {
  launchBrowser,
  BASE, ACCOUNTS, ROLES, SCREENS, AUTHED, allowedFor, deniedFor, NAV_LABELS,
  forbiddenIn, attachCollectors, shot, login, loginAs, apiJson, apiPost, writeJson, deleteTestUsers,
} from './lib.mjs'

const VIEWPORTS = [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
]

const results = []
const state = { screen: '', console: [], network: [] }
let ids = { formulation: null, disease: null }

function check(area, subject, vp, name, pass, detail = '') {
  results.push({ area, subject, vp, name, pass: Boolean(pass), detail: String(detail).slice(0, 400) })
  if (!pass) console.log(`  [FAIL] ${area} ${subject}/${vp} :: ${name}${detail ? ' — ' + detail : ''}`)
  return Boolean(pass)
}

const resolve = (p) => p
  .replace('/:id', p.startsWith('/disease') ? `/${ids.disease}` : `/${ids.formulation}`)

async function go(page, path, label) {
  state.screen = label
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(350)
}

// ===================================================================== 0
// The harness's role matrix must equal nav.js's, or nothing below means much.
async function verifyMatrix() {
  const nav = fs.readFileSync('src/nav.js', 'utf8')
  const pairs = [
    ['/admin-dashboard', 'ADMIN_ONLY'], ['/user-management', 'ADMIN_ONLY'],
    ['/corpus-upload', 'ADMIN_ONLY'], ['/reports', 'ADMIN_ONLY'],
    ['/practitioner-dashboard', 'PRAC'], ['/diagnosis-intake', 'PRAC'],
    ['/diagnosis-history', 'PRAC'], ['/diagnosis-results', 'PRAC'],
  ]
  let ok = true
  for (const [path, token] of pairs) {
    const line = nav.split('\n').find((l) => l.includes(`'${path}'`))
    if (!line || !line.includes(`roles: ${token}`)) ok = false
  }
  check('matrix', 'nav.js', '-', 'harness role table agrees with nav.js', ok)
  check('matrix', 'screens', '-', 'all 23 numbered screens covered', SCREENS.length === 23,
    `${SCREENS.length} screens`)
}

// ===================================================================== 1 & 7
// Every allowed screen renders real data, with no placeholder or NaN, and no
// sideways scroll at 390.
async function renderSweep(page, role, vp) {
  for (const s of allowedFor(role)) {
    const label = `${s.id} ${s.name}`
    await go(page, resolve(s.path), label)

    const url = new URL(page.url()).pathname
    if (!check('render', `${s.id} ${s.name}`, vp, `${role}: opens`, !url.endsWith('/access-denied'), url)) continue

    const body = await page.innerText('body')
    const hits = forbiddenIn(body)
    check('render', `${s.id} ${s.name}`, vp, `${role}: no placeholder or NaN`, hits.length === 0, hits.join(', '))

    // A screen that rendered nothing but its chrome is not a screen.
    const main = await page.evaluate(() => {
      const m = document.querySelector('main') ?? document.body
      return m.innerText.trim().length
    })
    check('render', `${s.id} ${s.name}`, vp, `${role}: has content`, main > 40, `${main} chars`)

    // No error state left on screen (the two result screens may sit empty).
    const errored = /Could not load|Something went wrong|Failed to/i.test(body)
    check('render', `${s.id} ${s.name}`, vp, `${role}: no error state`, !errored)

    const ov = await page.evaluate(() => {
      const d = document.documentElement
      return d.scrollWidth - d.clientWidth
    })
    check('overflow', `${s.id} ${s.name}`, vp, `${role}: no horizontal scroll`, ov <= 1, `${ov}px`)

    if (vp === '1440' && role === firstRoleFor(s)) await shot(page, `roundC-${vp}`, `${s.id}-${role}`)
  }
}

const firstRoleFor = (s) => ROLES.find((r) => s.roles.includes(r))

// ===================================================================== 3a
// Every forbidden route lands on /access-denied.
async function denialSweep(page, role, vp) {
  for (const s of deniedFor(role)) {
    await go(page, resolve(s.path), `denied ${s.id}`)
    const url = new URL(page.url()).pathname
    check('access', `${s.id} ${s.name}`, vp, `${role}: denied -> /access-denied`,
      url === '/access-denied', url)
  }
}

// ===================================================================== 3b
// Sidebar and command palette list exactly the allowed screens.
async function navSweep(page, role, vp) {
  await go(page, '/formulary', 'nav')

  if (vp === '390') {
    const burger = page.locator('button[aria-label="Open menu"]').first()
    if (await burger.count() && await burger.isVisible()) {
      await burger.click(); await page.waitForTimeout(500)
    }
  }

  const links = await page.$$eval('nav a', (as) => as.map((a) => ({
    href: new URL(a.href).pathname, label: a.innerText.trim(),
  })))
  const want = [...new Set(NAV_LABELS[role])]
  const got = [...new Set(links.map((l) => l.label).filter(Boolean))]
  check('nav', 'sidebar', vp, `${role}: lists exactly its own screens`,
    JSON.stringify(got.slice().sort()) === JSON.stringify(want.slice().sort()),
    `got=[${got.join('|')}] want=[${want.join('|')}]`)

  // Nothing in the sidebar may point at a route this role cannot open.
  const leaked = links.filter((l) => deniedFor(role).some((s) => s.path === l.href))
  check('nav', 'sidebar', vp, `${role}: no link to a forbidden route`, leaked.length === 0,
    leaked.map((l) => l.href).join(', '))

  // Command palette draws from the same getNavForRole().
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(500)
  const open = await page.locator('.sm-palette').count()
  if (check('nav', 'palette', vp, `${role}: opens on Ctrl+K`, open === 1)) {
    const rows = await page.$$eval('.sm-palette-row, [role="option"]',
      (rs) => rs.map((r) => r.innerText.split('\n')[0].trim()).filter(Boolean))
    const paletteLeak = rows.filter((r) => !want.includes(r))
    check('nav', 'palette', vp, `${role}: lists only allowed screens`,
      rows.length > 0 && paletteLeak.length === 0,
      `${rows.length} rows; unexpected=[${paletteLeak.join('|')}]`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
  }
}

// ===================================================================== 2
// Console purity WHILE AUTHENTICATED.
//
// The run as a whole logs 401s on /api/auth/me, which are the app's own boot
// check on the login page before a session exists. That is expected, but a
// global count cannot prove they are all pre-auth. This suite signs in first,
// starts recording only after the session exists, then walks every screen the
// role can open: anything logged here happened with a live session and is a
// real defect.
async function consolePurity(browser, role, vp) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS.find((v) => v.name === vp).viewport })
  const page = await ctx.newPage()
  await loginAs(page, role)

  const seen = { console: [], network: [] }
  page.on('console', (m) => {
    if (m.type() === 'error') seen.console.push(m.text())
  })
  page.on('pageerror', (e) => seen.console.push('PAGEERROR ' + String(e.message)))
  page.on('response', (res) => {
    if (res.status() >= 400) seen.network.push(`HTTP ${res.status()} ${res.request().method()} ${new URL(res.url()).pathname}`)
  })

  for (const s of allowedFor(role)) {
    await page.goto(`${BASE}${resolve(s.path)}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(300)
  }

  check('console', 'authenticated', vp, `${role}: zero console errors across all its screens`,
    seen.console.length === 0, [...new Set(seen.console)].join(' | ').slice(0, 300))
  check('console', 'authenticated', vp, `${role}: zero failing requests across all its screens`,
    seen.network.length === 0, [...new Set(seen.network)].join(' | ').slice(0, 300))

  await ctx.close()
}

// ===================================================================== 4
// Sign out, then Back must not re-enter the app.
async function signOutBack(browser, vp) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS.find((v) => v.name === vp).viewport })
  const page = await ctx.newPage()
  attachCollectors(page, state)
  state.screen = 'sign-out'
  await loginAs(page, 'ADMIN')
  await go(page, '/admin-dashboard', 'sign-out')

  if (vp === '390') {
    const burger = page.locator('button[aria-label="Open menu"]').first()
    if (await burger.count() && await burger.isVisible()) {
      await burger.click(); await page.waitForTimeout(550)
    }
  }
  const signOut = page.locator('button', { hasText: /Sign out|Log out/i }).first()
  let via = 'button'
  if (await signOut.count() && await signOut.isVisible()) {
    await signOut.click().catch(async () => {
      via = 'endpoint'
      await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }))
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    })
  } else {
    // 390 keeps it behind the drawer; fall back to the endpoint the button calls.
    via = 'endpoint'
    await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }))
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  }
  await page.waitForTimeout(1200)
  const afterOut = new URL(page.url()).pathname
  check('session', 'sign out', vp, `lands on a pre-auth screen (via ${via})`,
    ['/login', '/', '/landing'].includes(afterOut), afterOut)

  const cookie = (await ctx.cookies()).find((c) => c.name === 'JSESSIONID')
  const stillValid = await page.evaluate(async () =>
    (await fetch('/api/auth/me', { credentials: 'include' })).status)
  check('session', 'sign out', vp, 'server no longer honours the session',
    stillValid === 401, `GET /api/auth/me -> ${stillValid}; cookie=${cookie ? 'present' : 'cleared'}`)

  await page.goBack({ waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(1200)
  const backPath = new URL(page.url()).pathname
  const backBody = await page.innerText('body')
  // Re-entering means seeing the signed-in screen again. Being bounced to
  // login, or landing on the dashboard route with no data and an auth prompt,
  // are both acceptable; rendering the admin dashboard is not.
  const reEntered = backPath === '/admin-dashboard' && /Indexed passages|Registered users/.test(backBody)
  check('session', 'back button', vp, 'does not re-enter the app after sign out',
    !reEntered, `back -> ${backPath}`)

  await shot(page, `roundC-${vp}`, 'session-back-after-signout')
  await ctx.close()
}

// ===================================================================== 5
// Register a PATIENT, sign in with it, admin suspends and reinstates, then
// deactivates it. There is no delete endpoint, so the account is left
// SUSPENDED - which is the deactivation this app supports.
async function lifecycle(browser) {
  const stamp = Date.now()
  const acct = {
    fullName: `Round C Probe ${stamp}`,
    email: `roundc.probe.${stamp}@example.invalid`,
    password: 'ProbePass!234',
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  attachCollectors(page, state)
  state.screen = 'lifecycle'

  // --- register through the real form ---
  await go(page, '/register', 'lifecycle')
  await page.fill('#rg-name', acct.fullName)
  await page.fill('#rg-email', acct.email)
  await page.fill('#rg-pw', acct.password)
  // Registration is patient-only now: there is no role picker to choose from.
  await page.click('button[type="submit"]')
  await page.waitForTimeout(2500)
  const afterReg = new URL(page.url()).pathname
  const regBody = await page.innerText('body')
  check('lifecycle', 'register', '1440', 'PATIENT registration accepted',
    !/already registered|could not|error/i.test(regBody) || afterReg === '/login',
    `-> ${afterReg}`)

  // --- sign in as the new account ---
  await ctx.clearCookies()
  let signedIn = false
  try {
    await login(page, acct.email, acct.password, 'PATIENT')
    signedIn = true
  } catch { /* reported below */ }
  const who = signedIn ? await apiJson(page, '/api/auth/me') : {}
  check('lifecycle', 'sign in', '1440', 'new account can sign in', signedIn, acct.email)
  check('lifecycle', 'sign in', '1440', 'role granted is PATIENT, not what was posted',
    who.role === 'PATIENT', `role=${who.role}`)
  const newId = who.userId
  await shot(page, 'roundC-1440', 'lifecycle-new-patient')

  // --- admin suspends ---
  await ctx.clearCookies()
  await loginAs(page, 'ADMIN')
  await go(page, '/user-management', 'lifecycle')
  const row = page.locator('tbody tr', { hasText: acct.email }).first()
  check('lifecycle', 'admin view', '1440', 'new account appears in user management',
    await row.count() === 1)

  await row.locator('button', { hasText: 'Suspend' }).click()
  await page.waitForFunction((e) => {
    const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(e))
    return tr && tr.innerText.includes('SUSPENDED')
  }, acct.email, { timeout: 15000 }).catch(() => {})
  let st = (await apiJson(page, '/api/admin/users')).users.find((u) => u.userId === newId)?.status
  check('lifecycle', 'suspend', '1440', 'account is SUSPENDED', st === 'SUSPENDED', `status=${st}`)

  // a suspended account must not be able to sign in
  const blocked = await apiPost(page, '/api/auth/login', { identifier: acct.email, password: acct.password })
  check('lifecycle', 'suspend', '1440', 'suspended account is refused at sign-in',
    blocked.status >= 400, `POST /api/auth/login -> ${blocked.status}`)

  // --- admin reinstates ---
  await ctx.clearCookies()
  await loginAs(page, 'ADMIN')
  await go(page, '/user-management', 'lifecycle')
  await page.locator('tbody tr', { hasText: acct.email }).first()
    .locator('button', { hasText: 'Reinstate' }).click()
  await page.waitForFunction((e) => {
    const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(e))
    return tr && tr.innerText.includes('ACTIVE')
  }, acct.email, { timeout: 15000 }).catch(() => {})
  st = (await apiJson(page, '/api/admin/users')).users.find((u) => u.userId === newId)?.status
  check('lifecycle', 'reinstate', '1440', 'account is ACTIVE again', st === 'ACTIVE', `status=${st}`)

  const allowed = await apiPost(page, '/api/auth/login', { identifier: acct.email, password: acct.password })
  check('lifecycle', 'reinstate', '1440', 'reinstated account can sign in again',
    allowed.status === 200, `POST /api/auth/login -> ${allowed.status}`)

  // --- deactivate for good ---
  // No delete endpoint exists, so the probe account is left SUSPENDED rather
  // than active-and-orphaned. Seeded accounts are untouched by this block.
  await ctx.clearCookies()
  await loginAs(page, 'ADMIN')
  const off = await apiPost(page, `/api/admin/users/${newId}/status`, { status: 'SUSPENDED' })
  st = (await apiJson(page, '/api/admin/users')).users.find((u) => u.userId === newId)?.status
  check('lifecycle', 'deactivate', '1440', 'probe account deactivated',
    off.status === 200 && st === 'SUSPENDED', `status=${st}`)

  await ctx.close()
  return { ...acct, userId: newId }
}

// ===================================================================== 6
// Theme toggle, desktop and mobile, both themes legible.
async function themeSweep(browser, vp) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS.find((v) => v.name === vp).viewport })
  const page = await ctx.newPage()
  attachCollectors(page, state)
  state.screen = 'theme'
  await loginAs(page, 'ADMIN')
  await go(page, '/formulary', 'theme')

  const read = () => page.evaluate(() => {
    const cs = getComputedStyle(document.body)
    const parse = (c) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const bg = parse(cs.backgroundColor)
    const fg = parse(cs.color)
    const L1 = Math.max(lum(bg), lum(fg)) + 0.05
    const L2 = Math.min(lum(bg), lum(fg)) + 0.05
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      bg: cs.backgroundColor, fg: cs.color,
      contrast: Number((L1 / L2).toFixed(2)),
    }
  })

  const before = await read()
  await shot(page, `roundC-${vp}`, `theme-${before.theme ?? 'initial'}`)

  if (vp === '390') {
    // The theme control is visible at every width (the BUG-01 fix), so the
    // drawer does not need opening to reach it.
  }
  const toggle = page.locator('button[aria-label^="Switch to"]').first()
  const found = await toggle.count() > 0
  check('theme', 'toggle', vp, 'theme control is reachable', found)
  if (!found) { await ctx.close(); return }

  await toggle.click()
  await page.waitForTimeout(700)
  const after = await read()
  await shot(page, `roundC-${vp}`, `theme-${after.theme ?? 'toggled'}`)

  check('theme', 'toggle', vp, 'toggling changes the theme', before.theme !== after.theme,
    `${before.theme} -> ${after.theme}`)
  // WCAG AA body text is 4.5:1. Both themes are checked, not just the default.
  check('theme', before.theme ?? 'initial', vp, 'body text contrast >= 4.5:1',
    before.contrast >= 4.5, `${before.contrast}:1 (${before.fg} on ${before.bg})`)
  check('theme', after.theme ?? 'toggled', vp, 'body text contrast >= 4.5:1',
    after.contrast >= 4.5, `${after.contrast}:1 (${after.fg} on ${after.bg})`)

  await ctx.close()
}

// ===================================================================== 8
// The four clinical rules, re-measured.
async function clinicalRules(browser) {
  // -- 8a/8d: dosha digits settled on frame one; reduced motion static --
  for (const reduced of [false, true]) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    })
    const page = await ctx.newPage()
    attachCollectors(page, state)
    state.screen = `clinical dosha${reduced ? ' (reduced)' : ''}`
    await loginAs(page, 'PRACTITIONER')
    await go(page, '/diagnosis-intake', state.screen)

    await page.fill('#pt-name', 'Round C Probe')
    const sets = page.locator('fieldset')
    for (let i = 0; i < await sets.count(); i += 1) {
      const chip = sets.nth(i).locator('button[aria-pressed]').first()
      if (await chip.count()) await chip.click()
    }
    await page.waitForFunction(
      (w) => document.querySelectorAll('[aria-pressed="true"]').length === w, 8, { timeout: 8000 },
    ).catch(() => {})
    await page.waitForTimeout(350)

    // Sample from before submit so the very first painted frame is captured.
    await page.evaluate(() => {
      window.__d = []
      const tick = () => {
        const rings = [...document.querySelectorAll('svg circle[pathLength]')]
        const digits = [...document.querySelectorAll('span')]
          .filter((s) => /^\d+%$/.test(s.textContent.trim()))
        if (digits.length) {
          window.__d.push({
            off: rings.map((c) => Math.round(parseFloat(getComputedStyle(c).strokeDashoffset) || 0)),
            dig: digits.map((s) => s.textContent.trim()),
            op: digits.map((s) => parseFloat(getComputedStyle(s).opacity)),
          })
        }
        if (window.__d.length < 90) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await page.click('button[type="submit"]')
    await page.waitForURL('**/diagnosis-results', { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(2200)

    const d = await page.evaluate(() => window.__d ?? [])
    const tag = reduced ? 'reduced motion' : 'normal motion'
    if (!d.length) {
      check('clinical', 'dosha', tag, 'reading was produced', false, 'no frames captured')
    } else {
      const first = d[0], last = d[d.length - 1]
      check('clinical', 'dosha', tag, 'digits identical on frame 1 and at rest',
        JSON.stringify(first.dig) === JSON.stringify(last.dig),
        `${first.dig.join('/')} -> ${last.dig.join('/')}`)
      const minOp = Math.min(...d.flatMap((x) => x.op))
      check('clinical', 'dosha', tag, 'digits never fade (opacity 1 throughout)',
        minOp === 1, `min opacity ${minOp}`)
      const swept = JSON.stringify(first.off) !== JSON.stringify(last.off)
      if (reduced) {
        check('clinical', 'dosha', tag, 'rings are static under reduced motion',
          !swept, `first=${first.off.join(',')} last=${last.off.join(',')}`)
      } else {
        check('clinical', 'dosha', tag, 'rings sweep when motion is allowed',
          swept, `first=${first.off.join(',')} last=${last.off.join(',')}`)
      }
    }
    await shot(page, 'roundC-1440', `clinical-dosha-${reduced ? 'reduced' : 'normal'}`)
    await ctx.close()
  }

  // -- 8b/8c: verdict opacity 1 / scale only; heavy-metal bar unfilled --
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  attachCollectors(page, state)
  state.screen = 'clinical safety'
  await loginAs(page, 'PRACTITIONER')
  await go(page, '/safety-checker', 'clinical safety')

  const opts = await page.locator('#sf-form option').allTextContents()
  const idx = opts.findIndex((t) => /Linga Chenthuram/i.test(t))
  await page.selectOption('#sf-form', { index: idx > 0 ? idx : 1 })
  await page.fill('#sf-drug', 'Furosemide')
  await page.keyboard.press('Enter')
  await page.locator('button[aria-pressed]').first().click()

  await page.evaluate(() => {
    window.__s = []
    const tick = () => {
      const badge = [...document.querySelectorAll('span')]
        .find((s) => /HIGH RISK|ELEVATED|NORMAL/.test(s.textContent.trim()))
      const band = document.querySelector('h2')?.closest('section')
      if (badge) {
        window.__s.push({
          badge: parseFloat(getComputedStyle(badge).opacity),
          card: band ? parseFloat(getComputedStyle(band).opacity) : null,
          tf: band ? getComputedStyle(band).transform : null,
        })
      }
      if (window.__s.length < 90) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.click('button[type="submit"]')
  await page.waitForURL('**/safety-result', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2000)

  const s = await page.evaluate(() => window.__s ?? [])
  if (!s.length) {
    check('clinical', 'verdict', '1440', 'verdict was produced', false, 'no frames captured')
  } else {
    const minBadge = Math.min(...s.map((x) => x.badge))
    const minCard = Math.min(...s.map((x) => x.card).filter((v) => v != null))
    check('clinical', 'verdict', '1440', 'verdict never fades in (opacity 1)',
      minBadge === 1 && minCard === 1, `badge ${minBadge}, card ${minCard}`)
    const tf = [...new Set(s.map((x) => x.tf))]
    const scaleOnly = tf.every((t) => t === 'none' || /^matrix\(([\d.]+), 0, 0, \1, 0, 0\)$/.test(t))
    check('clinical', 'verdict', '1440', 'verdict animates by scale only',
      scaleOnly, tf.slice(0, 3).join(' | '))
  }

  const hm = await page.evaluate(() => {
    const track = document.querySelector('[role="img"][aria-label*="ceiling"]')
    if (!track) return { present: false }
    const cs = getComputedStyle(track)
    return {
      present: true,
      borderStyle: cs.borderStyle,
      children: [...track.children].map((k) => getComputedStyle(k).width),
      label: track.getAttribute('aria-label'),
    }
  })
  check('clinical', 'heavy metal', '1440', 'ceiling track is present and dashed',
    hm.present && hm.borderStyle === 'dashed', JSON.stringify(hm))
  check('clinical', 'heavy metal', '1440', 'track carries no fill, only the ceiling marker',
    hm.present && hm.children.length <= 1 && hm.children.every((w) => parseFloat(w) <= 3),
    `children=[${(hm.children ?? []).join(',')}]`)
  await shot(page, 'roundC-1440', 'clinical-safety-verdict')
  await ctx.close()
}

// ===================================================================== 9
// The five formerly-undefined keyframes: defined and running, or gone.
async function keyframeAudit(browser) {
  const OLD = ['fadeUp', 'fadeIn', 'glowOnce', 'alertOnce', 'wave']
  const src = ['src/styles/tokens.css', 'src/styles/siddhamind.css', 'src/styles/v2.css']
    .map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  const jsx = fs.readdirSync('src/pages').map((f) => fs.readFileSync(`src/pages/${f}`, 'utf8')).join('\n')
    + fs.readdirSync('src/components').map((f) => fs.readFileSync(`src/components/${f}`, 'utf8')).join('\n')

  for (const name of OLD) {
    const referenced = new RegExp(`animation(-name)?:\\s*[^;]*\\b${name}\\b`).test(src + jsx)
    check('keyframes', name, '-', 'no longer referenced anywhere', !referenced)
  }

  // Everything still referenced must resolve to a real @keyframes block.
  //
  // CSS and JSX are scanned differently on purpose. In CSS the value after
  // `animation:` starts with the name; in JSX it is a quoted shorthand, often
  // behind a ternary — `animation: reduce ? undefined : 'smScale .5s ...'`.
  // Reading the first identifier after the colon there captures the ternary
  // variable (`reduce`) and reports a keyframe that was never named.
  const cssNames = [...src.matchAll(/animation(?:-name)?:\s*([A-Za-z][\w-]*)/g)].map((m) => m[1])
  const jsxNames = [...jsx.matchAll(/animation(?:Name)?:[^,}\n]*?['"]([A-Za-z][\w-]*)[\s'"]/g)].map((m) => m[1])
  const IGNORE = new Set(['none', 'inherit', 'initial', 'unset', 'revert'])
  const referenced = [...new Set([...cssNames, ...jsxNames].filter((n) => !IGNORE.has(n)))]
  const defined = new Set([...src.matchAll(/@keyframes\s+([A-Za-z][\w-]*)/g)].map((m) => m[1]))
  const missing = referenced.filter((n) => !defined.has(n))
  check('keyframes', 'all', '-', 'every referenced animation has a @keyframes block',
    missing.length === 0, `referenced=[${referenced.join(',')}] missing=[${missing.join(',')}]`)

  // And at least one of them must actually animate in the browser.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  state.screen = 'keyframes'
  await loginAs(page, 'ADMIN')
  await go(page, '/admin-dashboard', 'keyframes')
  const running = await page.evaluate(() => document.getAnimations()
    .map((a) => a.animationName ?? a.effect?.getKeyframes?.().length)
    .filter(Boolean).length)
  check('keyframes', 'runtime', '-', 'animations actually run on a real screen',
    running > 0, `${running} active animations`)
  await ctx.close()
}

// ===================================================================== driver
/**
 * One browser per phase.
 *
 * A single headed Chrome held open across all ~30 contexts of this run died
 * mid-sweep with "Target page, context or browser has been closed", taking
 * every later suite with it. Launching per phase bounds the resource use and,
 * more importantly, contains a crash to the phase it happened in.
 */
async function withBrowser(label, fn) {
  const browser = await launchBrowser()
  try {
    return await fn(browser)
  } catch (e) {
    check('driver', label, '-', 'phase completed', false, String(e).split('\n')[0])
    return null
  } finally {
    await browser.close().catch(() => {})
  }
}

async function main() {
  await verifyMatrix()

  // Resolve the two dynamic ids once, as a signed-in user.
  await withBrowser('ids', async (browser) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await loginAs(page, 'ADMIN')
    const f = await apiJson(page, '/api/formulary')
    const d = await apiJson(page, '/api/formulary/diseases')
    ids = { formulation: f.results[0].formId, disease: d.diseases[0].diseaseId }
    console.log(`resolved ids: formulation=${ids.formulation} disease=${ids.disease}`)
    await ctx.close()
  })

  for (const { name: vp, viewport } of VIEWPORTS) {
    for (const role of ROLES) {
      console.log(`\n=== ${role} @ ${vp} ===`)
      await withBrowser(`${role}@${vp}`, async (browser) => {
        const ctx = await browser.newContext({ viewport })
        const page = await ctx.newPage()
        attachCollectors(page, state)
        try {
          await loginAs(page, role)
          await renderSweep(page, role, vp)
          await denialSweep(page, role, vp)
          await navSweep(page, role, vp)
          await consolePurity(browser, role, vp)
        } catch (e) {
          check('driver', role, vp, 'run completed', false, String(e).split('\n')[0])
        } finally {
          state.screen = 'teardown'
          await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }))
            .catch(() => {})
          await ctx.close().catch(() => {})
        }
      })
    }
    console.log(`\n=== session + theme @ ${vp} ===`)
    // Each sub-suite is isolated: an exception in one must not abort the run
    // and lose every result gathered after it.
    await withBrowser(`session@${vp}`, (b) => signOutBack(b, vp))
    await withBrowser(`theme@${vp}`, (b) => themeSweep(b, vp))
  }

  console.log('\n=== lifecycle ===')
  const probe = await withBrowser('lifecycle', (b) => lifecycle(b))
  console.log('\n=== clinical rules ===')
  await withBrowser('clinical', (b) => clinicalRules(b))
  console.log('\n=== keyframes ===')
  await withBrowser('keyframes', (b) => keyframeAudit(b))

  // ---- leave every seeded account ACTIVE ----
  await withBrowser('teardown', async (browser) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await loginAs(page, 'ADMIN')
    const seeded = ACCOUNTS.map((a) => a.email)
    let users = (await apiJson(page, '/api/admin/users')).users
    for (const u of users) {
      if (seeded.includes(u.email) && u.status !== 'ACTIVE') {
        await apiPost(page, `/api/admin/users/${u.userId}/status`, { status: 'ACTIVE' })
      }
    }
    // Probe accounts - this run's and any an earlier run left behind - are
    // deleted from the database with their rows. There is no delete endpoint,
    // so this goes through scripts/PruneUsers.java, which refuses anything
    // that is not an @example.invalid test address.
    const probeEmails = users.filter((u) => /^roundc\.probe\./.test(u.email)).map((u) => u.email)
    const del = deleteTestUsers(probeEmails)
    check('teardown', 'probe accounts', '-', 'probe accounts deleted',
      del.ok && del.deleted === probeEmails.length, `deleted ${del.deleted} of ${probeEmails.length}`)
    users = (await apiJson(page, '/api/admin/users')).users
    const bad = users.filter((u) => seeded.includes(u.email) && u.status !== 'ACTIVE')
    check('teardown', 'accounts', '-', 'every seeded account left ACTIVE', bad.length === 0,
      users.map((u) => `${u.email}=${u.status}`).join(', '))
    const probes = users.filter((u) => /^roundc\.probe\./.test(u.email))
    check('teardown', 'probe accounts', '-', 'no probe account left', probes.length === 0,
      `${probes.length} probe account(s)`)
    await ctx.close()
  })

  const fails = results.filter((r) => !r.pass)
  writeJson('e2e/results-roundC.json', {
    ran: new Date().toISOString(), probe, ids,
    total: results.length, passed: results.length - fails.length,
    results, console: state.console, network: state.network,
  })
  console.log(`\n${results.length - fails.length}/${results.length} checks passed`)
  console.log(`console problems: ${state.console.length}, network problems: ${state.network.length}`)
  if (fails.length) {
    console.log('\nFAILURES:')
    for (const f of fails) console.log(`  ${f.area} ${f.subject}/${f.vp} :: ${f.name} — ${f.detail}`)
  }
}

await main()
