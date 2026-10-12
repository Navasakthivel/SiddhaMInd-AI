import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Info, Key } from '@phosphor-icons/react'
import { signIn } from '../api/client'
import { routeForRole } from './Landing'
import { useAuth } from '../auth'
import PasswordField from '../components/PasswordField'
import AuthLayout, { Notice } from '../components/AuthLayout'

/**
 * 02 Login.
 *
 * Two ways in, by role:
 *   Admin, Patient   - email + password
 *   Doctor, Student  - the login ID the administrator issued (DOC-0001,
 *                      STU-0001) + password. First time, they activate with a
 *                      one-time code instead - see Activate.jsx.
 *
 * The tab decides which identifier the form asks for; it is still not an
 * authorisation control. Only `{identifier, password}` is sent and the server
 * derives the role from the account.
 *
 * Seeds the auth context from the sign-in response (so the destination mounts
 * with a role and Shell does not bounce it back here), then awaits refresh()
 * for the fields only /api/auth/me carries (BUG-03).
 */
export const LOGIN_TABS = [
  { key: 'ADMIN', label: 'Admin', field: 'Email', kind: 'email', placeholder: 'admin@siddhamind.in' },
  { key: 'PATIENT', label: 'Patient', field: 'Email', kind: 'email', placeholder: 'you@example.com' },
  { key: 'PRACTITIONER', label: 'Doctor', field: 'Doctor ID', kind: 'id', prefix: 'DOC', placeholder: 'DOC-0001' },
  { key: 'STUDENT', label: 'Student', field: 'Student ID', kind: 'id', prefix: 'STU', placeholder: 'STU-0001' },
]

/**
 * Catches a mistyped identifier before it costs one of the five attempts the
 * server allows. Says nothing about whether an account exists - it only
 * checks the shape of what was typed against the selected tab.
 */
function shapeError(tab, value) {
  const v = value.trim()
  if (!v) return `Enter your ${tab.field.toLowerCase().replace('id', 'ID')}.`
  if (tab.kind === 'email' && !v.includes('@')) {
    return 'Enter your email address.'
  }
  if (tab.kind === 'id' && !new RegExp(`^${tab.prefix}-\\d{4,}$`, 'i').test(v)) {
    return `Enter your ${tab.field}, for example ${tab.placeholder}. ${tab.label}s sign in with the ID from the administrator, not an email.`
  }
  return null
}

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setUser, refresh, sessionEnded } = useAuth()

  const initial = LOGIN_TABS.some((t) => t.key === location.state?.role) ? location.state.role : 'ADMIN'
  const [role, setRole] = useState(initial)
  // One value per tab, so switching tabs never carries an email into the
  // Doctor ID box or the other way round.
  const [ids, setIds] = useState({})
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('idle')

  const tab = LOGIN_TABS.find((t) => t.key === role)
  const pillIndex = LOGIN_TABS.findIndex((t) => t.key === role)
  const identifier = ids[role] ?? ''
  const ended = sessionEnded || location.state?.sessionEnded
  const justRegistered = location.state?.justRegistered
  const justActivated = location.state?.justActivated

  function pickTab(key) {
    setRole(key)
    setError(null)
  }

  async function onSubmit(e) {
    e.preventDefault()
    const shape = shapeError(tab, identifier)
    if (shape) { setError(shape); return }
    if (!password) { setError('Enter your password.'); return }

    setStatus('pending')
    setError(null)
    try {
      const value = tab.kind === 'id' ? identifier.trim().toUpperCase() : identifier.trim()
      const user = await signIn(value, password, role)
      setStatus('success')
      setUser(user)
      await refresh()
      navigate(routeForRole(user.role))
    } catch (err) {
      // 401: one generic message for every cause. 429: the lockout message.
      // Both are the server's words, shown verbatim.
      setError(err.message)
      setStatus('idle')
    }
  }

  return (
    <AuthLayout onSubmit={onSubmit} label="Sign in">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 36, margin: 0, letterSpacing: '-.02em' }}>
          Welcome back
        </h1>
        <p style={{ margin: 0, color: 'var(--mu)' }}>
          Admins and patients sign in with their email. Doctors and students use the ID
          their administrator gave them.
        </p>
      </div>

      {ended && (
        <Notice tone="warn" testId="session-ended">Your session has ended, please sign in again.</Notice>
      )}
      {justRegistered && !ended && (
        <Notice tone="ok">Account created. Sign in with your email and password.</Notice>
      )}
      {justActivated && !ended && (
        <Notice tone="ok">Password set. Sign in with your ID and new password.</Notice>
      )}

      <div role="tablist" aria-label="Account type" style={{
        position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
        background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 12, padding: 4,
      }}>
        <span aria-hidden="true" style={{
          position: 'absolute', top: 4, bottom: 4, left: 4, width: 'calc((100% - 8px) / 4)',
          borderRadius: 9, background: 'var(--goldT)', border: '1px solid var(--goldT2)',
          transform: `translateX(${pillIndex * 100}%)`,
          transition: 'transform .35s cubic-bezier(.3,.7,.2,1)',
        }} />
        {LOGIN_TABS.map((t) => (
          <button
            key={t.key} type="button" role="tab" aria-selected={role === t.key}
            onClick={() => pickTab(t.key)}
            style={{
              position: 'relative', zIndex: 1, minHeight: 44, background: 'none', border: 0,
              font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              color: role === t.key ? 'var(--gold)' : 'var(--mu)', transition: 'color .3s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="lg-id">{tab.field}</label>
        <input
          id="lg-id" key={role} className="input"
          type={tab.kind === 'email' ? 'email' : 'text'}
          inputMode={tab.kind === 'email' ? 'email' : 'text'}
          autoComplete="username"
          autoCapitalize={tab.kind === 'id' ? 'characters' : 'none'}
          spellCheck={false}
          placeholder={tab.placeholder}
          value={identifier}
          onChange={(e) => { setIds((m) => ({ ...m, [role]: e.target.value })); setError(null) }}
          style={{
            minHeight: 48, background: 'var(--s1)',
            fontFamily: tab.kind === 'id' ? 'var(--mono)' : undefined,
            letterSpacing: tab.kind === 'id' ? '.04em' : undefined,
          }}
        />
      </div>

      <PasswordField id="lg-pw" value={password} autoComplete="current-password"
                     onChange={(e) => setPassword(e.target.value)} />

      {error && <Notice testId="login-error">{error}</Notice>}

      <button type="submit" className="btn btn-primary sm-btn-status"
              data-status={status} disabled={status !== 'idle'}
              style={{ minHeight: 48, fontSize: 15 }}>
        {status === 'pending' ? 'Signing in…' : status === 'success' ? 'Signed in' : `Sign in as ${tab.label}`}
      </button>

      {tab.kind === 'id' ? (
        <p style={{ margin: 0, color: 'var(--mu)', fontSize: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Key size={16} style={{ color: 'var(--gold)' }} />
          <span>
            First time?{' '}
            <Link to="/activate" state={{ loginId: identifier.trim().toUpperCase() || undefined }}>
              Activate your account
            </Link>
          </span>
        </p>
      ) : role === 'PATIENT' ? (
        <p style={{ margin: 0, color: 'var(--mu)', fontSize: 14 }}>
          New to SiddhaMind? <Link to="/register">Create a patient account</Link>
        </p>
      ) : null}

      <p style={{ margin: 0, color: 'var(--mu)', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Info size={14} /> Education and decision support &mdash; not a prescription.
      </p>
    </AuthLayout>
  )
}
