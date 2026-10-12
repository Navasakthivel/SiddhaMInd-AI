/**
 * Proves screenshot/index.html works when double-clicked: loaded over file://,
 * every image resolves, and nothing is fetched from the network.
 */
import path from 'node:path'
import { chromium } from 'playwright'

const target = 'file:///' + path.resolve('..', 'screenshot', 'index.html').replace(/\\/g, '/')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })

const failures = []
page.on('requestfailed', (r) => failures.push(`requestfailed ${r.url()}`))
page.on('console', (m) => { if (m.type() === 'error') failures.push(`console ${m.text()}`) })

await page.goto(target, { waitUntil: 'networkidle' })
// Images are lazy; force them in and scroll so every one is actually fetched.
await page.evaluate(() => {
  for (const i of document.querySelectorAll('img')) i.loading = 'eager'
  window.scrollTo(0, document.body.scrollHeight)
})
await page.waitForTimeout(4000)

const r = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('img')]
  return {
    total: imgs.length,
    broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')),
    external: [...document.querySelectorAll('link[href^="http"], script[src], img[src^="http"]')].length,
    sections: [...document.querySelectorAll('section')].map((s) => s.id),
  }
})

console.log(`  url                : ${target}`)
console.log(`  images             : ${r.total}`)
console.log(`  broken images      : ${r.broken.length}${r.broken.length ? ' ' + r.broken.slice(0, 3).join(', ') : ''}`)
console.log(`  external/CDN refs  : ${r.external}`)
console.log(`  sections           : ${r.sections.join(', ')}`)
console.log(`  network/console errs: ${failures.length}${failures.length ? ' ' + failures.slice(0, 3).join(' | ') : ''}`)

await page.screenshot({ path: path.resolve('..', 'screenshot', '_gallery-preview.png') })
await browser.close()
