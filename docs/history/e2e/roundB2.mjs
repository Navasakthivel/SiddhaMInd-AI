import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:5173'
const OUT = 'e2e-screenshots/roundB2'
fs.mkdirSync(OUT, { recursive: true })
const R = { clinical: {}, backend: {}, screens: {}, console: [] }

const browser = await chromium.launch({ channel: 'chrome', headless: false })

async function login(page, email, pw) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#lg-email', email)
  await page.fill('#lg-pw', pw)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 25000 })
  await page.waitForLoadState('networkidle')
}

/** Fills the 8 exam cards by clicking the first chip in each fieldset. */
async function fillExam(page) {
  await page.goto(`${BASE}/diagnosis-intake`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.fill('#pt-name', 'E2E Patient')
  const sets = page.locator('fieldset')
  const n = await sets.count()
  for (let i = 0; i < n; i += 1) {
    const chip = sets.nth(i).locator('button[aria-pressed]').first()
    if (await chip.count()) await chip.click()
  }
  // Wait for React to commit all eight selections. Submitting while the last
  // setState is still queued reads a stale `exam` and the handler bails.
  await page.waitForFunction(
    (want) => document.querySelectorAll('[aria-pressed="true"]').length === want, 8,
    { timeout: 8000 },
  ).catch(() => {})
  await page.waitForTimeout(400)
  return page.locator('[aria-pressed="true"]').count()
}

/* ============ 1. dosha: digits final on frame 1, rings sweep ============ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') R.console.push(m.text()) })
  page.on('pageerror', (e) => R.console.push('PAGEERROR ' + e.message))
  await login(page, 'doctor@siddhamind.in', 'doctor123')

  R.screens.intakeChipsSelected = await fillExam(page)
  await page.screenshot({ path: `${OUT}/10-intake.png` })

  // Sample from before submit so the very first painted frame is captured.
  await page.evaluate(() => {
    window.__d = []
    const tick = () => {
      const rings = [...document.querySelectorAll('svg circle[pathLength]')]
      const digits = [...document.querySelectorAll('span')]
        .filter((s) => /^\d+%$/.test(s.textContent.trim()))
      if (digits.length) {
        window.__d.push({
          t: Math.round(performance.now()),
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
  await page.waitForURL('**/diagnosis-results', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(220)
  await page.screenshot({ path: `${OUT}/11-dosha-EARLY.png` })
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${OUT}/11-dosha-SETTLED.png` })

  const d = await page.evaluate(() => window.__d ?? [])
  if (d.length) {
    const first = d[0], last = d[d.length - 1]
    R.clinical.doshaSamples = d.length
    R.clinical.doshaFirstDigits = first.dig
    R.clinical.doshaLastDigits = last.dig
    R.clinical.doshaDigitsStable = JSON.stringify(first.dig) === JSON.stringify(last.dig)
    R.clinical.doshaDigitOpacityMin = Math.min(...d.flatMap((x) => x.op))
    R.clinical.doshaFirstOffsets = first.off
    R.clinical.doshaLastOffsets = last.off
    R.clinical.doshaRingsSwept = JSON.stringify(first.off) !== JSON.stringify(last.off)
  }

  // sessionStorage survives reload
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const after = await page.locator('body').innerText()
  R.clinical.readingSurvivesReload = !/No reading to show/.test(after)
  R.clinical.reloadUrl = new URL(page.url()).pathname
  await page.screenshot({ path: `${OUT}/11-dosha-AFTER-RELOAD.png` })
  await ctx.close()
}

/* ============ 2. reduced motion: rings start at final offset ============ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await login(page, 'doctor@siddhamind.in', 'doctor123')
  await fillExam(page)
  await page.evaluate(() => {
    window.__r = []
    const tick = () => {
      const rings = [...document.querySelectorAll('svg circle[pathLength]')]
      if (rings.length) window.__r.push(rings.map((c) => Math.round(parseFloat(getComputedStyle(c).strokeDashoffset) || 0)))
      if (window.__r.length < 50) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.click('button[type="submit"]')
  await page.waitForURL('**/diagnosis-results', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1800)
  const r = await page.evaluate(() => window.__r ?? [])
  R.clinical.rmSamples = r.length
  R.clinical.rmFirst = r[0]
  R.clinical.rmLast = r[r.length - 1]
  R.clinical.rmRingsStatic = r.length > 1 ? JSON.stringify(r[0]) === JSON.stringify(r[r.length - 1]) : null
  await page.screenshot({ path: `${OUT}/11-dosha-reduced-motion.png` })
  await ctx.close()
}

/* ============ 3. safety: verdict opacity, heavy-metal bar ============ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') R.console.push(m.text()) })
  await login(page, 'doctor@siddhamind.in', 'doctor123')
  await page.goto(`${BASE}/safety-checker`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)

  // Thiripala Churanam + Warfarin = MAJOR, the known HIGH case.
  const opts = await page.locator('#sf-form option').allTextContents()
  // Linga Chenthuram carries mercury, so the heavy-metal ceiling card renders.
  // Thiripala Churanam reports heavyMetalDailyLimitMg 0 and correctly hides it.
  const idx = opts.findIndex((t) => /Linga Chenthuram/i.test(t))
  await page.selectOption('#sf-form', { index: idx > 0 ? idx : 1 })
  R.screens.safetyFormulation = opts[idx > 0 ? idx : 1]
  await page.fill('#sf-drug', 'Furosemide')
  await page.keyboard.press('Enter')
  await page.locator('button[aria-pressed]').first().click()   // one condition chip
  await page.screenshot({ path: `${OUT}/13-safety-checker.png` })

  await page.evaluate(() => {
    window.__s = []
    const tick = () => {
      const band = document.querySelector('h2')?.closest('section')
      const badge = [...document.querySelectorAll('span')]
        .find((s) => /HIGH RISK|ELEVATED|NORMAL/.test(s.textContent.trim()))
      const head = badge?.parentElement?.querySelector('h2')
      if (badge) {
        window.__s.push({
          t: Math.round(performance.now()),
          badge: parseFloat(getComputedStyle(badge).opacity),
          headline: head ? parseFloat(getComputedStyle(head).opacity) : null,
          card: band ? parseFloat(getComputedStyle(band).opacity) : null,
          tf: band ? getComputedStyle(band).transform : null,
        })
      }
      if (window.__s.length < 90) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.click('button[type="submit"]')
  await page.waitForURL('**/safety-result', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(260)
  await page.screenshot({ path: `${OUT}/14-safety-result-EARLY.png` })
  await page.waitForTimeout(1600)
  await page.screenshot({ path: `${OUT}/14-safety-result.png` })

  const s = await page.evaluate(() => window.__s ?? [])
  R.clinical.verdictSamples = s.length
  if (s.length) {
    R.clinical.verdictBadgeOpacityMin = Math.min(...s.map((x) => x.badge))
    R.clinical.verdictHeadlineOpacityMin = Math.min(...s.map((x) => x.headline).filter((v) => v != null))
    R.clinical.verdictCardOpacityMin = Math.min(...s.map((x) => x.card).filter((v) => v != null))
    R.clinical.verdictTransforms = [...new Set(s.map((x) => x.tf))].slice(0, 4)
  }
  R.clinical.verdictText = (await page.locator('body').innerText()).slice(0, 200).replace(/\n/g, ' | ')

  // heavy-metal track: present, dashed, and EMPTY
  R.clinical.heavyMetal = await page.evaluate(() => {
    const track = document.querySelector('[role="img"][aria-label*="ceiling"]')
    if (!track) return { present: false }
    const cs = getComputedStyle(track)
    const kids = [...track.children]
    return {
      present: true,
      borderStyle: cs.borderStyle,
      backgroundImage: cs.backgroundImage,
      childCount: kids.length,
      // the only child must be the 2px ceiling marker, not a fill
      childWidths: kids.map((k) => getComputedStyle(k).width),
      label: track.getAttribute('aria-label'),
    }
  })

  // reload survival
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  R.clinical.verdictSurvivesReload = !/No verdict to show/.test(await page.locator('body').innerText())
  await ctx.close()
}

/* ============ 4. backend additions ============ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await login(page, 'student@siddhamind.in', 'student123')
  R.backend = await page.evaluate(async () => {
    const list = await (await fetch('/api/formulary/diseases', { credentials: 'include' })).json()
    const withCount = list.diseases.filter((d) => d.preparationCount > 0)
    const target = withCount[0] ?? list.diseases[0]
    const detail = await (await fetch(`/api/formulary/diseases/${target.diseaseId}`, { credentials: 'include' })).json()
    return {
      everyDiseaseHasCount: list.diseases.every((d) => typeof d.preparationCount === 'number'),
      sampleCounts: list.diseases.slice(0, 4).map((d) => [d.noiEnglish, d.preparationCount]),
      detailFormulationSample: detail.formulations?.[0]
        ? {
            sfiCode: detail.formulations[0].sfiCode,
            sourceBook: detail.formulations[0].sourceBook,
            pageNo: detail.formulations[0].pageNo,
          }
        : null,
    }
  })
  await page.goto(`${BASE}/diseases`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800)
  R.screens.diseasesShowsCount = /Preparations:\s*\d/.test(await page.locator('body').innerText())
  await page.screenshot({ path: `${OUT}/16b-diseases.png` })
  const first = page.locator('button').filter({ hasText: 'Preparations:' }).first()
  if (await first.count()) { await first.click(); await page.waitForTimeout(900) }
  R.screens.detailShowsCitation = /p\.\s*\d/.test(await page.locator('body').innerText())
  await page.screenshot({ path: `${OUT}/16c-disease-detail.png` })
  await ctx.close()
}

/* ============ 5. mobile sweep ============ */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await login(page, 'doctor@siddhamind.in', 'doctor123')
  R.screens.mobile = {}
  for (const [path, name] of [['/diagnosis-intake', '10'], ['/safety-checker', '13']]) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    R.screens.mobile[path] = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 ? 'OVERFLOW' : 'ok')
    await page.screenshot({ path: `${OUT}/mobile-${name}.png` })
  }
  await ctx.close()
}

await browser.close()
R.console = [...new Set(R.console)]
fs.writeFileSync('e2e/results-roundB2.json', JSON.stringify(R, null, 1))
console.log(JSON.stringify(R, null, 1))
