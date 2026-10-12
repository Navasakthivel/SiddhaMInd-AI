import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'chrome', headless: false })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 })
console.log('TITLE:', await p.title())
console.log('H1   :', (await p.locator('h1').first().innerText().catch(() => '(none)')).slice(0, 70))
await b.close()
console.log('OK')
