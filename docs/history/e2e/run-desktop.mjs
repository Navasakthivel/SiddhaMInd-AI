import { chromium } from 'playwright'
import {
  BASE, ACCOUNTS, allowedFor, deniedFor, NAV_ITEMS,
  attachCollectors, shot, login, apiJson, writeJson,
} from './lib.mjs'

const results = { viewport: '1440x900', roles: {}, console: [], network: [], findings: [] }
const state = { screen: 'boot', console: results.console, network: results.network }

const note = (severity, area, text) => results.findings.push({ severity, area, text })

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1460,980'] })

for (const acct of ACCOUNTS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  attachCollectors(page, state)
  const navTrail = []
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navTrail.push(new URL(f.url()).pathname) })
  const R = { screens: {}, palette: {}, theme: {}, denied: {}, action: {}, reload: {} }
  results.roles[acct.role] = R
  const dir = acct.role.toLowerCase()

  try {
    /* ---------- 1.1 login screen ---------- */
    state.screen = `${acct.role}/login`
    await login(page, acct)
    // role-context panel + sliding pill
    R.screens['/login'] = {
      contextPanel: await page.locator('.sm-login-context-body').count(),
      rolePill: await page.locator('.sm-role-tab-active').count(),
      shot: await shot(page, state, dir, '01-login'),
    }

    /* ---------- 1.2 submit states ---------- */
    state.screen = `${acct.role}/login-submit`
    const btn = page.locator('button.sm-btn-status')
    const seen = new Set([await btn.getAttribute('data-status')])
    await btn.click()
    const t0 = Date.now()
    let urlAtSuccess = null
    // Poll fast enough to catch pending -> success before navigation.
    while (Date.now() - t0 < 8000) {
      const st = await btn.getAttribute('data-status').catch(() => null)
      if (st) {
        if (!seen.has(st)) {
          seen.add(st)
          if (st === 'success') urlAtSuccess = page.url()
        }
      } else break // button gone => navigated
      await page.waitForTimeout(25)
    }
    await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15000 })
    R.screens['/login'].statuses = [...seen]
    R.screens['/login'].urlWhenSuccessShown = urlAtSuccess
    R.screens['/login'].landedOn = new URL(page.url()).pathname
    R.screens['/login'].navTrail = [...navTrail]
    await page.waitForLoadState('networkidle')

    /* ---------- 1.3 dashboard real data ---------- */
    const landing = new URL(page.url()).pathname
    state.screen = `${acct.role}${landing}`
    const me = await page.evaluate(async () => {
      const r = await fetch('/api/auth/me', { credentials: 'include' })
      return r.ok ? r.json() : { __status: r.status }
    })
    const bodyText = await page.locator('body').innerText()
    R.dashboard = {
      shot: await shot(page, state, dir, '02-dashboard'),
      apiName: me?.name, apiRole: me?.role, apiInstitution: me?.institution ?? null,
      nameRendered: me?.name ? bodyText.includes((me.name.split(' ')[0])) : null,
      hasUndefined: /\bundefined\b/.test(bodyText),
      hasNaN: /\bNaN\b/.test(bodyText),
      // names that must never appear - the fabricated ones from the audit
      fabricated: ['Kavitha', 'Anitha', '1,284', 'Year 3'].filter((f) => bodyText.includes(f)),
      apiFormularyTotal: (await page.evaluate(async () => {
        const r = await fetch('/api/formulary', { credentials: 'include' })
        return r.ok ? (await r.json()).total : null
      })),
      bodySnippet: bodyText.slice(0, 500),
    }
    R.dashboard.path = landing
    if (R.dashboard.hasUndefined) note('HIGH', `${acct.role} ${landing}`, 'literal "undefined" rendered on dashboard')
    if (R.dashboard.hasNaN) note('HIGH', `${acct.role} ${landing}`, 'literal "NaN" rendered on dashboard')
    if (R.dashboard.fabricated.length) {
      note('HIGH', `${acct.role} ${landing}`, `fabricated strings still present: ${R.dashboard.fabricated.join(', ')}`)
    }
    if (R.dashboard.apiName && !R.dashboard.nameRendered) {
      note('HIGH', `${acct.role} ${landing}`, `signed-in name "${R.dashboard.apiName}" from /api/auth/me is not rendered on the dashboard`)
    }

    /* ---------- 1.4 command palette ---------- */
    state.screen = `${acct.role}/palette`
    const trigger = page.locator('.sm-palette-trigger')
    R.palette.triggerVisible = await trigger.isVisible().catch(() => false)
    // The window keydown listener needs the page focused. With the trigger
    // hidden there is nothing to focus, so click a dead area of the page.
    await page.locator('body').click({ position: { x: 4, y: 4 } }).catch(() => {})
    if (R.palette.triggerVisible) await trigger.focus()
    await page.keyboard.press('Control+K')
    await page.waitForSelector('.sm-palette', { timeout: 4000 })
    const listed = await page.locator('.sm-palette-row .sm-palette-path').allInnerTexts()
    const allowed = allowedFor(acct.role).map((n) => n.path)
    const denied = deniedFor(acct.role).map((n) => n.path)
    R.palette.opens = true
    R.palette.listed = listed
    R.palette.leakedForbidden = listed.filter((p) => denied.includes(p))
    R.palette.missingAllowed = allowed.filter((p) => !listed.includes(p))
    R.palette.shotOpen = await shot(page, state, dir, '03-palette-open')

    // fuzzy filter
    await page.fill('.sm-palette-input', 'frmly')
    await page.waitForTimeout(150)
    R.palette.fuzzyQuery = 'frmly'
    R.palette.fuzzyResults = await page.locator('.sm-palette-row .sm-palette-path').allInnerTexts()
    R.palette.shotFuzzy = await shot(page, state, dir, '04-palette-fuzzy')

    // arrow keys move selection
    await page.fill('.sm-palette-input', '')
    await page.waitForTimeout(120)
    const firstActive = await page.locator('.sm-palette-row[data-active="true"] .sm-palette-path').innerText().catch(() => null)
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(90)
    const secondActive = await page.locator('.sm-palette-row[data-active="true"] .sm-palette-path').innerText().catch(() => null)
    R.palette.arrowMoves = Boolean(firstActive && secondActive && firstActive !== secondActive)
    R.palette.arrowFrom = firstActive
    R.palette.arrowTo = secondActive

    // Escape closes + focus returns
    await page.keyboard.press('Escape')
    await page.waitForTimeout(350)
    R.palette.closesOnEscape = (await page.locator('.sm-palette').count()) === 0
    R.palette.focusReturned = await page.evaluate(() =>
      document.activeElement?.classList?.contains('sm-palette-trigger') ?? false)

    // Enter navigates
    await page.keyboard.press('Control+K')
    await page.waitForSelector('.sm-palette', { timeout: 4000 })
    await page.fill('.sm-palette-input', 'formulary list')
    await page.waitForTimeout(150)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(700)
    R.palette.enterNavigatedTo = new URL(page.url()).pathname
    if (R.palette.leakedForbidden.length) {
      note('CRITICAL', `${acct.role} palette`, `lists screens this role cannot open: ${R.palette.leakedForbidden.join(', ')}`)
    }

    /* ---------- 1.5 theme toggle ---------- */
    state.screen = `${acct.role}/theme`
    await page.goto(`${BASE}${landing}`, { waitUntil: 'networkidle' })
    R.theme.initial = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    const toggleBtn = page.locator('.sm-topbar-actions .sm-icon-btn').last()
    R.theme.toggleExistsInDom = (await toggleBtn.count()) > 0
    R.theme.toggleVisible = await toggleBtn.isVisible().catch(() => false)
    R.theme.switchedBy = R.theme.toggleVisible
      ? 'click'
      : 'programmatic (toggle button not visible at this viewport)'

    const setTheme = async (t) => {
      await page.evaluate((v) => {
        localStorage.setItem('siddhamind:theme', v)
        document.documentElement.setAttribute('data-theme', v)
      }, t)
      await page.waitForTimeout(350)
    }
    // Explicitly both ways: this machine's OS preference is light, so a single
    // "toggle" would have produced two light screenshots.
    await setTheme('dark')
    R.theme.darkApplied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    R.theme.shotDark = await shot(page, state, dir, '05-theme-dark')
    await setTheme('light')
    R.theme.lightApplied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    R.theme.shotLight = await shot(page, state, dir, '06-theme-light')
    R.theme.persisted = await page.evaluate(() => localStorage.getItem('siddhamind:theme'))

    // Flash-of-wrong-theme: read the attribute on the very first script the
    // document runs, before React mounts. addInitScript runs at document_start.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        window.__themeAtDCL = document.documentElement.getAttribute('data-theme')
      }, { once: true })
    })
    await page.reload({ waitUntil: 'networkidle' })
    R.theme.afterReload = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    R.theme.attrAtDomContentLoaded = await page.evaluate(() => window.__themeAtDCL ?? null)
    R.theme.noFlash = R.theme.attrAtDomContentLoaded === R.theme.afterReload

    /* ---------- 1.6 every allowed route ---------- */
    for (const item of allowedFor(acct.role)) {
      state.screen = `${acct.role}${item.path}`
      const before = state.console.length
      await page.goto(`${BASE}${item.path}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(450)
      const errs = state.console.slice(before).filter((c) => c.type === 'error' || c.type === 'pageerror')
      const txt = await page.locator('body').innerText()
      const metrics = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        bodyH: document.body.getBoundingClientRect().height,
      }))
      R.screens[item.path] = {
        shotLight: await shot(page, state, dir, `route-light-${item.path.replace(/\//g, '')}`),
        consoleErrors: errs.map((e) => e.text),
        hasUndefined: /\bundefined\b/.test(txt),
        hasNaN: /\bNaN\b/.test(txt),
        horizontalOverflow: metrics.scrollW > metrics.clientW + 2,
        emptyBody: txt.trim().length < 40,
      }
      if (R.screens[item.path].horizontalOverflow) {
        note('MEDIUM', `${acct.role} ${item.path}`, `horizontal overflow: scrollWidth ${metrics.scrollW} > clientWidth ${metrics.clientW}`)
      }
      if (R.screens[item.path].emptyBody) note('HIGH', `${acct.role} ${item.path}`, 'page body is essentially empty')
      if (R.screens[item.path].hasNaN) note('HIGH', `${acct.role} ${item.path}`, 'literal "NaN" rendered')
      if (R.screens[item.path].hasUndefined) note('HIGH', `${acct.role} ${item.path}`, 'literal "undefined" rendered')
    }
    // also capture each route in dark for the both-theme sweep
    if (await page.locator('.sm-topbar-actions .sm-icon-btn').last().isVisible().catch(() => false)) {
      await page.locator('.sm-topbar-actions .sm-icon-btn').last().click()
    } else {
      await page.evaluate(() => {
        localStorage.setItem('siddhamind:theme', 'dark')
        document.documentElement.setAttribute('data-theme', 'dark')
      })
    }
    await page.waitForTimeout(350)
    for (const item of allowedFor(acct.role)) {
      state.screen = `${acct.role}${item.path}#dark`
      await page.goto(`${BASE}${item.path}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(300)
      R.screens[item.path].shotDark = await shot(page, state, dir, `route-dark-${item.path.replace(/\//g, '')}`)
    }

    /* ---------- 1.7 a forbidden route ---------- */
    const forbidden = deniedFor(acct.role)
    if (forbidden.length === 0) {
      R.denied = { note: 'No React route is forbidden to this role - every NAV_ITEMS entry includes it.' }
    } else {
      const target = forbidden[0]
      state.screen = `${acct.role}/denied`
      await page.goto(`${BASE}${target.path}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      const txt = await page.locator('body').innerText()
      const friendly = acct.role.charAt(0) + acct.role.slice(1).toLowerCase()
      R.denied = {
        attempted: target.path,
        landedOn: new URL(page.url()).pathname,
        showsCorrectRole: txt.includes(friendly),
        showsWrongHardcodedRole: acct.role !== 'STUDENT' && /signed in as\s+Student/i.test(txt),
        mentionsAttemptedPath: txt.includes(target.path),
        hasPatientColumn: txt.includes('Patient'),
        stillClaimsPrescribe: /Prescribe a formula/i.test(txt),
        stillClaimsOverride: /Override a HIGH verdict/i.test(txt),
        shot: await shot(page, state, dir, '07-access-denied'),
      }
      const back = page.locator('a.sm-btn-primary').first()
      R.denied.backLabel = await back.innerText().catch(() => null)
      R.denied.backHref = await back.getAttribute('href').catch(() => null)
      await back.click()
      await page.waitForTimeout(700)
      R.denied.backLandedOn = new URL(page.url()).pathname
      R.denied.backWasAllowed = R.denied.backLandedOn !== '/access-denied'
      if (R.denied.landedOn !== '/access-denied') {
        note('CRITICAL', `${acct.role} ${target.path}`, `forbidden route did not land on /access-denied (landed ${R.denied.landedOn})`)
      }
      if (!R.denied.backWasAllowed) {
        note('HIGH', `${acct.role} access-denied`, `"back to my dashboard" led somewhere this role cannot open`)
      }
    }
  } catch (e) {
    R.fatal = String(e?.stack || e)
    note('CRITICAL', acct.role, `run aborted: ${String(e?.message || e)}`)
    await shot(page, state, dir, 'FATAL').catch(() => {})
  }

  await ctx.close()
}

await browser.close()
writeJson('e2e/results-desktop.json', results)
console.log('desktop run complete ->', results.findings.length, 'findings,',
  results.console.length, 'console msgs,', results.network.length, 'network issues')
