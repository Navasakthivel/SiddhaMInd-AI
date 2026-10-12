import { useMemo } from 'react'
import { adminReports, searchFormulary } from '../api/client'
import { useRequest } from '../components/ViewState'
import { Card, Loading, ErrorNote, fmtDate } from '../components/ui'

/**
 * 08 System reports.
 *
 * Two live sources, no invented series:
 *   - GET /api/admin/reports  role counts, corpus counts and the activity feed
 *   - GET /api/formulary      grouped by dosageForm in the browser
 *
 * The dosage-form chart has no endpoint of its own. Rather than omit the panel
 * or invent buckets, it groups the real formulary response, which already
 * carries dosageForm on every row. If a new dosage form is added to the data it
 * appears here automatically.
 *
 * The audit table shows what the server actually returns: action, details,
 * ipAddress and time. There is no "user" column because ActivityLog.user is a
 * lazy association the endpoint deliberately does not dereference - for LOGIN
 * rows the email is already in `details`.
 */
const ROLE_BARS = [
  { key: 'adminCount', label: 'Admin', c: 'var(--gold)' },
  { key: 'practitionerCount', label: 'Practitioner', c: 'var(--jade)' },
  { key: 'studentCount', label: 'Student', c: 'var(--va)' },
  { key: 'patientCount', label: 'Patient', c: 'var(--mu)' },
]

export default function SystemReports() {
  const reports = useRequest(() => adminReports(), [], { isEmpty: () => false })
  const forms = useRequest(() => searchFormulary(''), [], { isEmpty: () => false })

  const byForm = useMemo(() => {
    const rows = forms.data?.results ?? []
    const counts = new Map()
    for (const f of rows) {
      const key = f.dosageForm || 'Unspecified'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([label, n]) => ({ label, n }))
      .sort((a, b) => b.n - a.n)
  }, [forms.data])

  if (reports.state === 'loading') return <Loading rows={6} />
  if (reports.state === 'error') {
    return <ErrorNote message={reports.error?.message} onRetry={reports.reload} />
  }

  const s = reports.data ?? {}
  const roleMax = Math.max(1, ...ROLE_BARS.map((b) => s[b.key] ?? 0))
  const formMax = Math.max(1, ...byForm.map((b) => b.n))
  const activity = s.recentActivity ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))',
        gap: 24,
      }}>
        <Card style={{ gap: 16 }}>
          <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>
            Users per role
          </h2>
          {ROLE_BARS.map((b, i) => {
            const n = s[b.key] ?? 0
            return (
              <div key={b.key} style={{
                display: 'grid', gridTemplateColumns: '110px 1fr 32px',
                alignItems: 'center', gap: 16,
              }}>
                <span style={{ fontSize: 14 }}>{b.label}</span>
                <span style={{ height: 10, borderRadius: 5, background: 'var(--line)' }}>
                  <span style={{
                    display: 'block', height: '100%', borderRadius: 5,
                    transformOrigin: 'left',
                    animation: 'smBar .9s cubic-bezier(.3,.7,.2,1) both',
                    animationDelay: `${i * 0.08}s`,
                    width: `${Math.round((n / roleMax) * 100)}%`,
                    background: b.c,
                  }} />
                </span>
                <span style={{ fontFamily: 'var(--mono)', textAlign: 'right' }}>{n}</span>
              </div>
            )
          })}
        </Card>

        <Card style={{ gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>
              Formulary by dosage form
            </h2>
            <span style={{ fontSize: 13, color: 'var(--mu)' }}>
              {s.heavyMetalCount ?? 0} heavy-metal
            </span>
          </div>
          {forms.state === 'loading' ? <Loading rows={2} /> : (
            <div style={{
              display: 'flex', alignItems: 'flex-end', gap: 24,
              height: 160, paddingTop: 8,
            }}>
              {byForm.map((b, i) => (
                <div key={b.label} style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: 8, height: '100%', justifyContent: 'flex-end',
                }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{b.n}</span>
                  <span style={{
                    width: '100%', maxWidth: 56, borderRadius: '8px 8px 2px 2px',
                    background: 'linear-gradient(to top,var(--goldT2),var(--gold))',
                    transformOrigin: 'bottom',
                    animation: 'smBarY .9s cubic-bezier(.3,.7,.2,1) both',
                    animationDelay: `${i * 0.08}s`,
                    height: `${Math.max(6, Math.round((b.n / formMax) * 100))}%`,
                  }} />
                  <span style={{ fontSize: 12, color: 'var(--mu)', textAlign: 'center' }}>{b.label}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card style={{ gap: 16 }}>
        <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>
          Audit log
        </h2>
        {activity.length === 0 ? (
          <span style={{ color: 'var(--mu)', fontSize: 14 }}>
            Nothing recorded yet. Sign-ins, uploads and checks appear here as they happen.
          </span>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: 700 }}>
              <thead>
                <tr><th>Time</th><th>Action</th><th>Details</th><th>IP address</th></tr>
              </thead>
              <tbody>
                {activity.map((a, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--mu)' }}>
                      {fmtDate(a.createdAt)}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)' }}>
                      {a.action}
                    </td>
                    <td style={{ fontSize: 13 }}>{a.details || '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{a.ipAddress || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
