/**
 * Landing hero + Login aside line-art: measured and screenshotted at
 * 1440 and 390, in both motion modes.
 *
 *   node e2e/shot-hero-art.mjs before|after      # headless
 *   HEADED=1 node e2e/shot-hero-art.mjs after    # with a visible window
 *
 * Measures, per screen:
 *  - how many smDraw paths exist
 *  - their stroke-dashoffset on the FIRST frame (1 = undrawn, 0 = complete)
 *    and again after the longest delay+duration has elapsed
 *  - whether the kolam groups actually move, sampled twice a second apart
 *  - the landing header wordmark's line count at 390
 *  - horizontal page overflow
 *
 * parseFloat, not Number: computed values come back as "1px", and Number("1px")
 * is NaN, which an earlier version silently read as "fully drawn".
 */
import fs from 'node:fs'
import {
  launchBrowser,
 BASE } from './lib.mjs'

const tag = process.argv[2] ?? 'shot'
const OUT = `e2e-screenshots/heroart-${tag}`
fs.mkdirSync(OUT, { recursive: true })

const SCREENS = [['landing', '/'], ['login', '/login']]
const browser = await launchBrowser()
const rows = []

const readPaths = () => {
  const p = [...document.querySelectorAll('path[pathLength]')]
  return {
    n: p.length,
    offsets: [...new Set(p.map((x) => parseFloat(getComputedStyle(x).strokeDashoffset) || 0))].sort(),
    dash: [...new Set(p.map((x) => getComputedStyle(x).strokeDasharray))],
  }
}

for (const [screen, path] of SCREENS) {
  for (const [vp, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
    for (const reduced of [false, true]) {
      const ctx = await browser.newContext({
        viewport, reducedMotion: reduced ? 'reduce' : 'no-preference', colorScheme: 'dark',
      })
      const page = await ctx.newPage()
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })

      // First frame: catch the paths before any delay has elapsed.
      // `attached`, not `visible` — PageTransition fades the screen in, and the
      // only thing needed here is the DOM.
      await page.waitForSelector('svg', { state: 'attached', timeout: 15000 })
      const first = await page.evaluate(readPaths).catch(() => ({ n: 0, offsets: [], dash: [] }))

      // Then let every stagger finish (longest is delay 2.4 + 1.4s).
      await page.waitForTimeout(4200)
      const settled = await page.evaluate(readPaths)

      const motion = await page.evaluate(() => new Promise((done) => {
        const spin = [...document.querySelectorAll('svg g')]
          .filter((g) => /smSpin/.test(g.getAttribute('style') || ''))
        const snap = () => spin.map((g) => getComputedStyle(g).transform)
        const t0 = snap()
        setTimeout(() => done({ spinGroups: spin.length, ringsMoving: JSON.stringify(t0) !== JSON.stringify(snap()) }), 1000)
      }))

      const layout = await page.evaluate(() => {
        const d = document.documentElement
        // The wordmark must sit on one line; wrapping mid-word was the 390 bug.
        const mark = [...document.querySelectorAll('span')]
          .find((s) => s.textContent.trim().startsWith('SiddhaMind'))
        let lines = null
        if (mark) {
          const cs = getComputedStyle(mark)
          lines = Math.round(mark.getBoundingClientRect().height / (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2))
        }
        const cta = [...document.querySelectorAll('button')]
          .find((b) => b.textContent.trim() === 'Create account')
        // The login aside is desktop-only (<=760px hides it), so its herb is
        // legitimately absent at 390. Reported rather than treated as missing.
        const aside = document.querySelector('.sm-login-aside')
        return {
          overflow: d.scrollWidth - d.clientWidth,
          wordmarkLines: lines,
          ctaVisible: cta ? getComputedStyle(cta).display !== 'none' : null,
          asideHidden: aside ? getComputedStyle(aside).display === 'none' : null,
        }
      })

      const name = `${screen}-${vp}-${reduced ? 'reduced' : 'motion'}`
      await page.screenshot({ path: `${OUT}/${name}.png` })
      const row = { screen, vp, mode: reduced ? 'reduced' : 'motion', first, settled, ...motion, ...layout }
      rows.push(row)
      console.log(
        `${name.padEnd(26)} paths=${settled.n} first=${JSON.stringify(first.offsets ?? [])}`
        + ` settled=${JSON.stringify(settled.offsets)} dash=${JSON.stringify(settled.dash)}`
        + ` rings=${motion.spinGroups}/${motion.ringsMoving ? 'moving' : 'static'}`
        + ` overflow=${layout.overflow}px wordmark=${layout.wordmarkLines}ln cta=${layout.ctaVisible}`
        + (layout.asideHidden === null ? '' : ` asideHidden=${layout.asideHidden}`))
      await ctx.close()
    }
  }
}

fs.writeFileSync(`${OUT}/probe.json`, JSON.stringify(rows, null, 2))
await browser.close()
