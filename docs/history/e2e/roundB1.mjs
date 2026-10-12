import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:5173'
const OUT = 'e2e-screenshots/roundB1'
fs.mkdirSync(OUT, { recursive: true })

const ACCOUNTS = [
  { role: 'ADMIN', email: 'admin@siddhamind.in', pw: 'admin123' },
  { role: 'PRACTITIONER', email: 'doctor@siddhamind.in', pw: 'doctor123' },
  { role: 'STUDENT', email: 'student@siddhamind.in', pw: 'student123' },
  { role: 'PATIENT', email: 'patient@siddhamind.in', pw: 'patient123' },
]

// screen -> roles allowed (nav.js / AuthInterceptor.RULES)
const SCREENS = [
  { path: '/profile', roles: ['ADMIN', 'PRACTITIONER', 'STUDENT', 'PATIENT'], must: /notifications/i },
  { path: '/ingredients', roles: ['ADMIN', 'PRACTITIONER', 'STUDENT', 'PATIENT'], must: /toxicity class|no ingredients/i },
  { path: '/diseases', roles: ['ADMIN', 'PRACTITIONER', 'STUDENT', 'PATIENT'], must: /noi|no diseases/i },
  { path: '/patient-dashboard', roles: ['ADMIN', 'PATIENT'], must: /what this portal is for/i },
  { path: '/diagnosis-history', roles: ['ADMIN', 'PRACTITIONER'], must: /examination/i },
  { path: '/reports', roles: ['ADMIN'], must: /users per role/i },
]

const results = { desktop: {}, mobile: {}, preauth: {}, bugs: {}, console: [] }

const browser = await chromium.launch({ channel: 'chrome', headless: false })

function watch(page, bucket) {
  page.on('console', (m) => { if (m.type() === 'error') bucket.push(m.text()) })
  page.on('pageerror', (e) => bucket.push('PAGEERROR ' + e.message))
}

async function signIn(page, a) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#lg-email', a.email)
  await page.fill('#lg-pw', a.pw)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 25000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(700)
}

/* ---------------- pre-auth screens ---------------- */
for (const [w, h, key] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  const page = await ctx.newPage(); watch(page, results.console)
  for (const [path, name, must] of [
    ['/', '01-landing', /Rules decide/],
    ['/login', '02-login', /Welcome back/],
    ['/register', '03-register', /Join SiddhaMind/],
  ]) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    const text = await page.locator('body').innerText()
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
    results.preauth[`${key} ${path}`] = { ok: must.test(text), overflow, chars: text.length }
    await page.screenshot({ path: `${OUT}/${key}-${name}.png` })
  }
  await ctx.close()
}

/* ---------------- per role, both viewports ---------------- */
for (const [w, h, key] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
  for (const a of ACCOUNTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage(); watch(page, results.console)
    const R = {}; results[key][a.role] = R
    try {
      await signIn(page, a)
      R.landedOn = new URL(page.url()).pathname

      // BUG-03: institution present on first paint, without a reload
      if (key === 'desktop') {
        const body = await page.locator('body').innerText()
        const me = await page.evaluate(async () =>
          (await fetch('/api/auth/me', { credentials: 'include' })).json())
        results.bugs[`BUG-03 ${a.role}`] = {
          apiInstitution: me.institution ?? null,
          renderedWithoutReload: me.institution ? body.includes(me.institution) : 'n/a',
        }
        // BUG-04: greeting must not be "Dr."
        const greet = body.match(/(Good [a-z]+|What would you like to do),\s*([^\n?]*)/)
        if (greet) results.bugs[`BUG-04 ${a.role}`] = { apiName: me.name, greeting: greet[0].trim() }
      }

      for (const s of SCREENS) {
        const allowed = s.roles.includes(a.role)
        await page.goto(BASE + s.path, { waitUntil: 'networkidle' })
        await page.waitForTimeout(700)
        const landed = new URL(page.url()).pathname
        const text = await page.locator('body').innerText()
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
        R[s.path] = allowed
          ? { expect: 'render', landed, ok: landed === s.path && s.must.test(text), overflow }
          : { expect: 'denied', landed, ok: landed === '/access-denied' }
        if (allowed) {
          await page.screenshot({ path: `${OUT}/${key}-${a.role}${s.path.replace(/\//g, '-')}.png` })
        }
      }

      // one denied screen shot per role, desktop only
      if (key === 'desktop' && a.role !== 'ADMIN') {
        await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(600)
        await page.screenshot({ path: `${OUT}/desktop-${a.role}-04-access-denied.png` })
        R.deniedText = (await page.locator('body').innerText()).slice(0, 120).replace(/\n/g, ' | ')
      }
    } catch (e) {
      R.fatal = String(e.message).split('\n')[0]
    }
    await ctx.close()
  }
}

await browser.close()
results.console = [...new Set(results.console)]
fs.writeFileSync('e2e/results-roundB1.json', JSON.stringify(results, null, 1))
console.log(JSON.stringify(results, null, 1))
