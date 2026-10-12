/**
 * Landing-hero screenshots at 1440 and 390, in both motion modes.
 *
 *   node e2e/shot-landing.mjs before|after       # headless
 *   HEADED=1 node e2e/shot-landing.mjs after     # with a visible window
 *
 * The hero art is time-based (smDraw runs on a delay out to 2.4s, the kolam
 * rings turn over 110-160s), so each shot waits 4s after load: long enough for
 * every drawing delay to have elapsed, short enough that the rings have barely
 * moved and the two runs stay comparable.
 */
import fs from 'node:fs'
import {
  launchBrowser,
 BASE } from './lib.mjs'

const tag = process.argv[2] ?? 'shot'
const OUT = `e2e-screenshots/landing-${tag}`
fs.mkdirSync(OUT, { recursive: true })

const browser = await launchBrowser()
const report = []

for (const [vp, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  for (const reduced of [false, true]) {
    const ctx = await browser.newContext({
      viewport,
      reducedMotion: reduced ? 'reduce' : 'no-preference',
      colorScheme: 'dark',
    })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(4000)

    // Measures MOVEMENT, not whether an animation is assigned.
    //
    // tokens.css snaps every animation to .001ms under prefers-reduced-motion,
    // so `animationName` stays set even when nothing moves. Sampling the
    // transform twice, a second apart, is the only honest way to tell "static"
    // from "assigned but finished".
    const probe = await page.evaluate(() => new Promise((done) => {
      const spin = [...document.querySelectorAll('svg g')]
        .filter((g) => /smSpin/.test(g.getAttribute('style') || ''))
      const snap = () => spin.map((g) => getComputedStyle(g).transform)
      const t0 = snap()
      setTimeout(() => {
        const drawn = [...document.querySelectorAll('path[pathLength]')]
        const t1 = snap()
        done({
          herbPaths: drawn.length,
          // 0 means fully drawn.
          offsets: [...new Set(drawn.map((p) => parseFloat(getComputedStyle(p).strokeDashoffset) || 0))],
          fullyDrawn: drawn.every((p) => (parseFloat(getComputedStyle(p).strokeDashoffset) || 0) === 0),
          spinGroups: spin.length,
          ringsMoving: JSON.stringify(t0) !== JSON.stringify(t1),
        })
      }, 1000)
    }))
    const name = `landing-${vp}-${reduced ? 'reduced' : 'motion'}`
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
    await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true })
    report.push({ shot: name, ...probe })
    console.log(name, JSON.stringify(probe))
    await ctx.close()
  }
}

fs.writeFileSync(`${OUT}/probe.json`, JSON.stringify(report, null, 2))
await browser.close()
