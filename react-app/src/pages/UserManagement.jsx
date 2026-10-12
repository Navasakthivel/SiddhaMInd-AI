import { useMemo, useState } from 'react'
import {
  MagnifyingGlass, UserPlus, Key, Prohibit, ArrowCounterClockwise, X,
  Copy, Check, WarningCircle, CheckCircle,
} from '@phosphor-icons/react'
import { adminUsers, createUser, setUserStatus, resetUserPassword } from '../api/client'
import { useRequest } from '../components/ViewState'
import { Loading, ErrorNote, EmptyNote } from '../components/ui'
import { useToast } from '../components/Toast'
import { ROLE_STYLE } from '../nav'

/**
 * 06 User management.
 *
 * BUG-05 IS FIXED ON THE SERVER, AND THIS SCREEN DEPENDS ON THAT.
 * AdminService.allUsers() orders by user id, and this screen reloads from that
 * ordered query after every action - it never reorders or patches rows
 * locally, because a local patch would hide a server-side regression.
 *
 * Login model:
 *  - "Create user" makes doctors (PRACTITIONER) and students only. The server
 *    issues a login ID and a six-digit activation code; the code exists in
 *    plaintext only in that one response, so it is shown once, here, with a
 *    copy button. Admins are seeded; patients self-register.
 *  - "Reset password" for a doctor/student issues a new code the same way,
 *    and the server ends their open sessions. For an admin/patient it still
 *    sets a password typed by the admin.
 */
const ID_ROLES = ['PRACTITIONER', 'STUDENT']
const ROLE_LABEL = { PRACTITIONER: 'Doctor', STUDENT: 'Student', ADMIN: 'Admin', PATIENT: 'Patient' }

export default function UserManagement() {
  const req = useRequest(() => adminUsers(), [], { isEmpty: (d) => !d?.users?.length })
  const toast = useToast()
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [modal, setModal] = useState(null) // null | {kind:'create'} | {kind:'reset', user} | {kind:'issued', ...}
  const [error, setError] = useState(null)

  const users = req.data?.users ?? []
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return users
    return users.filter((u) => [u.fullName, u.email, u.role, u.institution, u.loginId, ROLE_LABEL[u.role]]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(term)))
  }, [users, q])

  async function toggleStatus(u) {
    setBusyId(u.userId)
    setError(null)
    try {
      const next = u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
      await setUserStatus(u.userId, next)
      toast.success(next === 'ACTIVE' ? `${u.fullName} reinstated` : `${u.fullName} suspended`)
      await req.reload()
    } catch (e) {
      setError(e.message)
      toast.error('Could not change that account', { detail: e.message })
    } finally {
      setBusyId(null)
    }
  }

  async function resetPassword(u) {
    if (ID_ROLES.includes(u.role)) {
      setModal({ kind: 'reset', user: u })
      return
    }
    // Admin / patient: no login ID, so the admin sets a password and hands it over.
    const pw = window.prompt(`New password for ${u.fullName} (at least 8 characters):`)
    if (!pw) return
    if (pw.length < 8) {
      setError('The new password must be at least 8 characters.')
      return
    }
    setBusyId(u.userId)
    setError(null)
    try {
      await resetUserPassword(u.userId, pw)
      toast.success(`Password reset for ${u.fullName}`)
    } catch (e) {
      setError(e.message)
      toast.error('Could not reset that password', { detail: e.message })
    } finally {
      setBusyId(null)
    }
  }

  async function issueNewCode(u) {
    setBusyId(u.userId)
    setError(null)
    try {
      const r = await resetUserPassword(u.userId)
      setModal({ kind: 'issued', reason: 'reset', name: u.fullName, role: u.role, ...r })
    } catch (e) {
      setModal(null)
      setError(e.message)
      toast.error('Could not issue a new code', { detail: e.message })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 16,
        alignItems: 'center', justifyContent: 'space-between',
      }}>
        <label style={{ position: 'relative', flex: '1 1 320px', maxWidth: 480 }}>
          <MagnifyingGlass size={18} style={{ position: 'absolute', left: 14, top: 15, color: 'var(--mu)' }} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Search by name, email, login ID or role" aria-label="Search users"
                 style={{ minHeight: 48, paddingLeft: 40, background: 'var(--s1)' }} />
        </label>
        <button className="btn btn-primary" onClick={() => setModal({ kind: 'create' })}
                style={{ minHeight: 48, padding: '0 20px' }}>
          <UserPlus size={18} /> Create user
        </button>
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

      {req.state === 'loading' && <Loading rows={5} />}
      {req.state === 'error' && <ErrorNote message={req.error?.message} onRetry={req.reload} />}
      {req.state === 'empty' && <EmptyNote title="No accounts" body="No user records were returned." />}

      {req.state === 'ready' && (rows.length === 0 ? (
        <EmptyNote title="Nothing matched" body="No account matched that search." />
      ) : (
        <section style={{
          background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
          padding: '8px 24px 16px', overflowX: 'auto',
        }}>
          <table className="table" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>Name</th><th>Login ID</th><th>Role</th><th>Institution</th>
                <th>Status</th><th>Registration</th><th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const rs = ROLE_STYLE[u.role] ?? { label: u.role, color: 'var(--mu)' }
                const active = u.status === 'ACTIVE'
                const stc = active ? 'var(--jade)' : 'var(--amb)'
                const busy = busyId === u.userId
                return (
                  <tr key={u.userId} data-login-id={u.loginId ?? undefined}>
                    <td style={{ padding: '12px 6px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 600 }}>{u.fullName}</span>
                        <span style={{ fontSize: 13, color: 'var(--mu)' }}>{u.email}</span>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 13, whiteSpace: 'nowrap' }}>
                      {u.loginId || <span style={{ color: 'var(--mu)' }}>Email sign-in</span>}
                    </td>
                    <td>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                        border: `1px solid ${rs.color}`, color: rs.color, whiteSpace: 'nowrap',
                      }}>
                        {ROLE_LABEL[u.role] ?? rs.label}
                      </span>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--mu)' }}>{u.institution || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                        <span style={{
                          fontSize: 13, fontWeight: 600, color: stc,
                          display: 'inline-flex', gap: 6, alignItems: 'center',
                        }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: stc }} />
                          {u.status}
                        </span>
                        <ActivationBadge user={u} />
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--mu)' }}>
                      {u.regNumber || '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary" disabled={busy}
                                onClick={() => toggleStatus(u)} style={{ minHeight: 40 }}>
                          {active ? <Prohibit size={15} /> : <ArrowCounterClockwise size={15} />}
                          {active ? 'Suspend' : 'Reinstate'}
                        </button>
                        <button className="btn btn-secondary" disabled={busy}
                                onClick={() => resetPassword(u)} style={{ minHeight: 40 }}>
                          <Key size={15} /> Reset password
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      ))}

      {modal?.kind === 'create' && (
        <CreateUserModal
          onClose={() => setModal(null)}
          onCreated={(issued) => setModal({ kind: 'issued', reason: 'create', ...issued })}
        />
      )}

      {modal?.kind === 'reset' && (
        <ConfirmResetModal
          user={modal.user}
          busy={busyId === modal.user.userId}
          onCancel={() => setModal(null)}
          onConfirm={() => issueNewCode(modal.user)}
        />
      )}

      {modal?.kind === 'issued' && (
        <Dialog label="Activation code" onClose={null}>
          <IssuedPanel issued={modal} onDone={async () => {
            toast.success(modal.reason === 'create' ? `${modal.name} created` : `New code issued for ${modal.name}`)
            setModal(null)
            // Reloaded on Done rather than behind the panel, so the table is not
            // a loading skeleton while the code is being read off the screen.
            await req.reload()
          }} />
        </Dialog>
      )}
    </div>
  )
}

/** "Activation pending" until the user sets a password; "Expired" once the code lapses. */
function ActivationBadge({ user }) {
  if (!user.activationPending) return null
  const expired = user.activationExpired
  const c = expired ? 'var(--red)' : 'var(--amb)'
  return (
    <span data-testid={expired ? 'badge-expired' : 'badge-pending'} title={
      user.activationExpiresAt ? `Code ${expired ? 'expired' : 'expires'} ${formatWhen(user.activationExpiresAt)}` : undefined
    } style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap',
      color: c, background: expired ? 'var(--redT)' : 'var(--ambT)', border: `1px solid ${c}`,
    }}>
      {expired ? 'Expired' : 'Activation pending'}
    </span>
  )
}

function formatWhen(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * The modal frame used by every dialog on this screen. `onClose` null means
 * the backdrop does not dismiss it - used for the one-time code, which must
 * not vanish on a stray click before it has been copied.
 */
function Dialog({ label, onClose, children, as = 'div', onSubmit }) {
  const Tag = as
  return (
    <div onClick={onClose ?? undefined} style={{
      position: 'fixed', inset: 0, zIndex: 80, background: 'var(--glass)',
      backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
      display: 'grid', placeItems: 'center', padding: 16, overflowY: 'auto',
    }}>
      <Tag role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}
           onSubmit={onSubmit} noValidate={as === 'form' ? true : undefined}
           style={{
             width: 'min(520px,100%)', background: 'var(--s1)', border: '1px solid var(--line2)',
             borderRadius: 16, padding: 'clamp(20px,5vw,32px)', display: 'flex', flexDirection: 'column', gap: 20,
             boxShadow: '0 40px 80px -24px rgba(0,0,0,.7)', animation: 'smUp .25s ease both',
             maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
           }}>
        {children}
      </Tag>
    </div>
  )
}

function DialogHeader({ title, onClose }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 26, margin: 0 }}>{title}</h2>
      {onClose && (
        <button type="button" className="btn btn-secondary" aria-label="Close" onClick={onClose}
                style={{ width: 44, height: 44, padding: 0, flex: 'none' }}>
          <X size={16} />
        </button>
      )}
    </div>
  )
}

function Field({ id, label, optional, ...rest }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}{optional && <span style={{ color: 'var(--mu)' }}> (optional)</span>}
      </label>
      <input id={id} className="input" style={{ minHeight: 48 }} {...rest} />
    </div>
  )
}

function CreateUserModal({ onClose, onCreated }) {
  const [f, setF] = useState({
    fullName: '', email: '', phone: '', institution: '', regNumber: '', role: 'PRACTITIONER',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    if (!f.fullName.trim() || !f.email.trim()) {
      setErr('Name and email are required.')
      return
    }
    if (!f.email.includes('@')) {
      setErr('Enter a valid email address.')
      return
    }
    setBusy(true)
    try {
      const r = await createUser(f)
      onCreated({ ...r, name: f.fullName.trim(), role: f.role })
    } catch (e2) {
      setErr(e2.message)
      setBusy(false)
    }
  }

  return (
    <Dialog label="Create user" onClose={onClose} as="form" onSubmit={submit}>
      <DialogHeader title="Create user" onClose={onClose} />

      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend style={{ fontSize: 12, color: 'color-mix(in srgb,var(--tx) 70%,transparent)', marginBottom: 5 }}>
          Account type
        </legend>
        <div className="seg" role="radiogroup" style={{ display: 'flex', alignSelf: 'flex-start' }}>
          {ID_ROLES.map((r) => (
            <label key={r} className="seg-opt" style={{ minHeight: 44, padding: '0 18px', fontSize: 14 }}>
              <input type="radio" name="nu-role" value={r} checked={f.role === r}
                     onChange={() => setF((s) => ({ ...s, role: r }))} />
              {ROLE_LABEL[r]}
            </label>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--mu)' }}>
          Patients register themselves. Admin accounts cannot be created here.
        </span>
      </fieldset>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 16 }}>
        <Field id="nu-name" label="Full name" value={f.fullName} onChange={set('fullName')} />
        <Field id="nu-email" label="Email" type="email" value={f.email} onChange={set('email')} />
        <Field id="nu-phone" label="Phone" type="tel" value={f.phone} onChange={set('phone')} optional />
        <Field id="nu-reg" label={f.role === 'STUDENT' ? 'Enrolment number' : 'Registration number'}
               value={f.regNumber} onChange={set('regNumber')} optional
               style={{ minHeight: 48, fontFamily: 'var(--mono)' }} />
        <div style={{ gridColumn: '1 / -1' }}>
          <Field id="nu-inst" label="Institution" value={f.institution} onChange={set('institution')} optional />
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 13, color: 'var(--mu)' }}>
        The server issues a {f.role === 'STUDENT' ? 'Student' : 'Doctor'} ID and a one-time activation
        code. You will see the code once, on the next screen, to hand over in person.
      </p>

      {err && <p role="alert" style={{ margin: 0, color: 'var(--red)', fontSize: 13 }}>{err}</p>}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}
                style={{ minHeight: 44, padding: '0 16px' }}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}
                style={{ minHeight: 44, padding: '0 20px' }}>
          {busy ? 'Creating…' : `Create ${ROLE_LABEL[f.role].toLowerCase()}`}
        </button>
      </div>
    </Dialog>
  )
}

function ConfirmResetModal({ user, busy, onCancel, onConfirm }) {
  return (
    <Dialog label="Reset password" onClose={onCancel}>
      <DialogHeader title="Reset password" onClose={onCancel} />
      <p style={{ margin: 0 }}>
        Issue a new activation code for <b>{user.fullName}</b>
        {user.loginId && <> (<span style={{ fontFamily: 'var(--mono)' }}>{user.loginId}</span>)</>}?
      </p>
      <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--mu)', fontSize: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <li>Their current password stops working immediately.</li>
        <li>Anywhere they are signed in, they are signed out.</li>
        <li>They sign in next with their ID and the new code, then choose a new password.</li>
      </ul>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}
                style={{ minHeight: 44, padding: '0 16px' }}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}
                style={{ minHeight: 44, padding: '0 20px' }}>
          {busy ? 'Issuing…' : 'Issue new code'}
        </button>
      </div>
    </Dialog>
  )
}

/**
 * The one-time credential. Nothing on the server can show this code again -
 * only its hash is stored - so the panel says so plainly and only closes on
 * an explicit "Done".
 */
function IssuedPanel({ issued, onDone }) {
  const [copied, setCopied] = useState(null) // null | 'ok' | 'failed'
  const idLabel = issued.role === 'STUDENT' ? 'Student ID' : 'Doctor ID'
  const expires = formatWhen(issued.activationExpiresAt)

  async function copy() {
    const text = [
      'SiddhaMind sign-in',
      `${idLabel}: ${issued.loginId}`,
      `Activation code: ${issued.activationCode}`,
      `Expires: ${expires}`,
      `Activate at: ${window.location.origin}/activate`,
    ].join('\n')
    setCopied((await copyText(text)) ? 'ok' : 'failed')
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <CheckCircle size={28} style={{ color: 'var(--jade)', flex: 'none' }} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 26, margin: 0 }}>
            {issued.reason === 'create' ? `${ROLE_LABEL[issued.role]} created` : 'New activation code'}
          </h2>
          <span style={{ color: 'var(--mu)', fontSize: 14 }}>{issued.name}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: 12 }}>
        <CredentialTile label={idLabel} value={issued.loginId} testId="cred-login-id" />
        <CredentialTile label="Activation code" value={issued.activationCode} testId="cred-code" spaced />
      </div>

      <div style={{ fontSize: 14, color: 'var(--mu)' }}>
        Code expires <b data-testid="cred-expiry" style={{ color: 'var(--tx)' }}>{expires}</b>
      </div>

      <div role="alert" style={{
        display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 10,
        background: 'var(--ambT)', border: '1px solid var(--amb)', color: 'var(--tx)', fontSize: 14,
      }}>
        <WarningCircle size={20} style={{ color: 'var(--amb)', flex: 'none', marginTop: 1 }} />
        <span>
          <b>This code is shown only once.</b> Copy it now and give it to {issued.name} together
          with their {idLabel}. It cannot be shown again &mdash; if it is lost, use
          Reset password to issue a new one.
        </span>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
        {copied === 'failed' && (
          <span role="status" style={{ fontSize: 13, color: 'var(--red)', marginRight: 'auto' }}>
            Could not copy &mdash; select the text above instead.
          </span>
        )}
        <button type="button" className="btn btn-secondary" onClick={copy}
                style={{ minHeight: 44, padding: '0 16px' }}>
          {copied === 'ok' ? <Check size={16} /> : <Copy size={16} />}
          {copied === 'ok' ? 'Copied' : 'Copy ID and code'}
        </button>
        <button type="button" className="btn btn-primary" onClick={onDone}
                style={{ minHeight: 44, padding: '0 20px' }}>
          Done
        </button>
      </div>
    </>
  )
}

/**
 * Clipboard write with a fallback. `navigator.clipboard` exists only on secure
 * origins (HTTPS or localhost) and rejects when the document is not focused,
 * so a deployment reached over plain HTTP on a LAN would otherwise never copy.
 * The fallback is the old hidden-textarea + execCommand route, which works in
 * both cases as long as it runs inside the click handler.
 */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the legacy route */ }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  document.body.removeChild(ta)
  return ok
}

function CredentialTile({ label, value, testId, spaced }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px',
      background: 'var(--bg)', border: '1px solid var(--goldT2)', borderRadius: 12,
    }}>
      <span style={{ fontSize: 12, color: 'var(--mu)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span data-testid={testId} style={{
        fontFamily: 'var(--mono)', fontSize: 26, color: 'var(--gold)', userSelect: 'all',
        letterSpacing: spaced ? '.25em' : '.02em', whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  )
}
