import { useNavigate } from 'react-router-dom'
import { Plus } from '@phosphor-icons/react'
import { diagnosisHistory } from '../api/client'
import { useRequest } from '../components/ViewState'
import { TableCard, Loading, ErrorNote, EmptyNote, fmtDate } from '../components/ui'

/**
 * 12 Diagnosis history.
 *
 * GET /api/diagnosis/history, which the server scopes to the caller: a
 * practitioner sees their own sessions, an ADMIN sees every one. The response
 * says which via `scope`, and the lede below reflects it rather than claiming
 * "your examinations" to an admin looking at everyone's.
 *
 * The V/P/K bar is a proportion of the three scores against each other, which is
 * what the engine computed. It is NOT a percentage of anything else, and the raw
 * scores are printed beside it so the bar is never the only reading available.
 */
export default function DiagnosisHistory() {
  const navigate = useNavigate()
  const req = useRequest(() => diagnosisHistory(), [], { isEmpty: (d) => !d?.sessions?.length })
  const rows = req.data?.sessions ?? []
  const scope = req.data?.scope

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 16, flexWrap: 'wrap',
      }}>
        <p style={{ margin: 0, color: 'var(--mu)' }}>
          {scope === 'all'
            ? 'Every saved Envagai Thervu examination on this instance, newest first.'
            : 'Every Envagai Thervu examination you have saved, newest first.'}
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/diagnosis-intake')}
                style={{ minHeight: 44, padding: '0 18px' }}>
          <Plus size={16} /> New examination
        </button>
      </div>

      {req.state === 'loading' && <Loading rows={5} />}
      {req.state === 'error' && <ErrorNote message={req.error?.message} onRetry={req.reload} />}
      {req.state === 'empty' && (
        <EmptyNote
          title="No examinations yet"
          body="Readings you record appear here. Nothing is shown until one is saved."
          action={
            <button className="btn btn-primary" onClick={() => navigate('/diagnosis-intake')}
                    style={{ alignSelf: 'flex-start', minHeight: 44, padding: '0 18px' }}>
              Record an examination
            </button>
          }
        />
      )}

      {req.state === 'ready' && (
        <TableCard minWidth={760}>
          <thead>
            <tr>
              <th>Date</th><th>Record</th><th>Patient</th>
              <th>Leading noi</th><th>Dosha &middot; V / P / K</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const total = (d.vathaScore ?? 0) + (d.pithaScore ?? 0) + (d.kabamScore ?? 0)
              const pct = (n) => (total > 0 ? `${Math.round(((n ?? 0) / total) * 100)}%` : '0%')
              return (
                <tr key={d.sessionId}>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--mu)' }}>
                    {fmtDate(d.createdAt)}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>#{d.sessionId}</td>
                  <td>{d.patientName || '—'}</td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{d.predictedDisease || '—'}</span>
                    {d.dominantKutram && (
                      <span style={{ color: 'var(--mu)', marginLeft: 8, fontSize: 13 }}>
                        {d.dominantKutram}
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{
                        display: 'flex', width: 120, height: 8, borderRadius: 4,
                        overflow: 'hidden', gap: 2, background: 'var(--line)',
                      }}>
                        <span style={{ background: 'var(--va)', width: pct(d.vathaScore) }} />
                        <span style={{ background: 'var(--pi)', width: pct(d.pithaScore) }} />
                        <span style={{ background: 'var(--ka)', width: pct(d.kabamScore) }} />
                      </span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--mu)' }}>
                        {d.vathaScore} / {d.pithaScore} / {d.kabamScore}
                      </span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {/* The result screen renders from router state, and the history
                        endpoint returns a summary rather than the full reading, so
                        there is nothing to hand it. Sending the practitioner to the
                        intake form is honest; a "View" that opened an empty result
                        screen would not be. */}
                    <span style={{ fontSize: 12, color: 'var(--mu)' }}>summary only</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </TableCard>
      )}
    </div>
  )
}
