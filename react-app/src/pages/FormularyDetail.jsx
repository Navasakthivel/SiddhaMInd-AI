import { useNavigate, useParams } from 'react-router-dom'
import { Atom, Prohibit, ShieldCheck, ArrowLeft } from '@phosphor-icons/react'
import { formularyDetail } from '../api/client'
import { useRequest } from '../components/ViewState'
import { Loading, ErrorNote, EmptyNote, toxicityColor, kutram } from '../components/ui'

/**
 * 19 Formulation detail.
 *
 * One request: GET /api/formulary/{id}. It returns the preparation, its
 * ingredients with sutthi notes, its contraindications and - added for this
 * screen - its indicated diseases. The indications come from their own query on
 * the server rather than from Formulation.indications, which is LAZY while
 * spring.jpa.open-in-view is false; walking it in the controller would throw
 * after the transaction closed.
 *
 * Every field below is printed only when the record carries it. The source
 * panel is the clearest case: a preparation whose page number was never
 * transcribed shows the book alone, not "p. null", and not a page borrowed from
 * a neighbouring row.
 */
export default function FormularyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const req = useRequest(() => formularyDetail(id), [id], { isEmpty: (d) => !d?.formId })

  if (req.state === 'loading') return <Loading rows={5} />
  if (req.state === 'error') {
    return <ErrorNote message={req.error?.message} onRetry={req.reload} />
  }
  if (req.state === 'empty') {
    return <EmptyNote title="No such preparation" body="This formulation id is not in the formulary." />
  }

  const f = req.data
  const ingredients = f.ingredients ?? []
  const contras = f.contraindications ?? []
  const indications = f.indications ?? []
  const ref = [
    f.pageNo == null ? null : `p. ${f.pageNo}`,
    f.verseNo ? `verse ${f.verseNo}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <button className="btn btn-ghost" onClick={() => navigate('/formulary')}
              style={{ alignSelf: 'flex-start', minHeight: 40 }}>
        <ArrowLeft size={16} /> All preparations
      </button>

      <section style={{
        background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
        padding: 'clamp(24px,3vw,40px)', display: 'flex', flexWrap: 'wrap', gap: 24,
        justifyContent: 'space-between', alignItems: 'flex-end',
        animation: 'smUp .45s ease both',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--gold)' }}>
              {f.sfiCode || '—'}
            </span>
            {f.dosageForm && (
              <span style={{
                fontSize: 12, padding: '2px 10px', borderRadius: 6,
                border: '1px solid var(--line2)', color: 'var(--mu)',
              }}>
                {f.dosageForm}
              </span>
            )}
            {f.containsHeavyMetal && (
              <span style={{
                fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                border: '1px solid var(--amb)', color: 'var(--amb)',
              }}>
                Heavy metal
              </span>
            )}
            {f.safetyClass === 'RED' && (
              <span style={{
                fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                background: 'var(--red)', color: 'var(--onGold)',
              }}>
                High risk
              </span>
            )}
          </div>
          <span style={{
            fontFamily: 'var(--tamil)', fontSize: 'clamp(32px,4vw,48px)', lineHeight: 1.35,
          }}>
            {f.nameTamil}
          </span>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 28 }}>{f.nameEnglish}</span>
        </div>

        {f.sourceBook && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 4, padding: 16, borderRadius: 12,
            border: '1px solid var(--goldT2)', minWidth: 260,
          }}>
            <span style={{ fontSize: 12, color: 'var(--mu)' }}>Source</span>
            <span style={{ fontWeight: 600 }}>{f.sourceBook}</span>
            {/* Omitted entirely when neither page nor verse was transcribed. */}
            {ref && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)' }}>
                {ref}
              </span>
            )}
          </div>
        )}
      </section>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))',
        gap: 24, alignItems: 'start',
      }}>
        <Panel title="Ingredients & sutthi" gap={8}>
          {ingredients.length === 0 ? (
            <Blank>No ingredient breakdown is recorded for this preparation.</Blank>
          ) : ingredients.map((i, idx) => (
            <div key={idx} style={{
              display: 'flex', gap: 16, padding: '12px 0', borderTop: '1px solid var(--line)',
              alignItems: 'flex-start',
            }}>
              <span style={{ fontFamily: 'var(--tamil)', fontSize: 17, minWidth: 120 }}>
                {i.nameTamil}
              </span>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{i.nameEnglish}</span>
                <span style={{ fontSize: 13, color: 'var(--mu)' }}>
                  {[i.quantity, i.sutthiNote].filter(Boolean).join(' · ') || 'No quantity recorded'}
                </span>
                {i.heavyMetal && i.maxDailyMg != null && (
                  <span style={{
                    fontSize: 12, fontFamily: 'var(--mono)',
                    color: toxicityColor(i.toxicityClass),
                  }}>
                    {/* The ceiling for the ingredient, not a dose anyone is taking. */}
                    {i.elementSymbol ? `${i.elementSymbol} · ` : ''}
                    max {i.maxDailyMg} mg/day
                    {i.toxicityClass ? ` · class ${i.toxicityClass}` : ''}
                  </span>
                )}
              </span>
              {i.heavyMetal && (
                <Atom size={18} aria-label="Heavy metal"
                      style={{ color: 'var(--amb)', flex: 'none', marginTop: 2 }} />
              )}
            </div>
          ))}
        </Panel>

        <section style={{
          background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
          padding: 24, display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 20,
        }}>
          <Field label="Dose" value={f.dose} mono />
          <Field label="Anupanam (vehicle)" value={f.anupanam} mono />
          <Field label="Shelf life" value={f.shelfLife} mono />
          <Field label="Dosage form" value={f.dosageForm} />
        </section>

        {f.preparationMethod && (
          <Panel title="Preparation">
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, textWrap: 'pretty' }}>
              {f.preparationMethod}
            </p>
          </Panel>
        )}

        <Panel title="Indicated diseases">
          {indications.length === 0 ? (
            <Blank>No noi is recorded against this preparation.</Blank>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {indications.map((n) => {
                const k = kutram(n.mukkutramType)
                return (
                  <button key={n.diseaseId} onClick={() => navigate(`/disease/${n.diseaseId}`)}
                          style={{
                            display: 'inline-flex', gap: 8, alignItems: 'center', minHeight: 44,
                            padding: '0 14px', borderRadius: 10, border: '1px solid var(--line2)',
                            background: 'none', color: 'var(--tx)', font: 'inherit', fontSize: 14,
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--gold)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line2)' }}>
                    <span style={{ fontFamily: 'var(--tamil)' }}>{n.noiTamil}</span>
                    {n.noiEnglish}
                    {n.modernEquivalent && (
                      <span style={{ color: 'var(--mu)', fontSize: 12 }}>{n.modernEquivalent}</span>
                    )}
                    {n.mukkutramType && (
                      <span style={{ color: k.c, fontSize: 12, fontWeight: 600 }}>
                        {n.mukkutramType}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </Panel>

        <Panel title="Contraindications" gap={12}>
          {contras.length === 0 ? (
            <Blank>
              No contraindication is recorded for this preparation. That is the absence
              of a record, not a clearance &mdash; run a check against the patient.
            </Blank>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {contras.map((c, idx) => (
                <span key={idx} title={c.note || undefined} style={{
                  display: 'inline-flex', gap: 6, alignItems: 'center', padding: '6px 12px',
                  borderRadius: 8, border: '1px solid var(--red)', color: 'var(--red)',
                  fontSize: 13, fontWeight: 600,
                }}>
                  <Prohibit size={15} /> {c.conditionName}
                  {c.severity && (
                    <span style={{ fontWeight: 400, opacity: 0.8 }}>&middot; {c.severity}</span>
                  )}
                </span>
              ))}
            </div>
          )}
          <button className="btn btn-primary"
                  onClick={() => navigate(`/safety-checker?formulation=${f.formId}`)}
                  style={{ minHeight: 44, alignSelf: 'flex-start', padding: '0 16px', marginTop: 8 }}>
            <ShieldCheck size={17} /> Run a safety check
          </button>
        </Panel>
      </div>
    </div>
  )
}

function Panel({ title, gap = 12, children }) {
  return (
    <section style={{
      background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
      padding: 24, display: 'flex', flexDirection: 'column', gap,
    }}>
      <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Field({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--mu)' }}>{label}</span>
      <span style={{ fontFamily: mono ? 'var(--mono)' : 'inherit', fontSize: 14 }}>
        {value || 'Not recorded'}
      </span>
    </div>
  )
}

function Blank({ children }) {
  return <span style={{ fontSize: 14, color: 'var(--mu)' }}>{children}</span>
}
