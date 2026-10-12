import { chromium } from 'playwright'
import fs from 'node:fs'
const out = {}
const b = await chromium.launch({ channel: 'chrome', headless: false })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
fs.mkdirSync('e2e-screenshots/clinical', { recursive: true })
await p.goto('http://localhost:5173/login', { waitUntil: 'networkidle' })
await p.fill('#login-id','doctor@siddhamind.in'); await p.fill('#login-password','doctor123')
await p.click('button.sm-btn-status'); await p.waitForURL(u=>!u.pathname.endsWith('/login'),{timeout:20000})

/* ---- VERDICT: opacity must never be < 1 ---- */
await p.goto('http://localhost:5173/safety-checker', { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
await p.selectOption('select[name="preparation"]', { index: 10 })   // Thiripala Churanam
out.preparation = await p.locator('select[name="preparation"]').inputValue()
await p.fill('input[name="concurrentMedication"]', 'Warfarin')
await p.evaluate(() => { window.__s=[]; const t=()=>{ const badge=document.querySelector('.sm-risk-badge'), head=document.querySelector('.sm-verdict-headline'), card=document.querySelector('.sm-verdict-card');
  if(badge||head) window.__s.push({t:Math.round(performance.now()), badge:badge?+getComputedStyle(badge).opacity:null, headline:head?+getComputedStyle(head).opacity:null, card:card?+getComputedStyle(card).opacity:null, tf:card?getComputedStyle(card).transform:null});
  if(window.__s.length<80) requestAnimationFrame(t)}; requestAnimationFrame(t) })
await p.click('button[type="submit"]')
await p.waitForTimeout(500); out.toastSafety = await p.locator('.sm-toast').first().innerText().catch(()=>null)
await p.waitForTimeout(1500)
out.verdictUrl = new URL(p.url()).pathname
const s = await p.evaluate(()=>window.__s??[])
out.verdictSampleCount = s.length
out.verdictBadgeOpacityMin = Math.min(...s.map(x=>x.badge).filter(v=>v!==null))
out.verdictHeadlineOpacityMin = Math.min(...s.map(x=>x.headline).filter(v=>v!==null))
out.verdictCardOpacityMin = Math.min(...s.map(x=>x.card).filter(v=>v!==null))
out.verdictCardTransforms = [...new Set(s.map(x=>x.tf))].slice(0,4)
out.verdictText = (await p.locator('.sm-verdict-card').innerText().catch(()=>'')).replace(/\n/g,' | ').slice(0,180)
await p.screenshot({ path: 'e2e-screenshots/clinical/verdict.png' })

/* ---- DOSHA: arcs sweep, digits final ---- */
await p.goto('http://localhost:5173/diagnosis-intake', { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
await p.locator('input:not([type]):visible').first().fill('E2E Patient')
const sels = p.locator('select'); const n = await sels.count()
for (let i=0;i<n;i++) await sels.nth(i).selectOption({ index: 1 }).catch(()=>{})
await p.waitForTimeout(300)
out.doshaSubmitEnabled = await p.locator('button[type="submit"]').first().isEnabled()
await p.evaluate(() => { window.__d=[]; const t=()=>{ const arcs=[...document.querySelectorAll('.sm-dosha-ring-wrap svg circle')].slice(1), v=[...document.querySelectorAll('.sm-dosha-ring-value')];
  if(v.length) window.__d.push({t:Math.round(performance.now()), off:arcs.map(c=>Math.round(parseFloat(getComputedStyle(c).strokeDashoffset)||0)), dig:v.map(x=>x.textContent.trim()), op:v.map(x=>+getComputedStyle(x).opacity)});
  if(window.__d.length<90) requestAnimationFrame(t)}; requestAnimationFrame(t) })
await p.click('button[type="submit"]')
await p.waitForTimeout(220); await p.screenshot({ path: 'e2e-screenshots/clinical/dosha-EARLY.png' })
await p.waitForTimeout(1500); await p.screenshot({ path: 'e2e-screenshots/clinical/dosha-SETTLED.png' })
const d = await p.evaluate(()=>window.__d??[])
out.doshaSampleCount = d.length
if (d.length) {
  out.doshaFirstDigits = d[0].dig; out.doshaLastDigits = d[d.length-1].dig
  out.doshaDigitsStable = JSON.stringify(d[0].dig)===JSON.stringify(d[d.length-1].dig)
  out.doshaDigitOpacityMin = Math.min(...d.flatMap(x=>x.op))
  out.doshaFirstOffsets = d[0].off; out.doshaLastOffsets = d[d.length-1].off
  out.doshaArcsSwept = JSON.stringify(d[0].off)!==JSON.stringify(d[d.length-1].off)
}
/* ---- reduced-motion dosha ---- */
await ctx.close()
const ctx2 = await b.newContext({ viewport:{width:1440,height:900}, reducedMotion:'reduce' })
const p2 = await ctx2.newPage()
await p2.goto('http://localhost:5173/login',{waitUntil:'networkidle'})
await p2.fill('#login-id','doctor@siddhamind.in'); await p2.fill('#login-password','doctor123')
await p2.click('button.sm-btn-status'); await p2.waitForURL(u=>!u.pathname.endsWith('/login'),{timeout:20000})
await p2.goto('http://localhost:5173/diagnosis-intake',{waitUntil:'networkidle'})
await p2.waitForTimeout(900)
await p2.locator('input:not([type]):visible').first().fill('RM Patient')
const s2=p2.locator('select'); const n2=await s2.count()
for(let i=0;i<n2;i++) await s2.nth(i).selectOption({index:1}).catch(()=>{})
await p2.evaluate(()=>{window.__r=[];const t=()=>{const a=[...document.querySelectorAll('.sm-dosha-ring-wrap svg circle')].slice(1);
  if(a.length) window.__r.push(a.map(c=>Math.round(parseFloat(getComputedStyle(c).strokeDashoffset)||0)));
  if(window.__r.length<50) requestAnimationFrame(t)};requestAnimationFrame(t)})
await p2.click('button[type="submit"]')
await p2.waitForTimeout(1600)
const r = await p2.evaluate(()=>window.__r??[])
out.rmDoshaFirst = r[0]; out.rmDoshaLast = r[r.length-1]
out.rmDoshaStatic = r.length>1 ? JSON.stringify(r[0])===JSON.stringify(r[r.length-1]) : null
await p2.screenshot({ path:'e2e-screenshots/clinical/dosha-reduced-motion.png' })
await b.close().catch(()=>{})
fs.writeFileSync('e2e/results-clinical.json', JSON.stringify(out,null,2))
console.log(JSON.stringify(out,null,1))
