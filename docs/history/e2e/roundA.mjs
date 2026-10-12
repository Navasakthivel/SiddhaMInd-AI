import { chromium } from 'playwright'
import fs from 'node:fs'
fs.mkdirSync('e2e-screenshots/roundA', { recursive: true })
const errs = []
const b = await chromium.launch({ channel: 'chrome', headless: false })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
p.on('console', m => { if (m.type()==='error') errs.push(m.text()) })
p.on('pageerror', e => errs.push('PAGEERROR '+e.message))
p.on('requestfailed', r => errs.push('REQFAIL '+r.url()+' '+r.failure()?.errorText))

await p.goto('http://localhost:5173/login', { waitUntil:'networkidle' })
await p.fill('#login-id','doctor@siddhamind.in'); await p.fill('#login-password','doctor123')
await p.click('button.sm-btn-status'); await p.waitForURL(u=>!u.pathname.endsWith('/login'),{timeout:20000})
await p.waitForLoadState('networkidle'); await p.waitForTimeout(1200)

const probe = async () => p.evaluate(() => {
  const cs = getComputedStyle(document.body)
  const trig = document.querySelector('.sm-palette-trigger')
  const aside = document.querySelector('aside[aria-label="Main navigation"]')
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    bodyBg: cs.backgroundColor, bodyFont: cs.fontFamily.split(',')[0],
    h1Font: getComputedStyle(document.querySelector('h1')).fontFamily.split(',')[0],
    sidebarVisible: aside ? getComputedStyle(aside).transform : 'MISSING',
    paletteTriggerVisible: trig ? trig.getBoundingClientRect().width > 0 : false,
    themeToggleVisible: !!document.querySelector('[aria-label*="Switch to"]'),
    bellVisible: !!document.querySelector('[aria-label^="Notifications"]'),
    signOutVisible: [...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='Sign out'),
    navLabels: [...document.querySelectorAll('aside nav a')].map(a=>a.textContent.trim()),
    sections: [...document.querySelectorAll('aside nav > div > div')].filter(d=>d.style.textTransform==='uppercase').map(d=>d.textContent.trim()),
  }
})
const dark = await probe()
await p.screenshot({ path:'e2e-screenshots/roundA/01-dark.png' })
await p.click('[aria-label*="Switch to"]'); await p.waitForTimeout(500)
const light = await probe()
await p.screenshot({ path:'e2e-screenshots/roundA/02-light.png' })

// a Round-B placeholder route must render, not bounce
await p.goto('http://localhost:5173/diagnosis-history', { waitUntil:'networkidle' })
await p.waitForTimeout(800)
const placeholder = { url:new URL(p.url()).pathname, text:(await p.locator('body').innerText()).slice(0,90).replace(/\n/g,' | ') }
await p.screenshot({ path:'e2e-screenshots/roundA/03-placeholder.png' })

// mobile drawer
await p.setViewportSize({ width:390, height:844 }); await p.goto('http://localhost:5173/formulary',{waitUntil:'networkidle'}); await p.waitForTimeout(700)
const mobBefore = await p.evaluate(()=>getComputedStyle(document.querySelector('aside[aria-label="Main navigation"]')).transform)
await p.click('[aria-label="Open menu"]'); await p.waitForTimeout(600)
const mobAfter = await p.evaluate(()=>getComputedStyle(document.querySelector('aside[aria-label="Main navigation"]')).transform)
await p.screenshot({ path:'e2e-screenshots/roundA/04-drawer.png' })

console.log(JSON.stringify({dark,light,placeholder,mobile:{closed:mobBefore,open:mobAfter},errors:[...new Set(errs)]},null,1))
await b.close()
