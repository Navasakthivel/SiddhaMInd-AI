import { useNavigate } from 'react-router-dom'
import {
  Books, UsersThree, Flask, Atom, FileText, Sparkle,
} from '@phosphor-icons/react'
import { adminStats, corpusDocuments, assistantStatus } from '../api/client'
import { useRequest } from '../components/ViewState'
import { Card, TableCard, Loading, ErrorNote, fmtDate } from '../components/ui'
import { DoshaBar, RiskPill, StatusDot, lift, drop } from '../components/bits'

/**
 * 05 Admin dashboard.
 *
 * Three live sources: /api/admin/stats (counts, activity and the two recent
 * panels), /api/admin/corpus (documents) and /api/assistant/status.
 *
 * The AI status pill reports what the server says, not what is configured.
 * HttpAiQueryAdapter probes /health with a cached liveness check, so
 * "Connected" here means the service answered - not merely that a base-url is
 * set, which is the bug that made this pill lie before.
 */
export default function AdminDashboard() {
  const navigate = useNavigate()
  const stats = useRequest(() => adminStats(), [], { isEmpty: () => false })
  const corpus = useRequest(() => corpusDocuments(), [], { isEmpty: () => false })
  const ai = useRequest(() => assistantStatus(), [], { isEmpty: () => false })

  if (stats.state === 'loading') return <Loading rows={6} />
  if (stats.state === 'error') return <ErrorNote message={stats.error?.message} onRetry={stats.reload} />

  const s = stats.data ?? {}
  const docs = corpus.data?.documents ?? []
  const online = ai.data?.aiAvailable === true
  const aiColor = online ? 'var(--jade)' : 'var(--red)'

  const tiles = [
    { label: 'Indexed passages', value: s.chunkCount, sub: 'Retrievable chunks', Icon: FileText, to: '/corpus-upload' },
    { label: 'Registered users', value: s.userCount, sub: 'Across every role', Icon: UsersThree, to: '/user-management' },
    { label: 'Formulations', value: s.formulationCount, sub: 'In the formulary', Icon: Flask, to: '/formulary' },
    { label: 'Heavy-metal preparations', value: s.heavyMetalCount, sub: 'Carry a ceiling check', Icon: Atom, to: '/formulary' },
    { label: 'Source documents', value: s.documentCount, sub: `${s.indexedDocs ?? 0} indexed`, Icon: Books, to: '/corpus-upload' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))',
        gap: 16,
      }}>
        {tiles.map((t, i) => (
          <button key={t.label} onClick={() => navigate(t.to)} style={{
            textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer',
            background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
            padding: 20, display: 'flex', flexDirection: 'column', gap: 8,
            animation: 'smSlide .6s ease both', animationDelay: `${i * 0.06}s`,
            transition: 'transform .25s, box-shadow .25s, border-color .25s',
          }} onMouseEnter={lift} onMouseLeave={drop}>
            <span style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              color: 'var(--mu)', fontSize: 13,
            }}>
              {t.label}<t.Icon size={18} style={{ color: 'var(--gold)' }} />
            </span>
            {/* Rendered final. These are counts, and a tile still climbing shows a
                number that is not the real one. */}
            <span style={{
              fontFamily: 'var(--serif)', fontSize: 40, lineHeight: 1, letterSpacing: '-.02em',
            }}>
              {t.value ?? '—'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--mu)' }}>{t.sub}</span>
          </button>
        ))}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))',
        gap: 24,
      }}>
        <Card style={{ gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>
              AI service status
            </h2>
            <span style={{
              display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '0 12px',
              borderRadius: 999, border: `1px solid ${aiColor}`, color: aiColor,
              fontSize: 12, fontWeight: 600,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: aiColor }} />
              {ai.state === 'loading' ? 'Checking…' : online ? 'Connected' : 'Offline'}
            </span>
          </div>
          {[
            ['Assistant (RAG)', online ? 'Answering from the indexed corpus' : 'Unreachable — rules still work', online],
            ['Retrieval index', `${s.chunkCount ?? 0} chunks across ${s.indexedDocs ?? 0} indexed documents`, (s.chunkCount ?? 0) > 0],
            ['Rule engine', 'Deterministic; never depends on the AI service', true],
          ].map(([name, detail, ok]) => (
            <div key={name} style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '12px 0', borderTop: '1px solid var(--line)',
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flex: 'none',
                background: ok ? 'var(--jade)' : 'var(--red)',
              }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{name}</span>
                <span style={{ fontSize: 13, color: 'var(--mu)' }}>{detail}</span>
              </div>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 12,
                color: ok ? 'var(--jade)' : 'var(--red)',
              }}>
                {ok ? 'OK' : 'DOWN'}
              </span>
            </div>
          ))}
        </Card>

        <Card style={{ gap: 16 }}>
          <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>Activity</h2>
          {(s.recentActivity ?? []).length === 0 ? (
            <span style={{ color: 'var(--mu)', fontSize: 14 }}>
              Nothing recorded yet. Sign-ins, uploads and checks appear here.
            </span>
          ) : (
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
              {(s.recentActivity ?? []).slice(0, 6).map((a, i) => (
                <li key={i} style={{ display: 'flex', gap: 16, position: 'relative', paddingBottom: 16 }}>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none' }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%', marginTop: 6,
                      border: '2px solid var(--gold)',
                    }} />
                    <span style={{ flex: 1, width: 1, background: 'var(--line2)', marginTop: 4 }} />
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14 }}>
                      <strong style={{ fontWeight: 600 }}>{a.action}</strong>{' '}
                      {a.details || ''}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>
                      {fmtDate(a.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card style={{ gap: 16 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 16, flexWrap: 'wrap',
        }}>
          <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>Corpus</h2>
          <button className="btn btn-secondary" onClick={() => navigate('/corpus-upload')}
                  style={{ minHeight: 40 }}>
            Manage corpus
          </button>
        </div>
        {docs.length === 0 ? (
          <span style={{ color: 'var(--mu)', fontSize: 14 }}>No sources uploaded yet.</span>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: 640 }}>
              <thead>
                <tr><th>Document</th><th>Language</th><th>Pages</th><th>Chunks</th><th>Status</th></tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.docId}>
                    <td style={{ fontWeight: 500 }}>{d.title}</td>
                    <td>{d.language || '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{d.totalPages ?? 0}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{d.chunkCount ?? 0}</td>
                    <td><StatusDot status={d.ingestStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))',
        gap: 24,
      }}>
        <Card style={{ gap: 8 }}>
          <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: '0 0 8px' }}>
            Recent safety checks
          </h2>
          {(s.recentChecks ?? []).length === 0 ? (
            <span style={{ color: 'var(--mu)', fontSize: 14 }}>No checks have been run yet.</span>
          ) : s.recentChecks.map((c) => (
            <div key={c.checkId} style={{
              display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0',
              borderTop: '1px solid var(--line)', minHeight: 56,
            }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{c.formulationName}</span>
                <span style={{ fontSize: 13, color: 'var(--mu)' }}>
                  {c.drugsEntered?.trim() || 'no drugs'} &middot; {fmtDate(c.createdAt)}
                </span>
              </div>
              <RiskPill level={c.riskLevel} />
            </div>
          ))}
        </Card>

        <Card style={{ gap: 8 }}>
          <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: '0 0 8px' }}>
            Recent diagnoses
          </h2>
          {(s.recentDiagnoses ?? []).length === 0 ? (
            <span style={{ color: 'var(--mu)', fontSize: 14 }}>No examinations recorded yet.</span>
          ) : s.recentDiagnoses.map((d) => (
            <div key={d.sessionId} style={{
              display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0',
              borderTop: '1px solid var(--line)', minHeight: 56,
            }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{d.predictedDisease || '—'}</span>
                <span style={{ fontSize: 13, color: 'var(--mu)' }}>
                  {d.patientName || '—'} &middot; {fmtDate(d.createdAt)}
                </span>
              </div>
              <DoshaBar v={d.vathaScore} p={d.pithaScore} k={d.kabamScore} width={96} />
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}
