import { useNavigate } from 'react-router-dom'
import { Sparkle, ShieldCheck, Stethoscope, ArrowRight } from '@phosphor-icons/react'
import { practitionerDashboard } from '../api/client'
import { useAuth } from '../auth'
import { useRequest } from '../components/ViewState'
import { Loading, ErrorNote, fmtDate, firstNameOf } from '../components/ui'
import { DoshaBar, RiskPill, lift, drop } from '../components/bits'

/**
 * 09 Practitioner dashboard.
 *
 * One request: GET /api/practitioner/dashboard, which returns myDiagnoses,
 * myChecks, formulationCount and aiReady - all scoped to the signed-in
 * practitioner by the session, not by a parameter this screen could get wrong.
 *
 * WHAT THIS SCREEN USED TO BE. An earlier version was entirely fabricated: a
 * hardcoded name, a hardcoded patient count, and an "awaiting sign-off" feed of
 * invented clinical events. It was then replaced by an honest empty state that
 * said no per-practitioner endpoint existed. That endpoint exists now, so the
 * empty state is gone and the two panels below show the practitioner's own real
 * sessions. The rule that survived both rewrites: nothing on this screen is
 * rendered unless the server sent it.
 *
 * The prototype prints a Tamil name beside each noi and each formulation. The
 * summaries the API returns are scalar-only and carry no Tamil column, so those
 * are omitted rather than transliterated here.
 */
export default function PractitionerDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const req = useRequest(() => practitionerDashboard(), [], { isEmpty: () => false })

  if (req.state === 'loading') return <Loading rows={5} />
  if (req.state === 'error') return <ErrorNote message={req.error?.message} onRetry={req.reload} />

  const d = req.data ?? {}
  const diagnoses = d.myDiagnoses ?? []
  const checks = d.myChecks ?? []
  // BUG-04: split(' ')[0] gave "Dr." for "Dr. Meenakshi Sundaram".
  const firstName = firstNameOf(user?.name)

  const actions = [
    {
      Icon: Stethoscope, label: 'New examination', to: '/diagnosis-intake',
      desc: 'Envagai Thervu worksheet, scored into the three kutram.',
    },
    {
      Icon: ShieldCheck, label: 'Safety check', to: '/safety-checker',
      desc: `Fixed rules across ${d.formulationCount ?? 0} preparations.`,
    },
    {
      Icon: Sparkle, label: 'Ask the corpus', to: '/assistant',
      desc: d.aiReady ? 'Answers cite book, page and verse.' : 'Assistant is not reachable right now.',
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <p style={{ margin: 0, color: 'var(--mu)', maxWidth: 640 }}>
        {firstName ? `${firstName} — s` : 'S'}tart an examination, check a formulation
        before you dispense, or look something up in the corpus.
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))',
        gap: 16,
      }}>
        {actions.map((a, i) => (
          <button key={a.label} onClick={() => navigate(a.to)} style={{
            textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer',
            background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
            padding: 24, display: 'flex', alignItems: 'center', gap: 16, minHeight: 96,
            animation: 'smSlide .6s ease both', animationDelay: `${i * 0.07}s`,
            transition: 'transform .25s, box-shadow .25s, border-color .25s',
          }} onMouseEnter={lift} onMouseLeave={drop}>
            <span style={{
              width: 48, height: 48, flex: 'none', borderRadius: 12,
              border: '1px solid var(--goldT2)', display: 'grid', placeItems: 'center',
              color: 'var(--gold)',
            }}>
              <a.Icon size={22} />
            </span>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontFamily: 'var(--serif)', fontSize: 20 }}>{a.label}</span>
              <span style={{ fontSize: 13, color: 'var(--mu)' }}>{a.desc}</span>
            </span>
            <ArrowRight size={18} style={{ color: 'var(--gold)', flex: 'none' }} />
          </button>
        ))}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))',
        gap: 24,
      }}>
        <Panel title="My recent diagnoses" action="View all" onAction={() => navigate('/diagnosis-history')}>
          {diagnoses.length === 0 ? (
            <Blank>You have not recorded an examination yet.</Blank>
          ) : diagnoses.slice(0, 5).map((r) => (
            <Row key={r.sessionId} onClick={() => navigate(`/diagnosis-history?session=${r.sessionId}`)}
                 title={r.predictedDisease || 'No prediction recorded'}
                 sub={`${r.patientName || '—'} · ${fmtDate(r.createdAt)}`}>
              <DoshaBar v={r.vathaScore} p={r.pithaScore} k={r.kabamScore} width={96} />
            </Row>
          ))}
        </Panel>

        <Panel title="My safety checks" action="New check" onAction={() => navigate('/safety-checker')}>
          {checks.length === 0 ? (
            <Blank>You have not run a safety check yet.</Blank>
          ) : checks.slice(0, 5).map((c) => (
            <Row key={c.checkId}
                 title={c.formulationName}
                 sub={`${c.drugsEntered?.trim() || 'no concurrent drugs'} · ${fmtDate(c.createdAt)}`}>
              <RiskPill level={c.riskLevel} />
            </Row>
          ))}
        </Panel>
      </div>
    </div>
  )
}

function Panel({ title, action, onAction, children }) {
  return (
    <section style={{
      background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
      padding: 24, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 12, marginBottom: 8,
      }}>
        <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>{title}</h2>
        <button className="btn btn-ghost" onClick={onAction} style={{ minHeight: 40 }}>{action}</button>
      </div>
      {children}
    </section>
  )
}

function Row({ title, sub, onClick, children }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0',
      border: 0, borderTop: '1px solid var(--line)', background: 'none',
      color: 'inherit', font: 'inherit', textAlign: 'left', minHeight: 56,
      cursor: onClick ? 'pointer' : 'default', width: '100%',
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
        <span style={{ fontSize: 13, color: 'var(--mu)' }}>{sub}</span>
      </div>
      {children}
    </Tag>
  )
}

function Blank({ children }) {
  return (
    <span style={{ fontSize: 14, color: 'var(--mu)', paddingTop: 4 }}>{children}</span>
  )
}
