import { Bell } from '@phosphor-icons/react'
import { profile as fetchProfile } from '../api/client'
import { useRequest } from '../components/ViewState'
import { Card, Loading, ErrorNote, fmtDate } from '../components/ui'
import { ROLE_STYLE, initialsFor } from '../nav'

/**
 * 21 Profile.
 *
 * One request: GET /api/profile returns the user and their notifications
 * together.
 *
 * The prototype has an "Edit details" button. There is no update endpoint on the
 * server, so it is not rendered - a button that cannot do anything is worse than
 * its absence, and this screen is the one place a person comes to correct their
 * own record.
 */
export default function Profile() {
  const req = useRequest(() => fetchProfile(), [], { isEmpty: (d) => !d?.profile })

  if (req.state === 'loading') return <Loading rows={6} />
  if (req.state === 'error') return <ErrorNote message={req.error?.message} onRetry={req.reload} />

  const me = req.data?.profile ?? {}
  const notifs = req.data?.notifications ?? []
  const style = ROLE_STYLE[me.role] ?? { label: me.role ?? '—', color: 'var(--tx)' }
  const initials = initialsFor({ name: me.name, email: me.email })

  const rows = [
    ['Email', me.email],
    ['Phone', me.phone],
    ['Institution', me.institution],
    ['Registration / enrolment', me.regNumber],
    ['Account status', me.status],
    ['Member since', me.createdAt ? fmtDate(me.createdAt) : null],
    ['Last sign-in', me.lastLogin ? fmtDate(me.lastLogin) : null],
  ]

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))',
      gap: 24, alignItems: 'start',
    }}>
      <Card style={{ gap: 20, animation: 'smUp .4s ease both' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{
            width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center',
            fontFamily: 'var(--serif)', fontSize: 24,
            border: `1px solid ${style.color}`, color: style.color, flex: 'none',
          }}>
            {initials}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--serif)', fontSize: 24 }}>{me.name}</span>
            <span style={{
              alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, padding: '2px 8px',
              borderRadius: 6, border: `1px solid ${style.color}`, color: style.color,
            }}>
              {style.label}
            </span>
          </div>
        </div>

        <dl style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{
              display: 'grid', gridTemplateColumns: '150px 1fr', gap: 16,
              padding: '12px 0', borderTop: '1px solid var(--line)',
            }}>
              <dt style={{ fontSize: 13, color: 'var(--mu)' }}>{k}</dt>
              <dd style={{ margin: 0, fontSize: 14, wordBreak: 'break-word' }}>
                {v || <span style={{ color: 'var(--mu)' }}>Not recorded</span>}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card style={{ gap: 8, animation: 'smUp .4s ease both', animationDelay: '.08s' }}>
        <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: '0 0 8px' }}>
          Notifications
        </h2>
        {notifs.length === 0 ? (
          <span style={{ color: 'var(--mu)', fontSize: 14 }}>
            Nothing yet. Alerts about your checks and the corpus appear here.
          </span>
        ) : notifs.map((n) => (
          <div key={n.notifId} style={{
            display: 'flex', gap: 12, padding: '12px 0', borderTop: '1px solid var(--line)',
          }}>
            <Bell
              size={19}
              weight={n.read ? 'regular' : 'fill'}
              style={{ color: n.read ? 'var(--mu)' : 'var(--gold)', marginTop: 2, flex: 'none' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14 }}>{n.title}</span>
              {n.message && <span style={{ fontSize: 13, color: 'var(--mu)' }}>{n.message}</span>}
              <span style={{ fontSize: 12, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>
                {fmtDate(n.createdAt)}
              </span>
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}
