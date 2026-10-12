/**
 * Re-capture only 11-diagnosis-result and the 20-assistant screens,
 * desktop + mobile, into screenshot/.
 *
 *   node e2e/recapture-two.mjs
 *
 * Everything else in screenshot/ is left alone.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const ROOT = path.resolve('..', 'screenshot')
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } }

const shot = async (page, pass, file) => {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('.sm-toast-close')) b.click()
    window.scrollTo(0, 0)
  }).catch(() => {})
  await page.waitForTimeout(350)
  // Grow the viewport rather than fullPage: the Shell's fixed sidebar is
  // composited at the scroll offset when Playwright stitches a long page.
  const base = VIEWPORTS[pass]
  const h = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight))
  const tall = Math.min(Math.max(h, base.height), 6000)
  if (tall !== base.height) {
    await page.setViewportSize({ width: base.width, height: tall })
    await page.waitForTimeout(500)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(250)
  }
  const dir = path.join(ROOT, pass)
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `${file}.png`)
  await page.screenshot({ path: out })
  if (tall !== base.height) await page.setViewportSize(base)
  console.log(`  ${pass}/${file}.png  ${Math.round(fs.statSync(out).size / 1024)}kB`)
}

const signIn = async (page, email, pw) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#lg-email', email)
  await page.fill('#lg-pw', pw)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ])
  await page.waitForLoadState('networkidle')
}

const waitForReply = (page) => page.waitForFunction(() => {
  const t = document.querySelector('[aria-label="Assistant is thinking"]')
  const cited = document.querySelectorAll('article').length > 0
  const panel = /Not found in corpus|could not be reached|could not answer/i.test(document.body.innerText)
  return !t && (cited || panel)
}, null, { timeout: 90000 })

const browser = await chromium.launch({ channel: 'chrome', headless: true })

for (const pass of ['desktop', 'mobile']) {
  console.log(`\n=== ${pass} ===`)

  // ---- 11 diagnosis result ----
  {
    const ctx = await browser.newContext({ viewport: VIEWPORTS[pass], colorScheme: 'dark' })
    await ctx.addInitScript(() => {
      try { localStorage.setItem('siddhamind:theme', 'dark') } catch { /* private mode */ }
    })
    const page = await ctx.newPage()
    await signIn(page, 'doctor@siddhamind.in', 'doctor123')
    await page.goto(`${BASE}/diagnosis-intake`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    await page.fill('#pt-name', 'Demo Reading')
    const sets = page.locator('fieldset')
    for (let i = 0; i < await sets.count(); i += 1) {
      const c = sets.nth(i).locator('button[aria-pressed]').first()
      if (await c.count()) await c.click()
    }
    await page.waitForFunction((w) => document.querySelectorAll('[aria-pressed="true"]').length === w,
      8, { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(400)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/diagnosis-results', { timeout: 90000 })
    await page.waitForFunction(() => /Dosha balance/i.test(document.body.innerText),
      null, { timeout: 30000 })
    await page.waitForTimeout(2500)   // ring sweep 1.4s + AI summary
    const hasAi = /AI SUMMARY/i.test(await page.innerText('body'))
    await shot(page, pass, '11-diagnosis-result')
    console.log(`    AI summary panel present: ${hasAi}`)
    await ctx.close()
  }

  // ---- 20 assistant: empty, cited answer, not found ----
  {
    const ctx = await browser.newContext({ viewport: VIEWPORTS[pass], colorScheme: 'dark' })
    await ctx.addInitScript(() => {
      try { localStorage.setItem('siddhamind:theme', 'dark') } catch { /* private mode */ }
    })
    const page = await ctx.newPage()
    await signIn(page, 'student@siddhamind.in', 'student123')
    await page.goto(`${BASE}/assistant`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    await shot(page, pass, '20a-assistant-empty')

    await page.fill('textarea[aria-label="Message"]', 'What is the dose of Thiripala Chooranam?')
    await page.click('button[aria-label="Send"]')
    await waitForReply(page)
    await page.waitForTimeout(3000)
    const cites = await page.locator('article').count()
    await shot(page, pass, '20b-assistant-answer')
    console.log(`    citation cards: ${cites}`)

    await page.fill('textarea[aria-label="Message"]', 'What is the capital city of Iceland?')
    await page.click('button[aria-label="Send"]')
    await waitForReply(page)
    await page.waitForTimeout(2500)
    const nf = /Not found in corpus/i.test(await page.innerText('body'))
    await shot(page, pass, '20c-assistant-not-found')
    console.log(`    not-found panel: ${nf}`)
    await ctx.close()
  }
}

await browser.close()
