/** Why does the diagnosis form stop submitting after a viewport resize? */
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true })

for (const resizeBetween of [false, true]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  const errs = []
  const calls = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)) })
  page.on('response', async (r) => {
    const u = new URL(r.url()).pathname
    if (!u.startsWith('/api')) return
    let body = ''
    if (r.status() >= 400) { body = (await r.text().catch(() => '')).slice(0, 160) }
    calls.push(`${r.request().method()} ${u} -> ${r.status()}${body ? ' ' + body : ''}`)
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#lg-email', 'doctor@siddhamind.in')
  await page.fill('#lg-pw', 'doctor123')
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith('/login')), page.click('button[type="submit"]')])

  await page.goto(`${BASE}/diagnosis-intake`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.fill('#pt-name', 'Resize Probe')
  const sets = page.locator('fieldset')
  for (let i = 0; i < await sets.count(); i += 1) {
    const chip = sets.nth(i).locator('button[aria-pressed]').first()
    if (await chip.count()) await chip.click()
  }
  await page.waitForFunction((w) => document.querySelectorAll('[aria-pressed="true"]').length === w, 8,
    { timeout: 10000 }).catch(() => {})

  const before = await page.locator('[aria-pressed="true"]').count()
  const nameBefore = await page.inputValue('#pt-name')

  if (resizeBetween) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.setViewportSize({ width: 1440, height: Math.min(h, 6000) })
    await page.waitForTimeout(700)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(500)
  }

  const after = await page.locator('[aria-pressed="true"]').count()
  const nameAfter = await page.inputValue('#pt-name')

  await page.click('button[type="submit"]')
  let navigated = true
  await page.waitForURL('**/diagnosis-results', { timeout: 20000 }).catch(() => { navigated = false })

  const body = await page.innerText('body')
  const alert = (body.match(/[^\n]*(required|Answer all|Select|must)[^\n]*/i) ?? [''])[0].slice(0, 120)

  console.log(`resize=${String(resizeBetween).padEnd(5)} chips ${before}->${after}  name "${nameBefore}"->"${nameAfter}"  navigated=${navigated}`)
  if (!navigated) {
    console.log(`   url   : ${new URL(page.url()).pathname}`)
    console.log(`   alert : ${alert || '(none found)'}`)
    console.log(`   errors: ${errs.slice(0, 2).join(' | ') || '(none)'}`)
    console.log('   api calls after login:')
    for (const c of calls.filter((c) => !c.includes('/auth/me -> 401')).slice(-8)) console.log('     ' + c)
  }
  await ctx.close()
}
await browser.close()
