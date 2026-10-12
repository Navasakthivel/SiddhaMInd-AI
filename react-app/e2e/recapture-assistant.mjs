/**
 * Re-capture 20b only: the Assistant showing a settled, cited answer.
 *
 * The first pass used a fixed 12s wait and caught the thinking dots instead of
 * the reply — the AI service was reachable and simply slower than the guess.
 * This waits for the answer to actually exist (a citation card, or the
 * not-found / offline panel) and only then takes the shot, so the timing of
 * one model call cannot decide whether the screenshot is usable.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const ROOT = path.resolve('..', 'screenshot')
const QUESTION = 'What is the dose of Thiripala Chooranam?'

const ALL = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
}
// Optional argv filter, so one viewport can be redone on its own.
const only = process.argv[2]
const VIEWPORTS = only ? { [only]: ALL[only] } : ALL
const MAX_TRIES = 3

const browser = await chromium.launch({ channel: 'chrome', headless: true })

for (const [pass, viewport] of Object.entries(VIEWPORTS)) {
 for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
  const ctx = await browser.newContext({ viewport, colorScheme: 'dark' })
  await ctx.addInitScript(() => {
    try { localStorage.setItem('siddhamind:theme', 'dark') } catch { /* private mode */ }
  })
  const page = await ctx.newPage()

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#lg-email', 'student@siddhamind.in')
  await page.fill('#lg-pw', 'student123')
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ])

  await page.goto(`${BASE}/assistant`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.fill('textarea[aria-label="Message"]', QUESTION)
  await page.click('button[aria-label="Send"]')

  // The reply has landed when the thinking dots are gone AND some assistant
  // output exists. Either a citation card or one of the refusal panels counts:
  // the point is that nothing is still in flight.
  await page.waitForFunction(() => {
    const thinking = document.querySelector('[aria-label="Assistant is thinking"]')
    const cited = document.querySelectorAll('article').length > 0
    const panel = /Not found in corpus|could not be reached|could not answer/i
      .test(document.body.innerText)
    return !thinking && (cited || panel)
  }, null, { timeout: 90000 })

  // Then let the typing reveal finish (capped ~1.6s) before the shutter.
  await page.waitForTimeout(3000)

  const outcome = await page.evaluate(() => ({
    citations: document.querySelectorAll('article').length,
    notFound: /Not found in corpus/i.test(document.body.innerText),
    offline: /could not be reached/i.test(document.body.innerText),
  }))

  // A server-side "temporarily unavailable" is a real transient (the model
  // rate-limiting after several rapid calls), not the state this shot is for.
  // Retry rather than ship a screenshot of an outage as if it were the feature.
  const errored = await page.evaluate(() =>
    /could not answer this one|temporarily unavailable|could not be reached/i
      .test(document.body.innerText))
  if (errored && attempt < MAX_TRIES) {
    console.log(`  ${pass}: assistant errored (attempt ${attempt}) - waiting 30s and retrying`)
    await ctx.close()
    await new Promise((r) => setTimeout(r, 30000))
    continue
  }

  const file = path.join(ROOT, pass, '20b-assistant-answer.png')
  await page.screenshot({ path: file, fullPage: true })
  const kb = Math.round(fs.statSync(file).size / 1024)
  console.log(`  ${pass}/20b-assistant-answer.png  ${kb}kB  `
    + `citations=${outcome.citations} notFound=${outcome.notFound} `
    + `errored=${errored} attempt=${attempt}`)

  await ctx.close()
  break
 }
}

await browser.close()
