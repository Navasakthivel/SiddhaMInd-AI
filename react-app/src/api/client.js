/**
 * The backend integration surface. This file is the full list of hooks - every
 * call the client makes to siddhamind-core goes through one of the functions
 * below.
 *
 * The `SiddhaMind.*` names come from the original static design delivery,
 * which specified them as the points a backend developer would implement.
 * That design is no longer in the repo; it is archived as
 * SiddhaMind_AI_Frontend_Export.zip alongside the project folder. Its proposed
 * paths (`/api/safety-check`, `/api/assistant/ask`, ...) were explicitly
 * stand-ins, so the real siddhamind-core routes are used instead and every
 * difference is documented at the call site rather than papered over.
 *
 * Auth is the existing server session. Every request sends
 * `credentials: 'include'` so the browser carries JSESSIONID; there is no
 * token in localStorage to steal. In development Vite proxies /api to Java so
 * the cookie is first-party.
 */

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

/** Thrown for any non-2xx, carrying the server's message where it sent one. */
export class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function request(path, { method = 'GET', body, isForm = false } = {}) {
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'include',
      headers: isForm ? undefined : { 'Content-Type': 'application/json' },
      body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (cause) {
    // A network-level failure is not the same as a rejection from the server,
    // and the assistant screen in particular renders them differently.
    throw new ApiError('Could not reach the server.', 0, { cause: String(cause) })
  }

  if (res.status === 204) return null

  const text = await res.text()
  let parsed = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      // The interceptor answers /api/** with JSON, so HTML here means a
      // misconfigured proxy rather than an auth redirect. Say so plainly
      // instead of surfacing "Unexpected token <".
      throw new ApiError(
        'The server returned a page where JSON was expected - check the API base URL.',
        res.status, { raw: text.slice(0, 200) })
    }
  }

  if (!res.ok) {
    if (res.status === 401 && isSessionEnded(parsed)) {
      // The server revoked this session (suspended, reset, or signed in
      // elsewhere and changed password). Announced globally rather than left
      // to each screen: AuthProvider listens, drops the user and sends them to
      // /login with an explanation, whichever screen made the call.
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT))
    }
    throw new ApiError(parsed?.error ?? `Request failed (${res.status}).`, res.status, parsed)
  }
  return parsed
}

/** Fired on window when any call is refused because the session was revoked. */
export const SESSION_ENDED_EVENT = 'siddhamind:session-ended'

/**
 * AuthInterceptor's revocation answer, as distinct from the plain "Not signed
 * in." 401 a visitor without a session gets. Only the former means "you were
 * signed in a moment ago and no longer are", which is worth telling the user.
 */
function isSessionEnded(body) {
  return typeof body?.error === 'string' && body.error.startsWith('Your session has ended')
}

/* ------------------------------------------------------------------ auth */

/**
 * Design-spec hook: `SiddhaMind.signIn(id, passphrase, role)`.
 *
 * `identifier` is an email (admin, patient) or a login ID such as DOC-0001
 * (doctor, student); the server tells them apart. `role` is accepted for
 * signature compatibility and deliberately NOT sent: the server derives the
 * role from the account, so the login tabs are a hint, not a control.
 *
 * Failures: 401 with one generic message for every cause, or 429 "Too many
 * attempts. Try again in 15 minutes." Both are shown verbatim.
 */
export function signIn(identifier, password, _role) {
  return request('/auth/login', { method: 'POST', body: { identifier, password } })
}

/**
 * First sign-in for a doctor or student: login ID + the one-time code the
 * administrator handed over. Opens a session that can do nothing but set a
 * password (the server enforces that; `mustSetPassword` in the answer says so).
 */
export function activate(loginId, activationCode) {
  return request('/auth/activate', { method: 'POST', body: { loginId, activationCode } })
}

/** Sets the password of an activated session and spends the activation code. */
export function setNewPassword(newPassword) {
  return request('/auth/set-password', { method: 'POST', body: { newPassword } })
}

/**
 * Self-service registration - patients only.
 *
 * No role is sent: the server creates PATIENT accounts and nothing else, and
 * refuses a request that asks for any other role. Doctors and students are
 * created by an administrator and receive a login ID. Registration does not
 * sign you in - the caller goes to /login next.
 */
export function register(details = {}) {
  return request('/auth/register', {
    method: 'POST',
    body: {
      fullName: details.fullName,
      email: details.email,
      password: details.password,
      phone: details.phone || null,
    },
  })
}

export function signOut() {
  return request('/auth/logout', { method: 'POST' })
}

export function currentUser() {
  return request('/auth/me')
}

/* ---------------------------------------------------------------- safety */

export function safetyOptions() {
  return request('/safety/options')
}

/**
 * Design-spec hook: `SiddhaMind.runSafetyCheck(payload)`.
 *
 * The design's payload and the rule engine's inputs are not the same shape:
 *
 *   preparation          -> formId          (the engine keys on the record)
 *   concurrentMedication -> drugs           (comma-separated, matched by name)
 *   pregnancy            -> conditions      (folded in as "Pregnancy")
 *   renalFunction        -> conditions      (folded in as a condition string)
 *
 * The design's patientAge, patientWeightKg and dosePerDay are not in this list
 * and are no longer collected by the form. No rule consumes them: the engine
 * screens the preparation against recorded interactions, contraindications and
 * heavy-metal ceilings, and computes nothing from a patient's age or weight.
 * Adding a dosing rule later means adding the fields back alongside it.
 */
export function runSafetyCheck(payload = {}) {
  const conditions = []
  if (payload.pregnancy === true || payload.pregnancy === 'yes') conditions.push('Pregnancy')
  if (payload.renalFunction && payload.renalFunction !== 'normal') {
    conditions.push(payload.renalFunction)
  }
  if (Array.isArray(payload.conditions)) conditions.push(...payload.conditions)

  return request('/safety/check', {
    method: 'POST',
    body: {
      formId: payload.formId ?? payload.preparation,
      drugs: payload.concurrentMedication ?? payload.drugs ?? '',
      conditions: conditions.join(', '),
    },
  })
}

/**
 * Adapts a SafetyReport to the `renderVerdict` shape the design describes.
 *
 * Two honest gaps, both left visible rather than filled in:
 *
 * 1. `measure.value` and `measure.percent` are null. The engine reports a
 *    CEILING - the summed maximum permitted daily dose of each heavy-metal
 *    ingredient - and no measured content, because elemental yield after
 *    sutthi and pudam is not derivable from free-text formulary quantities.
 *    The static design's meter fills to a percentage; filling it here would
 *    mean inventing the numerator of a dose comparison. The bar renders
 *    unfilled and labels the ceiling.
 * 2. Rules are only ever `failed`. The engine returns findings, and a finding
 *    is by definition something that fired; it does not enumerate the rules
 *    that passed. TODO(backend): to show passed rules the engine would need to
 *    report its full evaluated set, not just the matches.
 */
export function toVerdict(report) {
  if (!report) return null
  const risk = { HIGH: 'high', MODERATE: 'elevated', LOW: 'normal' }[report.riskLevel] ?? 'normal'
  const failed = report.majorCount + report.moderateCount + report.minorCount
  return {
    preparation: report.formulationName,
    risk,
    dispenseNote: risk === 'high'
      ? `Do not dispense · ${failed} finding${failed === 1 ? '' : 's'}`
      : `${failed} finding${failed === 1 ? '' : 's'}`,
    headline: report.findings?.[0]?.detail ?? 'No rule matched the information supplied.',
    measure: report.heavyMetalDailyLimitMg > 0
      ? {
          label: 'Heavy-metal daily ceiling',
          value: null,
          ceiling: report.heavyMetalDailyLimitMg,
          percent: null,
        }
      : null,
    rules: (report.findings ?? []).map((f, i) => ({
      id: `${f.type}-${i + 1}`,
      name: f.subject,
      outcome: 'failed',
      note: f.detail,
      advice: f.advice,
      severity: f.severity,
    })),
    unmatchedDrugs: report.unmatchedDrugs ?? [],
    explanation: report.aiExplanation
      ? { status: 'cited', body: report.aiExplanation }
      : { status: 'notfound', body: null },
  }
}

/* ------------------------------------------------------------- assistant */

export function assistantStatus() {
  return request('/assistant/status')
}

/**
 * Design-spec hook: `SiddhaMind.askAssistant(question)`.
 *
 * Resolves for both `cited` and `notfound` - "the corpus does not cover this"
 * is a correct, final answer and not an error - and rejects only when the
 * explainer itself could not be reached. The rule engine is never gated on
 * this call.
 */
export function askAssistant(question, chatId) {
  return request('/assistant/ask', { method: 'POST', body: { question, chatId } })
}

/* ------------------------------------------------------------- formulary */

export function searchFormulary(q) {
  return request('/formulary' + (q ? `?q=${encodeURIComponent(q)}` : ''))
}

export function formularyDetail(id) {
  return request(`/formulary/${id}`)
}

/* ------------------------------------------------------------- diagnosis */

export function diagnosisOptions() {
  return request('/diagnosis/options')
}

/**
 * Design-spec hook: `SiddhaMind.computeDoshaReading(record)`.
 *
 * The eight examination fields map straight through, alongside the patient
 * details the engine records against the session.
 *
 * The static design also collects `season` (paruvakaalam) and a `patientId`.
 * Neither is collected here. `season` is the more important omission: Siddha
 * does weight kaalam, so a season field beside an examination implies the
 * reading accounts for it - and DiagnosisService.score has no season term and
 * diagnosis_sessions has no column for one. Showing the field would have been
 * a claim about the computation. `patientId` had no store either, and
 * patientName already identifies the session.
 */
export function computeDoshaReading(record = {}) {
  const e = record.examination ?? record
  return request('/diagnosis/compute', {
    method: 'POST',
    body: {
      patientName: record.patientName ?? '',
      age: record.age ?? null,
      gender: record.gender ?? null,
      complaint: record.complaint ?? null,
      naadi: e.naadi, naa: e.naa, niram: e.niram, mozhi: e.mozhi,
      vizhi: e.vizhi, sparisam: e.sparisam, malam: e.malam, moothiram: e.moothiram,
    },
  })
}

/* ----------------------------------------------------------------- admin */

export function adminStats() {
  return request('/admin/stats')
}

export function adminUsers() {
  return request('/admin/users')
}

/**
 * Creates a doctor (PRACTITIONER) or student. No password: the server issues
 * `{ loginId, activationCode, activationExpiresAt }`, and this response is the
 * only time the plaintext code exists anywhere - only its hash is stored.
 */
export function createUser({ fullName, email, phone, institution, regNumber, role }) {
  return request('/admin/users', {
    method: 'POST',
    body: {
      fullName, email, role,
      phone: phone || null, institution: institution || null, regNumber: regNumber || null,
    },
  })
}

export function setUserStatus(userId, status) {
  return request(`/admin/users/${userId}/status`, { method: 'POST', body: { status } })
}

export function corpusDocuments() {
  return request('/admin/corpus')
}

/**
 * Design-spec hook: `SiddhaMind.uploadCorpusSource(file)`.
 *
 * The design expects `{ id, name, state, percent, meta, stage }` back from the
 * upload itself. The real endpoint stores the file and answers `{ ok: true }`;
 * ingestion is a separate, explicitly triggered job, and its live state comes
 * from `ingestStatus()` below - now proxied through Java from the AI service.
 *
 * `stage` is real. `percent` still is not, and cannot be until the pipeline
 * reports progress as it runs; see the note on ingestStatus.
 */
export function uploadCorpusSource(file, title) {
  const body = new FormData()
  body.append('source', file)
  if (title) body.append('title', title)
  return request('/admin/corpus/upload', { method: 'POST', body, isForm: true })
}

export function triggerIngest(docId) {
  return request(`/admin/corpus/${docId}/ingest`, { method: 'POST' })
}

/**
 * Live ingestion state for one document, proxied through Java.
 *
 * Returns `{ reachable, status, running, stalled, chunkCount, totalPages,
 * skippedPages, error, message }`.
 *
 * NO `percent`. The pipeline writes its row twice - RUNNING at the start, the
 * final status at the end - and `indexed` is a boolean rather than a page
 * counter, so nothing moves while a run is in flight. The screen shows which
 * stage a document is at and an indeterminate bar while it works, because the
 * alternative is a number that looks measured and is not.
 *
 * `stalled` is the useful signal a raw row cannot give: RUNNING with no
 * process behind it, which is what a service restart mid-ingest leaves behind.
 */
export function ingestStatus(docId) {
  return request(`/admin/corpus/${docId}/status`)
}

/**
 * Exposed on window under the name the static pages use, so the design's own
 * documented integration surface still resolves if anything reaches for it.
 */
/* --------------------------------------------------------------- profile */

/** The signed-in user plus their notifications. */
export function profile() {
  return request('/profile')
}

/* ------------------------------------------------------------ dashboards */

/** PRACTITIONER/ADMIN: my diagnosis sessions and my safety checks. */
export function practitionerDashboard() {
  return request('/practitioner/dashboard')
}

/** STUDENT/ADMIN: corpus counts and my chats. */
export function studentDashboard() {
  return request('/student/dashboard')
}

/**
 * PATIENT/ADMIN: heavy-metal ingredients and their ceilings.
 *
 * `maxDailyMg` is the maximum permitted daily dose of that ingredient, not an
 * amount anyone is taking. Rendering it as a dose-against-limit meter invents
 * the numerator.
 */
export function patientDashboard() {
  return request('/patient/dashboard')
}

/* ------------------------------------------------------------- diagnosis */

/**
 * Past examinations. The server scopes this to the caller; an ADMIN gets every
 * session and the response says which via `scope`. There is deliberately no
 * practitionerId parameter - one would let any practitioner read another's
 * patient names.
 */
export function diagnosisHistory() {
  return request('/diagnosis/history')
}

/* ------------------------------------------------------------- assistant */

/** The caller's own conversations. Never anyone else's. */
export function assistantChats() {
  return request('/assistant/chats')
}

/**
 * One conversation with its messages and citations.
 *
 * Answers 404 both when the chat does not exist and when it belongs to someone
 * else, so a caller cannot use this to discover that another user's chat exists.
 */
export function assistantChat(chatId) {
  return request(`/assistant/chats/${chatId}`)
}

/* ----------------------------------------------------------------- admin */

/**
 * Reset another account's credential.
 *
 * Doctor/student: `newPassword` is omitted; the answer carries a fresh
 * `{ loginId, activationCode, activationExpiresAt }`, shown once. Their old
 * password and any open sessions stop working immediately.
 * Admin/patient: sets `newPassword` (min 8). It is never echoed back.
 */
export function resetUserPassword(userId, newPassword) {
  return request(`/admin/users/${userId}/reset`, {
    method: 'POST', body: newPassword ? { newPassword } : {},
  })
}

/** Platform figures plus the recent activity feed. */
export function adminReports() {
  return request('/admin/reports')
}

/* ------------------------------------------------------------- formulary */

/** Every ingredient in the formulary. */
export function ingredients() {
  return request('/formulary/ingredients')
}

/** Every disease (noi). */
export function diseases() {
  return request('/formulary/diseases')
}

/** One disease and the preparations indicated for it. */
export function diseaseDetail(id) {
  return request(`/formulary/diseases/${id}`)
}

const SiddhaMind = {
  signIn, signOut, currentUser, activate, setNewPassword,
  safetyOptions, runSafetyCheck, toVerdict,
  assistantStatus, askAssistant,
  searchFormulary, formularyDetail,
  diagnosisOptions, computeDoshaReading,
  adminStats, adminUsers, createUser, setUserStatus,
  corpusDocuments, uploadCorpusSource, triggerIngest,
  // added for the React client's own screens
  register, profile,
  practitionerDashboard, studentDashboard, patientDashboard,
  diagnosisHistory,
  assistantChats, assistantChat,
  resetUserPassword, adminReports,
  ingredients, diseases, diseaseDetail,
}
if (typeof window !== 'undefined') window.SiddhaMind = SiddhaMind
export default SiddhaMind
