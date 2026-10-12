import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Info } from '@phosphor-icons/react'
import { register } from '../api/client'
import PasswordField from '../components/PasswordField'
import { StrengthHint } from './Activate'

/**
 * 03 Register. Public route; AuthInterceptor.PUBLIC_EXACT lists it.
 *
 * Patients only. There is no role picker because there is nothing to pick:
 * the server creates PATIENT accounts from this endpoint and refuses a request
 * for any other role. Doctors and students are created by an administrator and
 * sign in with the login ID they are given; the admin account is seeded.
 *
 * Registration does not sign you in - the server returns 201 and no session, so
 * this redirects to /login with the Patient tab selected.
 */
const MIN = 8

export default function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', password: '',
  })
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('idle')

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError(null) }

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!form.fullName.trim() || !form.email.trim() || !form.password.trim()) {
      setError('Full name, email and password are required.')
      return
    }
    if (form.password.length < MIN) {
      setError(`Your password must be at least ${MIN} characters.`)
      return
    }
    setStatus('pending')
    try {
      await register(form)
      // No session is created. Send them to sign in, with the role preselected.
      navigate('/login', { state: { role: 'PATIENT', justRegistered: true } })
    } catch (err) {
      // "Email taken" and "role refused" share one message, deliberately -
      // distinguishing them would let anyone probe for registered addresses.
      // It is shown verbatim.
      setError(err.message)
      setStatus('idle')
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', justifyContent: 'center',
      padding: 'clamp(24px,5vw,72px) clamp(16px,4vw,56px)', background: 'var(--bg)',
    }}>
      <form onSubmit={onSubmit} style={{
        width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column',
        gap: 32, animation: 'smUp .6s ease both',
      }}>
        <button type="button" onClick={() => navigate('/')} style={{
          display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 0,
          color: 'var(--mu)', cursor: 'pointer', padding: 0, minHeight: 44,
          font: 'inherit', alignSelf: 'flex-start',
        }}>
          <ArrowLeft size={16} /> Back to SiddhaMind
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--gold)' }}>
            Patient account
          </div>
          <h1 style={{
            fontFamily: 'var(--serif)', fontWeight: 400,
            fontSize: 'clamp(32px,4vw,44px)', margin: 0, letterSpacing: '-.02em',
          }}>
            Join SiddhaMind
          </h1>
          <p style={{ margin: 0, color: 'var(--mu)', maxWidth: 560 }}>
            Create a patient account to read plain-language information about Siddha
            preparations. You will sign in with your email and password.
          </p>
          <p style={{
            margin: 0, color: 'var(--mu)', fontSize: 13, maxWidth: 560,
            display: 'flex', gap: 8, alignItems: 'flex-start',
          }}>
            <Info size={16} style={{ color: 'var(--gold)', flex: 'none', marginTop: 2 }} />
            <span>
              Doctors and students do not register here &mdash; your administrator creates
              your account and gives you a login ID and activation code.{' '}
              <Link to="/activate">Activate an account</Link>
            </span>
          </p>
        </div>

        <div style={{
          background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14, padding: 32,
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 24,
        }}>
          <Field id="rg-name" label="Full name" value={form.fullName} onChange={set('fullName')}
                 placeholder="Your name" required />
          <Field id="rg-email" label="Email" type="email" value={form.email} onChange={set('email')}
                 placeholder="you@example.com" autoComplete="email" required />
          <Field id="rg-phone" label="Phone" type="tel" value={form.phone} onChange={set('phone')}
                 placeholder="+91" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <PasswordField id="rg-pw" label="Password" value={form.password}
                           autoComplete="new-password" required
                           onChange={set('password')} />
            <StrengthHint password={form.password} />
          </div>
        </div>

        {error && (
          <p role="alert" style={{
            margin: 0, color: 'var(--red)', fontSize: 14,
            border: '1px solid var(--redT)', background: 'var(--redT)',
            borderRadius: 10, padding: '12px 14px',
          }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
          <button type="submit" className="btn btn-primary" disabled={status === 'pending'}
                  style={{ minHeight: 48, padding: '0 28px', fontSize: 15 }}>
            {status === 'pending' ? 'Creating…' : 'Create patient account'}
          </button>
          <span style={{ color: 'var(--mu)', fontSize: 14 }}>
            Already registered? <Link to="/login" state={{ role: 'PATIENT' }}>Sign in</Link>
          </span>
        </div>
      </form>
    </div>
  )
}

function Field({ id, label, mono, ...rest }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input"
             style={{ minHeight: 48, fontFamily: mono ? 'var(--mono)' : undefined }}
             {...rest} />
    </div>
  )
}
