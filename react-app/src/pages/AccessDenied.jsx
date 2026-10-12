import { useLocation, useNavigate } from 'react-router-dom'
import { LockKey, Check, Minus } from '@phosphor-icons/react'
import { useAuth } from '../auth'
import { routeForRole } from './Landing'
import { titleForPath, ROLE_STYLE } from '../nav'

/**
 * 04 Access denied.
 *
 * The capability table mirrors AuthInterceptor.RULES, the same table nav.js
 * mirrors. An earlier version of this screen listed capabilities the product
 * does not have ("Prescribe a formula", "Override a HIGH verdict") and hardcoded
 * the role to "Student"; on a screen whose only job is to explain a refusal, an
 * inaccurate table is worse than no table.
 *
 * Column order matches the prototype: Patient, Student, Practitioner, Admin.
 */
const YES = 1
const NO = 0

//                                        Pat Stu Pra Adm
const ROWS = [
  ['Browse the formulary',                [YES, YES, YES, YES]],
  ['Look up ingredients and noi',         [YES, YES, YES, YES]],
  ['Ask the assistant',                   [YES, YES, YES, YES]],
  ['Run a safety check',                  [NO,  YES, YES, YES]],
  ['Record an eight-fold examination',    [NO,  NO,  YES, YES]],
  ['Read diagnosis history',              [NO,  NO,  YES, YES]],
  ['Manage user accounts',                [NO,  NO,  NO,  YES]],
  ['Upload and index corpus sources',     [NO,  NO,  NO,  YES]],
  ['See system-wide reports',             [NO,  NO,  NO,  YES]],
]

const COLUMNS = ['Patient', 'Student', 'Practitioner', 'Admin']

export default function AccessDenied() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const attempted = location.state?.attempted
  const deniedName = attempted ? titleForPath(attempted) : 'That screen'
  const roleLabel = ROLE_STYLE[role]?.label ?? 'your'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 860 }}>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <span style={{
          width: 72, height: 72, borderRadius: '50%', border: '1px solid var(--goldT2)',
          display: 'grid', placeItems: 'center', color: 'var(--gold)', flex: 'none',
        }}>
          <LockKey size={32} />
        </span>
        <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{
            fontFamily: 'var(--serif)', fontWeight: 400,
            fontSize: 'clamp(28px,3vw,38px)', margin: 0,
          }}>
            {deniedName} isn&rsquo;t part of the {roleLabel} workspace
          </h2>
          <p style={{ margin: 0, color: 'var(--mu)', textWrap: 'pretty' }}>
            Nothing is wrong with your account. Each role sees the tools it needs &mdash; if you
            should have access, ask an administrator to change your role.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
            <button className="btn btn-primary"
                    onClick={() => navigate(role ? routeForRole(role) : '/login')}
                    style={{ minHeight: 44, padding: '0 18px' }}>
              {role ? 'Back to my dashboard' : 'Sign in'}
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/assistant')}
                    style={{ minHeight: 44, padding: '0 16px' }}>
              Ask the assistant
            </button>
          </div>
        </div>
      </div>

      <section style={{
        background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
        padding: '8px 24px 16px', overflowX: 'auto',
      }}>
        <table className="table" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>Capability</th>
              {COLUMNS.map((c) => <th key={c} style={{ textAlign: 'center' }}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, cells]) => (
              <tr key={label}>
                <td style={{ padding: '12px 6px' }}>{label}</td>
                {cells.map((v, i) => (
                  <td key={COLUMNS[i]} style={{ textAlign: 'center' }}>
                    {v === YES
                      ? <Check size={18} aria-label="Yes" style={{ color: 'var(--jade)' }} />
                      : <Minus size={18} aria-label="No" style={{ color: 'var(--mu)' }} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
