/**
 * Turns results-roundC.json into the pass/fail matrix that goes into REPORT.md.
 *
 *   node e2e/summarise.mjs           # prints markdown to stdout
 */
import fs from 'node:fs'
import { SCREENS, AUTHED, ROLES, allowedFor } from './lib.mjs'

const r = JSON.parse(fs.readFileSync('e2e/results-roundC.json', 'utf8'))
const rows = r.results

const out = []
const P = (s) => out.push(s)

// ---- per screen x role -----------------------------------------------------
// A cell passes when every check recorded for that screen and role passed, at
// both viewports. Cells are marked by what was actually asserted, so a role
// that may not open a screen shows the denial result rather than a blank.
P('| # | Screen | Path | ADMIN | PRACTITIONER | STUDENT | PATIENT |')
P('|---|--------|------|:-----:|:------------:|:-------:|:-------:|')

for (const s of SCREENS) {
  const cells = ROLES.map((role) => {
    if (s.auth === false) return 'n/a'
    const allowed = s.roles.includes(role)
    const mine = rows.filter((x) =>
      x.subject === `${s.id} ${s.name}` && x.name.startsWith(`${role}:`))
    if (mine.length === 0) return '—'
    const ok = mine.every((x) => x.pass)
    const n = mine.length
    return `${ok ? 'PASS' : 'FAIL'} ${allowed ? '' : '(denied)'} ${ok ? '' : `(${mine.filter((x) => !x.pass).length}/${n})`}`.trim()
  })
  P(`| ${s.id} | ${s.name} | \`${s.path}\` | ${cells.join(' | ')} |`)
}

// pre-auth screens are covered by their own checks, not the role sweep
P('')
P('Screens 01–04 are pre-auth and have no role dimension; they are exercised by')
P('the sign-in, registration, denial and sign-out suites below.')

// ---- per area --------------------------------------------------------------
const by = {}
for (const x of rows) {
  by[x.area] = by[x.area] ?? { pass: 0, fail: 0, fails: [] }
  if (x.pass) by[x.area].pass += 1
  else { by[x.area].fail += 1; by[x.area].fails.push(x) }
}
P('')
P('| Suite | Checks | Passed | Failed |')
P('|---|---:|---:|---:|')
for (const [k, v] of Object.entries(by)) {
  P(`| ${k} | ${v.pass + v.fail} | ${v.pass} | ${v.fail} |`)
}
P(`| **total** | **${rows.length}** | **${rows.filter((x) => x.pass).length}** | **${rows.filter((x) => !x.pass).length}** |`)

if (rows.some((x) => !x.pass)) {
  P('')
  P('### Failures')
  for (const x of rows.filter((y) => !y.pass)) {
    P(`- \`${x.area}\` **${x.subject}** @${x.vp} — ${x.name}${x.detail ? ` — ${x.detail}` : ''}`)
  }
}

// ---- console / network -----------------------------------------------------
const group = (arr, key) => {
  const m = new Map()
  for (const x of arr) m.set(key(x), (m.get(key(x)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
P('')
P('### Console and network, whole run')
P('')
P('| Count | Entry |')
P('|---:|---|')
for (const [k, n] of group(r.console, (c) => `${c.type}: ${c.text.slice(0, 110)}`)) P(`| ${n} | ${k} |`)
for (const [k, n] of group(r.network, (x) => `${x.failure} ${x.method} ${new URL(x.url).pathname}`)) P(`| ${n} | ${k} |`)

console.log(out.join('\n'))
