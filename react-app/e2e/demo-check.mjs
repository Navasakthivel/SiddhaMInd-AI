/**
 * Demo readiness check.
 *
 *   node e2e/demo-check.mjs           # headless
 *   HEADED=1 node e2e/demo-check.mjs
 *
 * Exercises the things a live demo actually does, in order:
 *   1. the password reveal toggle on sign-in and registration
 *   2. all four role sign-ins, each landing on its own dashboard
 *   3. Envagai Thervu  — fill eight exams, submit, read the scores back
 *   4. Drug safety     — Linga Chenthuram + Furosemide + Pregnancy -> HIGH
 *   5. Assistant       — a cited answer and an honest refusal
 *   6. Knowledge       — formulary, ingredients, diseases, detail pages
 *   7. Admin           — dashboard, users, corpus, reports
 *
 * Every assertion reads what the page rendered, not what the code should do.
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const HEADED = !['', '0', 'false', 'no'].includes(String(process.env.HEADED ?? '').toLowerCase())

const ACCOUNTS = [
  { role: 'ADMIN', email: 'admin@siddhamind.in', pw: 'admin123', home: '/admin-dashboard' },
  { role: 'PRACTITIONER', email: 'doctor@siddhamind.in', pw: 'doctor123', home: '/practitioner-dashboard' },
  { role: 'STUDENT', email: 'student@siddhamind.in', pw: 'student123', home: '/student-dashboard' },
  { role: 'PATIENT', email: 'patient@siddhamind.in', pw: 'patient123', home: '/patient-dashboard' },
]

const results = []
const ok = (area, name, pass, detail = '') => {
  results.push({ area, name, pass: Boolean(pass), detail: String(detail).slice(0, 220) })
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${area} :: ${name}${detail ? ' — ' + detail : ''}`)
}

async function preflight() {
  for (const [n, u] of [['web', `${BASE}/`],
    ['core', 'http://localhost:8080/siddhamind/internal/health'],
    ['ai', 'http://localhost:8000/health']]) {
    // Generous timeout and retries on purpose. When Gemini hangs, core blocks
    // for the full AI_TIMEOUT_SECONDS (60s default) and stops answering health
    // checks for a moment. That is the AI being slow, not the stack being down,
    // and a 5s preflight was aborting a perfectly usable run because of it.
    let up = false
    for (let i = 0; i < 6 && !up; i += 1) {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(20000) })
        up = r.ok
      } catch { /* retry */ }
      if (!up) await new Promise((res) => setTimeout(res, 5000))
    }
    if (!up) {
      console.error(`stack not ready: ${n} did not respond after retries`)
      console.error('start it with:  python scripts/run.py --no-browser')
      process.exit(1)
    }
  }
  console.log('preflight: web, core and ai responding\n')
}

const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED })
const ctxFor = () => browser.newContext({ viewport: { width: 1440, height: 900 } })

async function signIn(page, a) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#lg-email', a.email)
  await page.fill('#lg-pw', a.pw)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ])
  await page.waitForLoadState('networkidle')
}

// ---------------------------------------------------------------- 1. toggle
{
  await preflight()
  console.log('=== 1. password reveal ===')
  const ctx = await ctxFor(); const page = await ctx.newPage()

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#lg-pw', 'secret123')
  const before = await page.getAttribute('#lg-pw', 'type')
  const eye = page.locator('button[aria-label="Show password"]')
  ok('login', 'reveal button is present', await eye.count() === 1)
  await eye.click()
  const after = await page.getAttribute('#lg-pw', 'type')
  const label = await page.getAttribute('button[aria-pressed="true"]', 'aria-label')
  ok('login', 'click reveals the password', before === 'password' && after === 'text',
    `${before} -> ${after}`)
  ok('login', 'aria-label flips to Hide password', label === 'Hide password', label)
  ok('login', 'value is unchanged by revealing', await page.inputValue('#lg-pw') === 'secret123')
  await page.locator('button[aria-label="Hide password"]').click()
  ok('login', 'click again hides it', await page.getAttribute('#lg-pw', 'type') === 'password')
  // The button must not submit the form.
  ok('login', 'toggling did not submit the form',
    new URL(page.url()).pathname === '/login', new URL(page.url()).pathname)

  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
  await page.fill('#rg-pw', 'newpass123')
  const rEye = page.locator('button[aria-label="Show password"]')
  ok('register', 'reveal button is present', await rEye.count() === 1)
  await rEye.click()
  ok('register', 'click reveals the password',
    await page.getAttribute('#rg-pw', 'type') === 'text')
  ok('register', 'toggling did not submit the form',
    new URL(page.url()).pathname === '/register')
  await ctx.close()
}

// ------------------------------------------------------------- 2. sign-ins
console.log('\n=== 2. role sign-in ===')
for (const a of ACCOUNTS) {
  const ctx = await ctxFor(); const page = await ctx.newPage()
  try {
    await signIn(page, a)
    const landed = new URL(page.url()).pathname
    ok('sign-in', `${a.role} signs in`, true, a.email)
    ok('sign-in', `${a.role} lands on its dashboard`, landed === a.home, `${landed} (want ${a.home})`)
    const me = await page.evaluate(async () =>
      (await fetch('/api/auth/me', { credentials: 'include' })).json())
    ok('sign-in', `${a.role} session carries the right role`, me.role === a.role, `role=${me.role}`)
    const body = await page.innerText('body')
    ok('sign-in', `${a.role} dashboard has real content`,
      body.length > 400 && !/\bundefined\b|\bNaN\b/.test(body), `${body.length} chars`)
  } catch (e) {
    ok('sign-in', `${a.role} signs in`, false, String(e).split('\n')[0])
  }
  await ctx.close()
}

// ------------------------------------------------- 3+4+5. clinical modules
console.log('\n=== 3. Envagai Thervu (diagnosis) ===')
{
  const ctx = await ctxFor(); const page = await ctx.newPage()
  try {
    await signIn(page, ACCOUNTS[1])
    await page.goto(`${BASE}/diagnosis-intake`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    await page.fill('#pt-name', 'Demo Check')
    const sets = page.locator('fieldset')
    const n = await sets.count()
    for (let i = 0; i < n; i += 1) {
      const chip = sets.nth(i).locator('button[aria-pressed]').first()
      if (await chip.count()) await chip.click()
    }
    const chosen = await page.locator('[aria-pressed="true"]').count()
    ok('diagnosis', 'all eight exams answered', chosen === 8, `${chosen}/8 (${n} fieldsets)`)

    await page.click('button[type="submit"]')
    await page.waitForURL('**/diagnosis-results', { timeout: 90000 })
    await page.waitForFunction(() => /Dosha balance|Dominant kutram/i.test(document.body.innerText),
      null, { timeout: 30000 })
    await page.waitForTimeout(2000)
    const body = await page.innerText('body')
    const pcts = [...body.matchAll(/(\d+)%/g)].map((m) => Number(m[1]))
    const sum = pcts.slice(0, 3).reduce((a, b) => a + b, 0)
    ok('diagnosis', 'result page renders', /Dosha balance/i.test(body))
    ok('diagnosis', 'three kutram percentages shown', pcts.length >= 3, pcts.slice(0, 3).join('/'))
    ok('diagnosis', 'percentages total 100', sum === 100, `sum=${sum}`)
    ok('diagnosis', 'a dominant kutram is named', /Vatham|Pitham|Kabam/.test(body))
    ok('diagnosis', 'candidate noi listed', /Candidate noi/i.test(body))
    ok('diagnosis', 'indicated preparations listed', /indicated preparations/i.test(body))

    await page.goto(`${BASE}/diagnosis-history`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    ok('diagnosis', 'history shows the new record',
      (await page.innerText('body')).includes('Demo Check'))
  } catch (e) {
    ok('diagnosis', 'module completed', false, String(e).split('\n')[0])
  }
  await ctx.close()
}

console.log('\n=== 4. drug safety checker ===')
{
  const ctx = await ctxFor(); const page = await ctx.newPage()
  try {
    await signIn(page, ACCOUNTS[1])
    await page.goto(`${BASE}/safety-checker`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const opts = await page.locator('#sf-form option').allTextContents()
    const idx = opts.findIndex((t) => /Linga Chenthuram/i.test(t))
    ok('safety', 'formulations load', opts.length > 1, `${opts.length} options`)
    await page.selectOption('#sf-form', { index: idx > 0 ? idx : 1 })
    await page.fill('#sf-drug', 'Furosemide')
    await page.keyboard.press('Enter')
    await page.locator('button[aria-pressed]', { hasText: /^Pregnancy$/ }).first().click()
    await page.waitForTimeout(400)

    await page.click('button[type="submit"]')
    await page.waitForURL('**/safety-result', { timeout: 90000 })
    await page.waitForFunction(() => /HIGH RISK|ELEVATED|NORMAL/.test(document.body.innerText),
      null, { timeout: 30000 })
    await page.waitForTimeout(1200)
    const body = await page.innerText('body')
    ok('safety', 'verdict is HIGH RISK', /HIGH RISK/.test(body),
      (body.match(/HIGH RISK|ELEVATED|NORMAL/) ?? [''])[0])
    ok('safety', 'the rules that fired are shown', /Interaction|Heavy metal|Contraindication/i.test(body))
    ok('safety', 'Furosemide named in the findings', /Furosemide/i.test(body))
    ok('safety', 'pregnancy contraindication surfaced', /pregnan/i.test(body))
    const hm = await page.evaluate(() => {
      const t = document.querySelector('[role="img"][aria-label*="ceiling"]')
      if (!t) return { present: false }
      return {
        present: true,
        dashed: getComputedStyle(t).borderStyle === 'dashed',
        children: [...t.children].map((c) => getComputedStyle(c).width),
        label: t.getAttribute('aria-label'),
      }
    })
    ok('safety', 'heavy-metal ceiling shown unfilled',
      hm.present && hm.dashed && hm.children.every((w) => parseFloat(w) <= 3),
      JSON.stringify(hm).slice(0, 160))
  } catch (e) {
    ok('safety', 'module completed', false, String(e).split('\n')[0])
  }
  await ctx.close()
}

console.log('\n=== 5. assistant ===')
{
  const ctx = await ctxFor(); const page = await ctx.newPage()
  try {
    await signIn(page, ACCOUNTS[2])
    await page.goto(`${BASE}/assistant`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const status = await page.evaluate(async () =>
      (await fetch('/api/assistant/status', { credentials: 'include' })).json())
    ok('assistant', 'AI service reports available', status.aiAvailable === true,
      `aiAvailable=${status.aiAvailable}`)

    const askAndWait = async (q) => {
      await page.fill('textarea[aria-label="Message"]', q)
      await page.click('button[aria-label="Send"]')
      await page.waitForFunction(() => {
        const t = document.querySelector('[aria-label="Assistant is thinking"]')
        const cited = document.querySelectorAll('article').length > 0
        const panel = /Not found in corpus|could not be reached|could not answer/i
          .test(document.body.innerText)
        return !t && (cited || panel)
      }, null, { timeout: 90000 })
      await page.waitForTimeout(2500)
    }

    await askAndWait('What is the dose of Thiripala Chooranam?')
    const a1 = await page.evaluate(() => ({
      cites: document.querySelectorAll('article').length,
      text: document.body.innerText,
    }))
    ok('assistant', 'answers with at least one citation', a1.cites >= 1, `${a1.cites} citation card(s)`)
    ok('assistant', 'citation names a book and page', /p\.\s*\d+/.test(a1.text))
    ok('assistant', 'no fabricated match score', !/match\s+0?\.\d+/i.test(a1.text))

    await askAndWait('What is the capital city of Iceland?')
    ok('assistant', 'refuses what the corpus does not cover',
      /Not found in corpus/i.test(await page.innerText('body')))
  } catch (e) {
    ok('assistant', 'module completed', false, String(e).split('\n')[0])
  }
  await ctx.close()
}

// ----------------------------------------------------------- 6. knowledge
console.log('\n=== 6. knowledge screens ===')
{
  const ctx = await ctxFor(); const page = await ctx.newPage()
  try {
    await signIn(page, ACCOUNTS[2])
    const api = async (p) => page.evaluate(async (u) =>
      (await fetch(u, { credentials: 'include' })).json(), p)

    const forms = await api('/api/formulary')
    await page.goto(`${BASE}/formulary`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    const cards = await page.locator('button:has-text("SFI-")').count()
    ok('formulary', 'lists every preparation', cards === forms.total, `${cards}/${forms.total}`)

    const linga = forms.results.find((f) => /Linga Chenthuram/i.test(f.nameEnglish)) ?? forms.results[0]
    await page.goto(`${BASE}/formulary/${linga.formId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    const d = await page.innerText('body')
    ok('formulary', 'detail shows ingredients and dose', /Ingredients/i.test(d) && /Dose/i.test(d))
    ok('formulary', 'detail cites its source book', /Source/i.test(d))

    const ing = await api('/api/formulary/ingredients')
    await page.goto(`${BASE}/ingredients`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    ok('ingredients', 'table populated', (await page.locator('tbody tr').count()) === ing.total,
      `${await page.locator('tbody tr').count()}/${ing.total}`)

    const dis = await api('/api/formulary/diseases')
    await page.goto(`${BASE}/diseases`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    ok('diseases', 'noi cards rendered',
      (await page.innerText('body')).includes(dis.diseases[0].noiEnglish), dis.diseases[0].noiEnglish)

    await page.goto(`${BASE}/disease/${dis.diseases[0].diseaseId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    ok('diseases', 'disease detail opens', /Preparations|indicated/i.test(await page.innerText('body')))

    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
    ok('profile', 'profile shows the signed-in account',
      (await page.innerText('body')).includes('student@siddhamind.in'))
  } catch (e) {
    ok('knowledge', 'module completed', false, String(e).split('\n')[0])
  }
  await ctx.close()
}

// --------------------------------------------------------------- 7. admin
console.log('\n=== 7. admin screens ===')
{
  const ctx = await ctxFor(); const page = await ctx.newPage()
  try {
    await signIn(page, ACCOUNTS[0])
    const stats = await page.evaluate(async () =>
      (await fetch('/api/admin/stats', { credentials: 'include' })).json())
    await page.goto(`${BASE}/admin-dashboard`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const b = await page.innerText('body')
    ok('admin', 'dashboard shows live counts', b.includes(String(stats.userCount)),
      `users=${stats.userCount} chunks=${stats.chunkCount}`)
    ok('admin', 'AI status pill reads Connected', /Connected/.test(b))

    const users = await page.evaluate(async () =>
      (await fetch('/api/admin/users', { credentials: 'include' })).json())
    await page.goto(`${BASE}/user-management`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    ok('admin', 'user table matches the API',
      (await page.locator('tbody tr').count()) === users.users.length,
      `${await page.locator('tbody tr').count()}/${users.users.length}`)

    await page.goto(`${BASE}/corpus-upload`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    ok('admin', 'corpus screen lists documents',
      (await page.locator('ol[aria-label="Processing stages"]').count()) > 0)

    await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    ok('admin', 'reports render', /Users per role|Activity/i.test(await page.innerText('body')))
  } catch (e) {
    ok('admin', 'module completed', false, String(e).split('\n')[0])
  }
  await ctx.close()
}

await browser.close()

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('\nFAILURES:')
  for (const f of failed) console.log(`  ${f.area} :: ${f.name} — ${f.detail}`)
}
