import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useReducedMotion } from 'framer-motion'
import { PencilSimple, ShieldCheck, CaretRight, Sparkle } from '@phosphor-icons/react'
import { Card, EmptyNote, kutram } from '../components/ui'

/**
 * 11 Diagnosis result.
 *
 * THE DIGITS ARE FINAL ON THE FIRST FRAME. THE RINGS MAY SWEEP.
 *
 * DiagnosisApiController's contract is that a dosha percentage renders as a
 * settled value: a percentage caught mid-count is a different reading of the
 * patient than the one the engine produced, and someone glancing at the screen
 * during a count-up reads a number that was never the answer.
 *
 * A ring is not a number. Sweeping stroke-dashoffset animates a shape into the
 * position it was always going to occupy, and the arc carries no readable
 * quantity of its own - the digits beside it do, and they are plain text with no
 * animation, no opacity gating and no delay. Under reduced motion the ring is
 * simply rendered at its final offset.
 *
 * Reload survival: the reading is written to sessionStorage on arrival, so a
 * refresh re-renders the same reading rather than an empty screen. It is the
 * server's own response, stored verbatim and never recomputed here.
 */
const KEY = 'siddhamind:lastReading'

/** Called by the intake screen the moment the server answers. */
export function rememberReading(result, patientName) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ result, patientName }))
  } catch {
    // Private mode or blocked storage. The reading still renders from router
    // state for this navigation; only surviving a reload is lost.
  }
}

function recallReading() {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const RING_GEOMETRY = [
  { key: 'vatham', name: 'Vatham', r: 92 },
  { key: 'pitham', name: 'Pitham', r: 72 },
  { key: 'kabam', name: 'Kabam', r: 52 },
]

export default function DiagnosisResults() {
  const location = useLocation()
  const navigate = useNavigate()
  const reduce = useReducedMotion()

  const [stored, setStored] = useState(() => location.state?.result ? null : recallReading())

  const result = location.state?.result ?? stored?.result ?? null
  const patientName = location.state?.patientName ?? stored?.patientName ?? null

  // Keep the store in step when arriving with fresh router state.
  useEffect(() => {
    if (location.state?.result) {
      rememberReading(location.state.result, location.state.patientName)
      setStored(null)
    }
  }, [location.state])

  if (!result) {
    return (
      <EmptyNote
        title="No reading to show"
        body="A reading appears here once an examination is recorded and scored."
        action={
          <Link className="btn btn-primary" to="/diagnosis-intake"
                style={{ alignSelf: 'flex-start', minHeight: 44, padding: '0 18px' }}>
            Record an examination
          </Link>
        }
      />
    )
  }

  const rings = RING_GEOMETRY.map((g) => {
    const raw = Number(result[g.key])
    const pct = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0
    const k = kutram(g.name)
    return { ...g, pct, c: k.c, ta: k.ta, el: k.el }
  })

  const dominantName = result.dominantKutram
    ? result.dominantKutram.charAt(0) + result.dominantKutram.slice(1).toLowerCase()
    : '—'
  const dom = rings.find((r) => r.name.toUpperCase() === (result.dominantKutram ?? '').toUpperCase())
    ?? { ...kutram(result.dominantKutram), name: dominantName, pct: 0 }

  const candidates = result.candidateDiseases ?? []
  const preps = result.suggestedFormulations ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {patientName && (
        <span style={{ fontSize: 13, color: 'var(--mu)' }}>
          Reading for <strong style={{ color: 'var(--tx)', fontWeight: 600 }}>{patientName}</strong>
        </span>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,400px),1fr))',
        gap: 24,
      }}>
        <Card style={{
          flexDirection: 'row', flexWrap: 'wrap', gap: 24, alignItems: 'center',
        }}>
          <div style={{ position: 'relative', width: 220, height: 220, flex: 'none', margin: '0 auto' }}>
            <svg viewBox="0 0 220 220" width="220" height="220" fill="none" aria-hidden="true">
              {RING_GEOMETRY.map((g) => (
                <circle key={`t${g.r}`} cx="110" cy="110" r={g.r} stroke="var(--line)" strokeWidth="10" />
              ))}
              {rings.map((g) => {
                const offset = 100 - g.pct
                return (
                  <circle
                    key={g.key} cx="110" cy="110" r={g.r} pathLength="100"
                    stroke={g.c} strokeWidth="10" strokeLinecap="round"
                    strokeDasharray="100" strokeDashoffset={offset}
                    transform="rotate(-90 110 110)"
                    /* smRing animates FROM stroke-dashoffset:100 (empty) to the
                       inline value. Under reduced motion no animation is applied,
                       so the ring paints at its final offset on the first frame. */
                    style={reduce ? undefined : { animation: 'smRing 1.4s cubic-bezier(.3,.7,.2,1) both' }}
                  />
                )
              })}
            </svg>
            <div style={{
              position: 'absolute', inset: 0, display: 'grid',
              placeItems: 'center', textAlign: 'center', pointerEvents: 'none',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontFamily: 'var(--tamil)', fontSize: 18, color: dom.c }}>{dom.ta}</span>
                <span style={{
                  fontSize: 11, color: 'var(--mu)', letterSpacing: '.1em', textTransform: 'uppercase',
                }}>
                  Dominant
                </span>
              </div>
            </div>
          </div>

          <div style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>
              Dosha balance
            </h2>
            {rings.map((g) => (
              <div key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: g.c, flex: 'none' }} />
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    {g.name}{' '}
                    <span style={{ fontFamily: 'var(--tamil)', fontWeight: 400, color: 'var(--mu)' }}>{g.ta}</span>
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--mu)' }}>{g.el}</span>
                </span>
                {/* Plain text. No animation, no opacity, no delay - see the note
                    at the top of this file. */}
                <span style={{ fontFamily: 'var(--mono)', fontSize: 20 }}>{g.pct}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card style={{ gap: 12, justifyContent: 'center' }}>
          <span style={{
            fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--mu)',
          }}>
            Dominant kutram
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--tamil)', fontSize: 48, lineHeight: 1.2, color: dom.c }}>
              {dom.ta}
            </span>
            <span style={{ fontFamily: 'var(--serif)', fontSize: 32 }}>{dominantName}</span>
          </div>
          <span style={{ color: 'var(--mu)' }}>
            {dom.el} &middot; <span style={{ fontFamily: 'var(--mono)' }}>{dom.pct}%</span>{' '}
            of the weighted examination score
          </span>
          {result.predictedDisease && (
            <span style={{ color: 'var(--mu)' }}>
              Predicted noi: <strong style={{ color: 'var(--tx)', fontWeight: 600 }}>
                {result.predictedDisease}
              </strong>
            </span>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button className="btn btn-secondary" onClick={() => navigate('/diagnosis-intake')}
                    style={{ minHeight: 44, padding: '0 16px' }}>
              <PencilSimple size={16} /> Edit findings
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/safety-checker')}
                    style={{ minHeight: 44, padding: '0 16px' }}>
              <ShieldCheck size={16} /> Check a preparation
            </button>
          </div>
        </Card>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))',
        gap: 24, alignItems: 'start',
      }}>
        <Card style={{ gap: 8 }}>
          <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: '0 0 8px' }}>
            Candidate noi, ranked
          </h2>
          {candidates.length === 0 ? (
            <span style={{ color: 'var(--mu)', fontSize: 14 }}>
              No noi in the record matches this constitution.
            </span>
          ) : candidates.map((c, i) => {
            const k = kutram(c.mukkutramType)
            return (
              <button
                key={c.diseaseId} onClick={() => navigate(`/disease/${c.diseaseId}`)}
                style={{
                  display: 'flex', gap: 16, alignItems: 'flex-start', padding: '16px 0',
                  border: 0, borderTop: '1px solid var(--line)', background: 'none',
                  color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer',
                }}
              >
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--gold)', paddingTop: 4, flex: 'none',
                }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--tamil)', fontSize: 19 }}>{c.noiTamil}</span>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: 18 }}>{c.noiEnglish}</span>
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--mu)' }}>
                    Modern equivalent: {c.modernEquivalent || '—'}
                  </span>
                </span>
                {c.mukkutramType && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                    border: `1px solid ${k.c}`, color: k.c, flex: 'none',
                  }}>
                    {c.mukkutramType}
                  </span>
                )}
              </button>
            )
          })}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Card style={{ gap: 8 }}>
            <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: '0 0 8px' }}>
              Classically indicated preparations
            </h2>
            {preps.length === 0 ? (
              <span style={{ color: 'var(--mu)', fontSize: 14 }}>
                No preparation is recorded as indicated for these candidates.
              </span>
            ) : preps.map((p) => (
              <button
                key={p.formId} onClick={() => navigate(`/formulary/${p.formId}`)}
                style={{
                  display: 'flex', gap: 16, alignItems: 'center', padding: '12px 0',
                  border: 0, borderTop: '1px solid var(--line)', background: 'none',
                  color: 'inherit', font: 'inherit', textAlign: 'left',
                  cursor: 'pointer', minHeight: 56,
                }}
              >
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>
                    {p.nameEnglish}{' '}
                    <span style={{ fontFamily: 'var(--tamil)', fontWeight: 400, color: 'var(--mu)' }}>
                      {p.nameTamil}
                    </span>
                  </span>
                  {p.safetyClass && (
                    <span style={{ fontSize: 12, color: 'var(--mu)' }}>
                      Safety class <span style={{ fontFamily: 'var(--mono)' }}>{p.safetyClass}</span>
                    </span>
                  )}
                </span>
                {p.containsHeavyMetal && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                    border: '1px solid var(--amb)', color: 'var(--amb)', flex: 'none',
                  }}>
                    Heavy metal
                  </span>
                )}
                <CaretRight size={16} style={{ color: 'var(--mu)', flex: 'none' }} />
              </button>
            ))}
          </Card>

          <section style={{
            border: '1px solid var(--goldT2)', background: 'var(--goldT)', borderRadius: 14,
            padding: 24, display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
              letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--gold)',
            }}>
              <Sparkle size={14} /> AI summary
            </div>
            <p style={{ margin: 0, fontSize: 15, textWrap: 'pretty' }}>
              {result.aiSummary
                ? result.aiSummary
                : 'No written summary was returned. The reading above was computed by the rule '
                  + 'engine before any summary was requested and does not depend on one.'}
            </p>
            <span style={{ fontSize: 12, color: 'var(--mu)' }}>
              Rules decided the scores and ranking above. This summary cannot change them.
            </span>
          </section>
        </div>
      </div>
    </div>
  )
}
