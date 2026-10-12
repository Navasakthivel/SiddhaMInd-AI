import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle, SignOut } from '@phosphor-icons/react'
import { activate, setNewPassword, signOut } from '../api/client'
import { useAuth } from '../auth'
import { routeForRole } from './Landing'
import PasswordField from '../components/PasswordField'
import AuthLayout, { Notice } from '../components/AuthLayout'

/**
 * First sign-in for doctors and students.
 *
 * Step 1 - login ID + the six-digit code the administrator handed over. The
 *          server opens a session flagged mustSetPassword.
 * Step 2 - create a password. Shown whenever /api/auth/me says
 *          mustSetPassword, which App enforces by routing every other path here.
 *          Setting the password is what spends the code; until then the same
 *          code can be used again (lost tab, reload) until it expires.
 *
 * The step is derived from the auth context, not local state, so a reload in
 * the middle lands on the right step and cannot skip it.
 */
const MIN = 8
const ID_SHAPE = /^(DOC|STU)-\d{4,}$/

export default function Activate() {
  const { user, loading, mustSetPassword } = useAuth()

  if (loading) return <AuthLayout label="Activate account"><div style={{ minHeight: 320 }} /></AuthLayout>
  // Already signed in with a password: nothing to activate.
  if (user && !mustSetPassword) return <Navigate to={routeForRole(user.role)} replace />
  return mustSetPassword ? <CreatePassword /> : <EnterCode />
}

function StepHeader({ step, title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--gold)' }}>
        Activate account &middot; step {step} of 2
      </div>
      <h1 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 36, margin: 0, letterSpacing: '-.02em' }}>
        {title}
      </h1>
      <p style={{ margin: 0, color: 'var(--mu)' }}>{children}</p>
    </div>
  )
}

function EnterCode() {
  const location = useLocation()
  const { setUser } = useAuth()
  const [loginId, setLoginId] = useState(location.state?.loginId ?? '')
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    const id = loginId.trim().toUpperCase()
    if (!ID_SHAPE.test(id)) {
      setError('Enter your Doctor ID or Student ID, for example DOC-0001 or STU-0001.')
      return
    }
    if (!/^\d{6}$/.test(code)) {
      setError('The activation code is six digits.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Flagged session: App now pins every route to this page and the
      // component re-renders on step 2.
      setUser(await activate(id, code))
    } catch (err) {
      // 401 generic message, or 429 lockout - the server's words verbatim.
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <AuthLayout onSubmit={onSubmit} label="Activate account">
      <StepHeader step={1} title="Activate your account">
        Enter the ID and six-digit activation code your administrator gave you. The code
        works once and expires seven days after it was issued.
      </StepHeader>

      <div className="field">
        <label htmlFor="ac-id">Doctor or Student ID</label>
        <input id="ac-id" className="input" autoComplete="username" autoCapitalize="characters"
               spellCheck={false} placeholder="DOC-0001" value={loginId}
               onChange={(e) => { setLoginId(e.target.value); setError(null) }}
               style={{ minHeight: 48, background: 'var(--s1)', fontFamily: 'var(--mono)', letterSpacing: '.04em' }} />
      </div>

      <div className="field">
        <label htmlFor="ac-code">Activation code</label>
        <input id="ac-code" className="input" inputMode="numeric" autoComplete="one-time-code"
               maxLength={6} placeholder="••••••" value={code}
               onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null) }}
               style={{
                 minHeight: 56, background: 'var(--s1)', fontFamily: 'var(--mono)',
                 fontSize: 24, letterSpacing: '.5em', textAlign: 'center',
               }} />
      </div>

      {error && <Notice testId="activate-error">{error}</Notice>}

      <button type="submit" className="btn btn-primary" disabled={busy}
              style={{ minHeight: 48, fontSize: 15 }}>
        {busy ? 'Checking…' : 'Continue'}
      </button>

      <p style={{ margin: 0, color: 'var(--mu)', fontSize: 14 }}>
        Already set a password? <Link to="/login" state={{ role: loginId.toUpperCase().startsWith('STU') ? 'STUDENT' : 'PRACTITIONER' }}>Sign in</Link>
        <br />
        Code lost or expired? Ask your administrator to reset your password &mdash; you
        will get a new code.
      </p>
    </AuthLayout>
  )
}

/** A rough guide, not a rule: only the eight-character minimum is enforced. */
export function passwordStrength(pw) {
  if (!pw) return null
  if (pw.length < MIN) return { label: `Too short — at least ${MIN} characters`, level: 0, color: 'var(--red)' }
  let score = 0
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 1) return { label: 'Weak — add length, digits or symbols', level: 1, color: 'var(--amb)' }
  if (score === 2) return { label: 'Fair', level: 2, color: 'var(--amb)' }
  if (score === 3) return { label: 'Good', level: 3, color: 'var(--jade)' }
  return { label: 'Strong', level: 4, color: 'var(--jade)' }
}

export function StrengthHint({ password }) {
  const s = passwordStrength(password)
  return (
    <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: -12 }}>
      <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} style={{
            height: 4, borderRadius: 2,
            background: s && s.level >= i ? s.color : 'var(--line)',
            transition: 'background .25s',
          }} />
        ))}
      </div>
      <span data-testid="strength" style={{ fontSize: 12, color: s ? s.color : 'var(--mu)' }}>
        {s ? s.label : `At least ${MIN} characters. Longer is stronger.`}
      </span>
    </div>
  )
}

function CreatePassword() {
  const navigate = useNavigate()
  const { user, setUser, refresh } = useAuth()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    if (pw.length < MIN) { setError(`Your password must be at least ${MIN} characters.`); return }
    if (pw !== confirm) { setError('The two passwords do not match.'); return }
    setBusy(true)
    setError(null)
    try {
      const updated = await setNewPassword(pw)
      setUser(updated)
      await refresh()
      navigate(routeForRole(updated.role), { replace: true })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  async function onSignOut() {
    try { await signOut() } catch { /* the session is the server's to clear */ }
    setUser(null)
  }

  const idLabel = user?.role === 'STUDENT' ? 'Student ID' : 'Doctor ID'

  return (
    <AuthLayout onSubmit={onSubmit} label="Create your password">
      <StepHeader step={2} title="Create your password">
        You will sign in with your {idLabel} and this password from now on.
      </StepHeader>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 12,
      }}>
        <CheckCircle size={22} style={{ color: 'var(--jade)', flex: 'none' }} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontWeight: 600 }}>{user?.name}</span>
          <span style={{ fontSize: 13, color: 'var(--mu)' }}>
            {idLabel} <b data-testid="activated-id" style={{ fontFamily: 'var(--mono)', color: 'var(--tx)' }}>{user?.loginId}</b>
          </span>
        </div>
      </div>

      <PasswordField id="ac-pw" label="New password" value={pw} autoComplete="new-password"
                     onChange={(e) => { setPw(e.target.value); setError(null) }} required />
      <StrengthHint password={pw} />
      <PasswordField id="ac-pw2" label="Confirm new password" value={confirm} autoComplete="new-password"
                     onChange={(e) => { setConfirm(e.target.value); setError(null) }} required />

      {error && <Notice testId="setpw-error">{error}</Notice>}

      <button type="submit" className="btn btn-primary" disabled={busy}
              style={{ minHeight: 48, fontSize: 15 }}>
        {busy ? 'Saving…' : 'Set password and continue'}
      </button>

      <button type="button" onClick={onSignOut} style={{
        display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 0,
        color: 'var(--mu)', cursor: 'pointer', padding: 0, minHeight: 44, font: 'inherit',
        alignSelf: 'flex-start',
      }}>
        <SignOut size={16} /> Sign out and finish later
      </button>
    </AuthLayout>
  )
}
