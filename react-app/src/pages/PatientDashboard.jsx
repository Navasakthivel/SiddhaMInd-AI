import { useNavigate } from 'react-router-dom'
import { ChatCircleText, Flask } from '@phosphor-icons/react'
import { patientDashboard } from '../api/client'
import { useRequest } from '../components/ViewState'
import { Card, Advisory, Loading, ErrorNote, EmptyNote, toxicityColor } from '../components/ui'

/**
 * 17 Patient dashboard.
 *
 * The ingredient table is GET /api/patient/dashboard, which returns the
 * heavy-metal ingredients and their ceilings.
 *
 * maxDailyMg is the maximum PERMITTED daily dose of that ingredient, not an
 * amount anyone is taking. It is labelled "Ceiling" and shown as a bare figure
 * for that reason - rendered as a meter it would imply a measured dose the
 * engine does not have.
 */
export default function PatientDashboard() {
  const navigate = useNavigate()
  const req = useRequest(() => patientDashboard(), [], {
    isEmpty: (d) => !d?.heavyMetalIngredients?.length,
  })
  const rows = req.data?.heavyMetalIngredients ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 960 }}>
      <Advisory title="What this portal is for">
        Plain-language information about Siddha preparations, drawn from the classical texts.
        It does not diagnose you or recommend a treatment. Please speak to a registered Siddha
        practitioner before taking any preparation &mdash; especially one that contains a metal
        or mineral.
      </Advisory>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))',
        gap: 16,
      }}>
        <BigAction
          onClick={() => navigate('/assistant')}
          icon={<ChatCircleText size={28} style={{ color: 'var(--gold)' }} />}
          title="Ask the assistant"
          body="Ask in Tamil or English. Answers show the book and page they come from."
        />
        <BigAction
          onClick={() => navigate('/formulary')}
          delay=".1s"
          icon={<Flask size={28} style={{ color: 'var(--gold)' }} />}
          title="Browse the formulary"
          body="Read what each preparation is made of and where it is described."
        />
      </div>

      <Card>
        <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>
          Ingredients that need extra care
        </h2>
        <p style={{ margin: 0, color: 'var(--mu)', fontSize: 14 }}>
          These metals and minerals appear in some preparations. They are only safe when
          purified and given under supervision.
        </p>

        {req.state === 'loading' && <Loading rows={4} />}
        {req.state === 'error' && <ErrorNote message={req.error?.message} onRetry={req.reload} />}
        {req.state === 'empty' && (
          <EmptyNote
            title="No metal or mineral ingredients recorded"
            body="No preparation in this formulary lists one."
          />
        )}

        {req.state === 'ready' && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>Ingredient</th><th>Tamil</th><th>Metal</th>
                  <th>Toxicity class</th><th>Ceiling</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.ingredientId}>
                    <td style={{ fontWeight: 600, padding: '12px 6px' }}>{i.nameEnglish}</td>
                    <td style={{ fontFamily: 'var(--tamil)' }}>{i.nameTamil || '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{i.elementSymbol || '—'}</td>
                    <td style={{ fontWeight: 600, color: toxicityColor(i.toxicityClass) }}>
                      {i.toxicityClass || '—'}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--mu)' }}>
                      {i.maxDailyMg != null ? `${i.maxDailyMg} mg/day` : '—'}
                    </td>
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

function BigAction({ onClick, icon, title, body, delay = '0s' }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer',
        background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
        padding: 24, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 180,
        animation: 'smUp .5s ease both', animationDelay: delay,
        transition: 'transform .25s, box-shadow .25s, border-color .25s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px)'
        e.currentTarget.style.borderColor = 'var(--goldT2)'
        e.currentTarget.style.boxShadow = '0 14px 36px -14px var(--goldT2)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none'
        e.currentTarget.style.borderColor = 'var(--line)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {icon}
      <span style={{ fontFamily: 'var(--serif)', fontSize: 24 }}>{title}</span>
      <span style={{ color: 'var(--mu)', fontSize: 14 }}>{body}</span>
    </button>
  )
}
