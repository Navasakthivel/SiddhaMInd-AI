import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CaretRight, ChatCircleText } from '@phosphor-icons/react'
import { diseaseDetail } from '../api/client'
import { useRequest } from '../components/ViewState'
import { Card, Loading, ErrorNote, EmptyNote, kutram } from '../components/ui'

/**
 * 16c Disease detail.
 *
 * GET /api/formulary/diseases/{id} returns the disease plus the preparations
 * classically indicated for it, so this screen makes exactly one request.
 *
 * The citation under each preparation is real: the endpoint now returns
 * sourceBook and pageNo alongside the SFI code, so "code · book · p. N" is
 * assembled from the record. Any part the record does not have is omitted rather
 * than filled with a placeholder.
 */
export default function DiseaseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const req = useRequest(() => diseaseDetail(id), [id], { isEmpty: (d) => !d })

  if (req.state === 'loading') return <Loading rows={5} />
  if (req.state === 'error') {
    return <ErrorNote message={req.error?.message} onRetry={req.reload} />
  }
  if (req.state === 'empty' || !req.data) {
    return (
      <EmptyNote
        title="No such disease"
        body="Nothing is recorded under that id."
        action={
          <button className="btn btn-secondary" onClick={() => navigate('/diseases')}
                  style={{ alignSelf: 'flex-start', minHeight: 44, padding: '0 16px' }}>
            All diseases
          </button>
        }
      />
    )
  }

  const noi = req.data
  const k = kutram(noi.mukkutramType)
  const forms = noi.formulations ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section style={{
        background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
        padding: 'clamp(24px,3vw,40px)', display: 'flex', flexDirection: 'column', gap: 12,
        animation: 'smUp .4s ease both',
      }}>
        {noi.mukkutramType && (
          <span style={{
            alignSelf: 'flex-start', fontSize: 12, fontWeight: 600, padding: '3px 10px',
            borderRadius: 6, border: `1px solid ${k.c}`, color: k.c,
          }}>
            {noi.mukkutramType}{k.el ? ` · ${k.el}` : ''}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--tamil)', fontSize: 'clamp(34px,4vw,48px)', lineHeight: 1.3 }}>
            {noi.noiTamil}
          </span>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 32 }}>{noi.noiEnglish}</span>
        </div>
        <span style={{ color: 'var(--mu)' }}>
          Modern equivalent: <span style={{ color: 'var(--tx)' }}>{noi.modernEquivalent || '—'}</span>
        </span>
        {noi.description && (
          <p style={{ margin: '8px 0 0', maxWidth: 680, textWrap: 'pretty' }}>{noi.description}</p>
        )}
      </section>

      <Card>
        <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: '0 0 8px' }}>
          Classically indicated preparations
        </h2>
        {forms.length === 0 ? (
          <span style={{ color: 'var(--mu)', fontSize: 14 }}>
            No preparation in this formulary is recorded as indicated for this noi.
          </span>
        ) : forms.map((f) => (
          <button
            key={f.formId}
            onClick={() => navigate(`/formulary/${f.formId}`)}
            style={{
              display: 'flex', gap: 16, alignItems: 'center', padding: '12px 0',
              border: 0, borderTop: '1px solid var(--line)', background: 'none',
              color: 'inherit', font: 'inherit', textAlign: 'left',
              cursor: 'pointer', minHeight: 56,
            }}
          >
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontWeight: 600 }}>
                {f.nameEnglish}{' '}
                <span style={{ fontFamily: 'var(--tamil)', fontWeight: 400, color: 'var(--mu)' }}>
                  {f.nameTamil}
                </span>
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)' }}>
                {[
                  f.sfiCode,
                  f.sourceBook,
                  f.pageNo != null ? `p. ${f.pageNo}` : null,
                ].filter(Boolean).join(' · ')}
              </span>
            </span>
            {f.containsHeavyMetal && (
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                border: '1px solid var(--amb)', color: 'var(--amb)', flex: 'none',
              }}>
                heavy metal
              </span>
            )}
            <CaretRight size={16} style={{ color: 'var(--mu)', flex: 'none' }} />
          </button>
        ))}
      </Card>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" onClick={() => navigate('/diseases')}
                style={{ minHeight: 44, padding: '0 16px' }}>
          <ArrowLeft size={16} /> All diseases
        </button>
        <button className="btn btn-primary" onClick={() => navigate('/assistant')}
                style={{ minHeight: 44, padding: '0 16px' }}>
          <ChatCircleText size={16} /> Ask the assistant
        </button>
      </div>
    </div>
  )
}
