/**
 * Builds screenshot/README.md and screenshot/index.html from manifest.json.
 *
 *   node e2e/build-gallery.mjs
 *
 * The gallery is deliberately a single self-contained file: no CDN, no build
 * step, no fetch(). It has to work when someone double-clicks it off a USB
 * stick with no network, which rules out loading the manifest at runtime — so
 * the captions are inlined as static markup.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve('..', 'screenshot')
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'))

const PASSES = [
  ['desktop', 'Desktop', '1440 × 900, dark theme'],
  ['mobile', 'Mobile', '390 × 844, dark theme'],
  ['light', 'Light theme', '1440 × 900, landing and one dashboard per role'],
]

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ----------------------------------------------------------------- README
const rows = []
rows.push('# SiddhaMind AI — screen captures', '')
rows.push(`Captured ${new Date().toISOString().slice(0, 10)} from the running stack `
  + '(siddhamind-core + siddhamind-ai + react-app) in headless Chrome.', '')
rows.push('Full-page screenshots. Every page was given `networkidle` plus 1.5s so entrance')
rows.push('animations and the dosha ring sweep had finished before the shutter.', '')

for (const [dir, title, sub] of PASSES) {
  const items = manifest.filter((m) => m.pass === dir)
  if (!items.length) continue
  rows.push(`## ${title}`, '', `\`screenshot/${dir}/\` — ${sub}`, '')
  rows.push('| File | Page | Role | What it shows |')
  rows.push('|---|---|---|---|')
  for (const m of items) {
    const note = m.issues ? ` **⚠ ${esc(m.issues)}**` : ''
    rows.push(`| \`${m.file}.png\` | ${m.page} | ${m.role} | ${m.shows}${note} |`)
  }
  rows.push('')
}

rows.push('## Viewing', '', 'Open `index.html` in any browser — it is offline-only, with no CDN or',
  'network calls, so double-clicking the file works.', '')
fs.writeFileSync(path.join(ROOT, 'README.md'), rows.join('\n'))

// ------------------------------------------------------------------- HTML
const section = ([dir, title, sub]) => {
  const items = manifest.filter((m) => m.pass === dir)
  if (!items.length) return ''
  const cards = items.map((m) => `
      <figure class="card">
        <a href="${dir}/${m.file}.png" target="_blank" rel="noopener">
          <img loading="lazy" src="${dir}/${m.file}.png" alt="${esc(m.page)}">
        </a>
        <figcaption>
          <span class="name">${esc(m.file)}.png</span>
          <span class="page">${esc(m.page)}</span>
          <span class="meta"><span class="role">${esc(m.role)}</span>${esc(m.shows)}</span>
          ${m.issues ? `<span class="warn">${esc(m.issues)}</span>` : ''}
        </figcaption>
      </figure>`).join('')
  return `
  <section id="${dir}">
    <h2>${esc(title)} <span class="sub">${esc(sub)} · ${items.length} images</span></h2>
    <div class="grid ${dir === 'mobile' ? 'grid-narrow' : ''}">${cards}
    </div>
  </section>`
}

const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SiddhaMind AI — screens</title>
<style>
  /* Self-contained on purpose: this file has to render with no network. The
     palette mirrors the app's own dark tokens so the gallery does not fight
     the screenshots it is framing. */
  :root{
    --bg:#0B1512; --s1:#111F1A; --line:rgba(237,230,211,.10);
    --line2:rgba(237,230,211,.18); --tx:#EDE6D3; --mu:#A9B3A6;
    --gold:#E0A43B; --amb:#E8B04B;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--tx);
       font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;}
  header{padding:40px clamp(16px,4vw,56px) 24px;border-bottom:1px solid var(--line);}
  h1{font-size:clamp(28px,4vw,40px);font-weight:400;margin:0 0 8px;letter-spacing:-.02em}
  header p{color:var(--mu);margin:0;max-width:70ch}
  nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px}
  nav a{color:var(--gold);text-decoration:none;border:1px solid var(--line2);
        border-radius:999px;padding:7px 15px;font-size:14px}
  nav a:hover{border-color:var(--gold)}
  section{padding:40px clamp(16px,4vw,56px)}
  h2{font-size:23px;font-weight:400;margin:0 0 22px;border-bottom:1px solid var(--line);
     padding-bottom:12px}
  .sub{color:var(--mu);font-size:14px;margin-left:10px}
  .grid{display:grid;gap:26px;
        grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr))}
  .grid-narrow{grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))}
  .card{margin:0;background:var(--s1);border:1px solid var(--line);border-radius:12px;
        overflow:hidden;display:flex;flex-direction:column}
  .card img{width:100%;display:block;background:#000;
            max-height:460px;object-fit:cover;object-position:top}
  .card a{display:block;line-height:0}
  figcaption{padding:14px 16px 16px;display:flex;flex-direction:column;gap:4px}
  .name{font-family:var(--mono);font-size:11.5px;color:var(--gold)}
  .page{font-size:15px;font-weight:600}
  .meta{font-size:13px;color:var(--mu)}
  .role{display:inline-block;font-family:var(--mono);font-size:10.5px;
        border:1px solid var(--line2);border-radius:5px;padding:1px 6px;margin-right:8px;
        color:var(--tx)}
  .warn{font-size:12px;color:var(--amb)}
  footer{padding:28px clamp(16px,4vw,56px) 56px;color:var(--mu);font-size:13px;
         border-top:1px solid var(--line)}
</style>
</head>
<body>
<header>
  <h1>SiddhaMind AI — screens</h1>
  <p>Full-page captures from the running stack, headless Chrome. Every page waited
     for network idle plus 1.5s so entrance animations and the dosha ring sweep had
     settled. Click any image for the full-resolution file.</p>
  <nav>${PASSES.filter(([d]) => manifest.some((m) => m.pass === d))
    .map(([d, t]) => `<a href="#${d}">${esc(t)}</a>`).join('')}</nav>
</header>
${PASSES.map(section).join('')}
<footer>${manifest.length} images · generated by <code>e2e/build-gallery.mjs</code> · no network required</footer>
</body>
</html>
`
fs.writeFileSync(path.join(ROOT, 'index.html'), html)
console.log(`README.md and index.html written for ${manifest.length} images`)
