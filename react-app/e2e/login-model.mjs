/**
 * The login model, end to end, through the real UI against the live backend.
 *
 *   node e2e/login-model.mjs          # headless (default)
 *   HEADED=1 node e2e/login-model.mjs
 *
 * Needs the Vite dev server on :5173 (proxying /api to siddhamind-core :8080).
 *
 * Per viewport (desktop 1440, mobile 390):
 *   1. admin creates a test doctor and a test student; the one-time ID + code
 *      panel is read off the screen
 *   2. each activates with ID + code, is pinned to the create-password step,
 *      sets a password, lands on their dashboard, signs out, signs back in
 *      with ID + password; the spent code no longer activates
 *   3. admin suspends the test doctor while the doctor is signed in; the
 *      doctor's next action lands on /login with "Your session has ended"
 *   4. a lockout shows the 429 message on the login and activate pages
 *   5. a patient registers (short password refused first) and signs in;
 *      registering as a doctor is impossible in the UI and refused by the API
 * Finally every test account created here is DELETED from the database with
 * its rows (scripts/PruneUsers.java), the login-ID sequences are reset, and the
 * four demo accounts are confirmed ACTIVE - so repeated runs leave no clutter
 * and the next real doctor is still DOC-0002.
 */
import {
  BASE, launchBrowser, shot, apiPost, apiJson, writeJson, ACCOUNTS, login, deleteTestUsers,
} from './lib.mjs'

const RUN = Date.now().toString(36)
const LOCK_MSG = 'Too many attempts. Try again in 15 minutes.'
const ENDED_MSG = 'Your session has ended, please sign in again.'

const VIEWPORTS = [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
]

const results = []
const created = [] // { email, loginId? } of every account this run made
function check(vp, area, name, pass, detail = '') {
  results.push({ vp, area, name, pass: Boolean(pass), detail: String(detail ?? '') })
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${vp}] ${area} :: ${name}${detail ? `  (${detail})` : ''}`)
}

async function attempt(vp, area, name, fn) {
  try {
    await fn()
  } catch (err) {
    check(vp, area, name, false, String(err?.message ?? err).split('\n')[0])
  }
}

const path = (page) => new URL(page.url()).pathname

async function newPage(browser, vp) {
  const ctx = await browser.newContext({
    viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
    deviceScaleFactor: vp.deviceScaleFactor,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  return ctx.newPage()
}

async function signOutUi(page) {
  await page.getByRole('button', { name: 'Profile menu' }).click()
  await page.getByText('Sign out', { exact: true }).last().click()
  await page.waitForURL((u) => u.pathname === '/login', { timeout: 15000 })
}

/** Admin creates a doctor/student through the modal; returns what the panel showed. */
async function createViaUi(admin, vp, role, label, shotName) {
  const email = `e2e.${role === 'PRACTITIONER' ? 'doc' : 'stu'}.${RUN}.${vp.name}@example.invalid`
  const name = `E2E ${label} ${vp.name} ${RUN}`
  created.push({ email })
  await admin.getByRole('button', { name: 'Create user' }).click()
  const dialog = admin.getByRole('dialog', { name: 'Create user' })
  await dialog.locator('.seg-opt', { hasText: new RegExp(`^${label}$`) }).click()
  await dialog.locator('#nu-name').fill(name)
  await dialog.locator('#nu-email').fill(email)
  await dialog.locator('#nu-phone').fill('9000099999')
  await dialog.locator('#nu-inst').fill('E2E Test Institution')
  await dialog.locator('#nu-reg').fill(`E2E-${RUN}`)
  await dialog.getByRole('button', { name: `Create ${label.toLowerCase()}` }).click()

  const codeEl = admin.getByTestId('cred-code')
  await codeEl.waitFor({ timeout: 15000 })
  const loginId = (await admin.getByTestId('cred-login-id').innerText()).trim()
  const code = (await codeEl.innerText()).trim()
  const expiry = (await admin.getByTestId('cred-expiry').innerText()).trim()
  const warning = await admin.getByRole('dialog').innerText()
  created[created.length - 1].loginId = loginId

  const prefix = role === 'PRACTITIONER' ? 'DOC' : 'STU'
  check(vp.name, 'create', `${label}: panel shows a ${prefix}- login ID`, new RegExp(`^${prefix}-\\d{4,}$`).test(loginId), loginId)
  check(vp.name, 'create', `${label}: panel shows a 6-digit code`, /^\d{6}$/.test(code))
  check(vp.name, 'create', `${label}: panel shows the expiry date`, expiry && expiry !== '—', expiry)
  check(vp.name, 'create', `${label}: "shown only once" warning`, /shown only once/i.test(warning))
  if (shotName) await shot(admin, `login-model-${vp.name}`, shotName)

  await admin.getByRole('button', { name: 'Copy ID and code' }).click()
  // The copy is async: wait for whichever outcome the panel reports.
  const copiedOk = await Promise.race([
    admin.getByRole('button', { name: 'Copied' }).waitFor({ timeout: 8000 }).then(() => true),
    admin.getByText('Could not copy').waitFor({ timeout: 8000 }).then(() => false),
  ]).catch(() => false)
  let clip = ''
  if (copiedOk) clip = await admin.evaluate(() => navigator.clipboard.readText()).catch(() => '')
  check(vp.name, 'create', `${label}: Copy puts ID and code on the clipboard`,
    copiedOk && clip.includes(loginId) && clip.includes(code), copiedOk ? 'copied' : 'copy failed')

  await admin.getByRole('button', { name: 'Done' }).click()
  const row = admin.locator(`tr[data-login-id="${loginId}"]`)
  await row.waitFor({ timeout: 15000 })
  check(vp.name, 'create', `${label}: table row shows "Activation pending"`,
    await row.getByTestId('badge-pending').isVisible())
  return { loginId, code, email, name }
}

/** Login -> "Activate your account" -> ID + code -> create password -> dashboard. */
async function activateViaUi(page, vp, acct, tabLabel, dashboard, shots) {
  const area = `activate ${tabLabel}`
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: tabLabel, exact: true }).click()
  check(vp.name, area, `${tabLabel} tab asks for "${tabLabel} ID"`,
    await page.locator('label[for="lg-id"]').innerText() === `${tabLabel} ID`)
  if (shots) await shot(page, `login-model-${vp.name}`, `01-login-${tabLabel.toLowerCase()}-tab`)

  await page.getByRole('link', { name: 'Activate your account' }).click()
  await page.waitForURL((u) => u.pathname === '/activate')
  await page.fill('#ac-id', acct.loginId)
  await page.fill('#ac-code', acct.code)
  if (shots) await shot(page, `login-model-${vp.name}`, '02-activate-step1')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('#ac-pw').waitFor({ timeout: 15000 })
  check(vp.name, area, 'ID + code opens the create-password step',
    (await page.getByTestId('activated-id').innerText()).trim() === acct.loginId)

  // Pinned: any other route bounces back here while mustSetPassword is set.
  await page.goto(`${BASE}${dashboard}`, { waitUntil: 'networkidle' })
  await page.locator('#ac-pw').waitFor({ timeout: 15000 })
  check(vp.name, area, `mustSetPassword pins ${dashboard} to /activate`, path(page) === '/activate', path(page))
  await page.goto(`${BASE}/formulary`, { waitUntil: 'networkidle' })
  await page.locator('#ac-pw').waitFor({ timeout: 15000 })
  check(vp.name, area, 'mustSetPassword pins /formulary to /activate', path(page) === '/activate', path(page))

  // Too short is refused in the form.
  await page.fill('#ac-pw', 'short1')
  await page.fill('#ac-pw2', 'short1')
  check(vp.name, area, 'strength hint flags a short password',
    /too short/i.test(await page.getByTestId('strength').innerText()))
  await page.getByRole('button', { name: 'Set password and continue' }).click()
  check(vp.name, area, 'short password refused',
    /at least 8/i.test(await page.getByTestId('setpw-error').innerText()))

  acct.password = `E2e-${RUN}-Pass!9`
  await page.fill('#ac-pw', acct.password)
  await page.fill('#ac-pw2', acct.password)
  if (shots) await shot(page, `login-model-${vp.name}`, '03-activate-create-password')
  await page.getByRole('button', { name: 'Set password and continue' }).click()
  await page.waitForURL((u) => u.pathname === dashboard, { timeout: 20000 })
  check(vp.name, area, `lands on ${dashboard}`, path(page) === dashboard, path(page))

  await signOutUi(page)
  check(vp.name, area, 'sign out returns to /login', path(page) === '/login')

  await login(page, acct.loginId, acct.password)
  check(vp.name, area, 'signs back in with ID + password', path(page) === dashboard, path(page))

  // The code was spent by set-password.
  const reuse = await apiPost(page, '/api/auth/activate', { loginId: acct.loginId, activationCode: acct.code })
  check(vp.name, area, 'spent code no longer activates', reuse.status === 401, `HTTP ${reuse.status}`)
}

async function runViewport(browser, vp) {
  const shots = true
  const admin = await newPage(browser, vp)
  const doctor = await newPage(browser, vp)
  const student = await newPage(browser, vp)
  const visitor = await newPage(browser, vp)

  let doc, stu

  await attempt(vp.name, 'create', 'admin creates doctor and student', async () => {
    await login(admin, 'admin@siddhamind.in', 'admin123', 'ADMIN')
    await admin.goto(`${BASE}/user-management`, { waitUntil: 'networkidle' })
    await admin.locator('table').waitFor({ timeout: 20000 })
    doc = await createViaUi(admin, vp, 'PRACTITIONER', 'Doctor', '04-create-user-success')
    stu = await createViaUi(admin, vp, 'STUDENT', 'Student', null)
    const header = await admin.locator('thead').innerText()
    check(vp.name, 'create', 'table has a Login ID column', /Login ID/i.test(header))
    const demoRow = await admin.locator('tr[data-login-id="DOC-0001"]').isVisible()
    check(vp.name, 'create', 'demo doctor row shows DOC-0001', demoRow)
    await admin.locator(`tr[data-login-id="${doc.loginId}"]`).scrollIntoViewIfNeeded()
    await shot(admin, `login-model-${vp.name}`, '05-user-table-pending')
  })

  if (doc) await attempt(vp.name, 'activate Doctor', 'doctor activation flow', () =>
    activateViaUi(doctor, vp, doc, 'Doctor', '/practitioner-dashboard', shots))
  if (stu) await attempt(vp.name, 'activate Student', 'student activation flow', () =>
    activateViaUi(student, vp, stu, 'Student', '/student-dashboard', false))

  // --- suspend while signed in ---
  if (doc?.password) await attempt(vp.name, 'revocation', 'suspend ends the doctor session', async () => {
    check(vp.name, 'revocation', 'doctor is signed in before suspension',
      path(doctor) === '/practitioner-dashboard', path(doctor))
    await admin.goto(`${BASE}/user-management`, { waitUntil: 'networkidle' })
    const row = admin.locator(`tr[data-login-id="${doc.loginId}"]`)
    await row.getByRole('button', { name: 'Suspend' }).click()
    await row.getByRole('button', { name: 'Reinstate' }).waitFor({ timeout: 15000 })
    check(vp.name, 'revocation', 'admin sees the doctor SUSPENDED', /SUSPENDED/.test(await row.innerText()))

    // The doctor's next action: open Formulary from the nav.
    if (vp.isMobile) await doctor.getByRole('button', { name: 'Open menu' }).click()
    await doctor.locator('a[href="/formulary"]:visible').first().click()
    await doctor.getByTestId('session-ended').waitFor({ timeout: 20000 })
    check(vp.name, 'revocation', 'doctor lands on /login', path(doctor) === '/login', path(doctor))
    check(vp.name, 'revocation', `shows "${ENDED_MSG}"`,
      (await doctor.getByTestId('session-ended').innerText()).trim() === ENDED_MSG)
    await shot(doctor, `login-model-${vp.name}`, '06-session-ended')

    const again = await apiPost(doctor, '/api/auth/login', { identifier: doc.loginId, password: doc.password })
    check(vp.name, 'revocation', 'suspended doctor cannot sign back in', again.status === 401, `HTTP ${again.status}`)
  })

  // --- 429 on login and activate ---
  await attempt(vp.name, 'lockout', 'login lockout', async () => {
    const ghost = `DOC-9${Math.floor(Math.random() * 9000 + 1000)}${vp.name.length}`
    await visitor.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await visitor.getByRole('tab', { name: 'Doctor', exact: true }).click()
    await visitor.fill('#lg-id', ghost)
    let last = ''
    for (let i = 0; i < 6; i++) {
      await visitor.fill('#lg-pw', `wrong-${i}`)
      await visitor.getByRole('button', { name: 'Sign in as Doctor' }).click()
      await visitor.getByTestId('login-error').waitFor()
      await visitor.waitForFunction(() => !document.querySelector('button[type=submit]')?.disabled)
      last = (await visitor.getByTestId('login-error').innerText()).trim()
    }
    check(vp.name, 'lockout', 'login shows the 429 message', last === LOCK_MSG, last)
    await shot(visitor, `login-model-${vp.name}`, '07-login-429')
  })
  await attempt(vp.name, 'lockout', 'activate lockout', async () => {
    const ghost = `STU-9${Math.floor(Math.random() * 9000 + 1000)}${vp.name.length}`
    await visitor.goto(`${BASE}/activate`, { waitUntil: 'networkidle' })
    await visitor.fill('#ac-id', ghost)
    let last = ''
    for (let i = 0; i < 6; i++) {
      await visitor.fill('#ac-code', String(100000 + i))
      await visitor.getByRole('button', { name: 'Continue' }).click()
      await visitor.getByTestId('activate-error').waitFor()
      await visitor.waitForFunction(() => !document.querySelector('button[type=submit]')?.disabled)
      last = (await visitor.getByTestId('activate-error').innerText()).trim()
    }
    check(vp.name, 'lockout', 'activate shows the 429 message', last === LOCK_MSG, last)
  })

  // --- tab shape check: an email on the Doctor tab never reaches the server ---
  await attempt(vp.name, 'login', 'doctor tab rejects an email', async () => {
    await visitor.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await visitor.getByRole('tab', { name: 'Doctor', exact: true }).click()
    await visitor.fill('#lg-id', 'doctor@siddhamind.in')
    await visitor.fill('#lg-pw', 'doctor123')
    let posted = false
    visitor.on('request', (r) => { if (r.url().includes('/api/auth/login')) posted = true })
    await visitor.getByRole('button', { name: 'Sign in as Doctor' }).click()
    const msg = await visitor.getByTestId('login-error').innerText()
    check(vp.name, 'login', 'email on Doctor tab explained, not sent', /DOC-0001/.test(msg) && !posted, msg)
  })

  // --- patient registration ---
  await attempt(vp.name, 'patient', 'patient registers and signs in', async () => {
    const pat = await newPage(browser, vp)
    const email = `e2e.pat.${RUN}.${vp.name}@example.invalid`
    created.push({ email })
    await pat.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
    const body = await pat.locator('form').innerText()
    check(vp.name, 'patient', 'register page has no role picker',
      await pat.locator('input[type=radio]').count() === 0 && !/Practitioner/i.test(body))
    await pat.fill('#rg-name', `E2E Patient ${vp.name} ${RUN}`)
    await pat.fill('#rg-email', email)
    await pat.fill('#rg-pw', '1234567')
    await pat.getByRole('button', { name: 'Create patient account' }).click()
    check(vp.name, 'patient', '7-character password refused',
      /at least 8/i.test(await pat.getByRole('alert').first().innerText()))
    const pw = `Patient-${RUN}-1`
    await pat.fill('#rg-pw', pw)
    await pat.getByRole('button', { name: 'Create patient account' }).click()
    await pat.waitForURL((u) => u.pathname === '/login', { timeout: 15000 })
    check(vp.name, 'patient', 'registration lands on /login with Patient tab',
      await pat.getByRole('tab', { name: 'Patient', exact: true }).getAttribute('aria-selected') === 'true')
    await pat.fill('#lg-id', email)
    await pat.fill('#lg-pw', pw)
    await pat.getByRole('button', { name: 'Sign in as Patient' }).click()
    await pat.waitForURL((u) => u.pathname === '/patient-dashboard', { timeout: 20000 })
    check(vp.name, 'patient', 'new patient signs in', path(pat) === '/patient-dashboard')
    await pat.context().close()
  })

  await attempt(vp.name, 'patient', 'register as doctor impossible', async () => {
    for (const roleName of ['PRACTITIONER', 'STUDENT', 'ADMIN']) {
      const r = await apiPost(visitor, '/api/auth/register', {
        fullName: 'Not Allowed', email: `e2e.bad.${roleName.toLowerCase()}.${RUN}@example.invalid`,
        password: 'long-enough-1', roleName,
      })
      check(vp.name, 'patient', `API refuses self-registration as ${roleName}`, r.status === 400, `HTTP ${r.status}`)
    }
  })

  // Landing copy points at the new model.
  await attempt(vp.name, 'copy', 'landing copy', async () => {
    await visitor.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const text = await visitor.locator('body').innerText()
    check(vp.name, 'copy', 'landing explains Doctor ID sign-in', /Doctor ID from your admin/.test(text))
  })

  for (const p of [admin, doctor, student, visitor]) await p.context().close()
}

async function cleanup(browser) {
  const mine = [...new Set(created.map((c) => c.email))]
  const del = deleteTestUsers(mine)
  // The tool's own log: per-table row counts, the sequences, the total.
  console.log(del.output.split('\n')
    .filter((l) => /rows deleted|^\s+\w+\s+\d+$|next ID|Deleted|ROLLED/.test(l)).join('\n'))
  check('all', 'cleanup', `the ${mine.length} test accounts were deleted`,
    del.ok && del.deleted === mine.length, `deleted ${del.deleted}`)
  check('all', 'cleanup', 'login-ID sequences reset (next DOC-0002 / STU-0002)',
    /next ID DOC-0002/.test(del.output) && /next ID STU-0002/.test(del.output))

  const page = await newPage(browser, VIEWPORTS[0])
  await login(page, 'admin@siddhamind.in', 'admin123', 'ADMIN')
  let { users } = await apiJson(page, '/api/admin/users')
  for (const u of users) {
    if (ACCOUNTS.some((a) => a.email === u.email) && u.status !== 'ACTIVE') {
      await apiPost(page, `/api/admin/users/${u.userId}/status`, { status: 'ACTIVE' })
    }
  }
  ;({ users } = await apiJson(page, '/api/admin/users'))
  const left = users.filter((u) => mine.includes(u.email))
  check('all', 'cleanup', 'no test account left in the user list', left.length === 0,
    left.map((u) => u.email).join(', '))
  const demo = ACCOUNTS.map((a) => users.find((u) => u.email === a.email))
  check('all', 'cleanup', 'the 4 demo accounts are ACTIVE',
    demo.every((u) => u?.status === 'ACTIVE'),
    demo.map((u) => `${u?.loginId ?? u?.email}=${u?.status}`).join(', '))
  // And they still sign in with the documented credentials.
  for (const a of ACCOUNTS) {
    const r = await apiPost(page, '/api/auth/login', { identifier: a.id, password: a.password })
    check('all', 'cleanup', `demo ${a.id} signs in`, r.status === 200 && r.data?.role === a.role, `HTTP ${r.status}`)
  }
  await page.context().close()
}

const browser = await launchBrowser()
try {
  for (const vp of VIEWPORTS) await runViewport(browser, vp)
} finally {
  try { await cleanup(browser) } catch (e) { check('all', 'cleanup', 'cleanup ran', false, e.message) }
  await browser.close()
}

const failed = results.filter((r) => !r.pass)
writeJson('e2e/results-login-model.json', { run: RUN, at: new Date().toISOString(), created, results })
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:')
  for (const f of failed) console.log(`  [${f.vp}] ${f.area} :: ${f.name}  ${f.detail}`)
  process.exitCode = 1
}
