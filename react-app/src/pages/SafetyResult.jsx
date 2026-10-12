import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useReducedMotion } from 'framer-motion'
import {
  ArrowCounterClockwise, ArrowBendDownRight, Sparkle, Check,
  Warning, WarningOctagon, ShieldCheck as ShieldOk,
} from '@phosphor-icons/react'
import { Card, EmptyNote } from '../components/ui'

/**
 * 14 Safety result.
 *
 * CONSTRAINT 1: the verdict renders at full opacity on the first frame.
 *
 * The banner is allowed to arrive - scale only, transform-class motion - because
 * a verdict landing with a little weight reads as deliberate. What is NOT allowed
 * is any part of its content being gated: the risk word, the headline, the
 * preparation name and every finding below are plain children with no animation
 * of their own. Animating opacity here would mean a practitioner glancing at the
 * screen mid-transition sees a half-visible HIGH RISK, which is precisely the
 * failure the motion contract exists to prevent.
 *
 * THE HEAVY-METAL TRACK IS DELIBERATELY UNFILLED. The engine reports the summed
 * maximum PERMITTED daily dose of each heavy-metal ingredient. It has no measured
 * content: elemental yield after sutthi and pudam is not derivable from free-text
 * formulary quantities, and SiddhaMind has no batch assay. Drawing a fill would
 * invent the numerator of a clinical comparison. The track is dashed, the ceiling
 * is marked at its end, and the caption says why.
 */
const KEY = 'siddhamind:lastVerdict'

export function rememberVerdict(verdict, report) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ verdict, report }))
  } catch {
    // Blocked storage only costs reload survival, not this navigation.
  }
}

function recallVerdict() {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const RISK = {
  high: { word: 'HIGH RISK', c: 'var(--red)', bg: 'var(--redT)', Icon: WarningOctagon,
          note: 'Do not dispense', body: 'A major rule fired. Review the findings before any decision.' },
  elevated: { word: 'ELEVATED', c: 'var(--amb)', bg: 'var(--ambT)', Icon: Warning,
              note: 'Dispense with caution', body: 'A rule fired that needs a judgement call.' },
  normal: { word: 'NORMAL', c: 'var(--jade)', bg: 'var(--jadeT)', Icon: ShieldOk,
            note: 'No rule matched', body: 'Absence of a rule is not evidence of absence of risk.' },
}

const SEVERITY_COLOR = {
  MAJOR: 'var(--red)', MODERATE: 'var(--amb)', MINOR: 'var(--jade)',
}

export default function SafetyResult() {
  const location = useLocation()
  const navigate = useNavigate()
  const reduce = useReducedMotion()

  const [stored, setStored] = useState(() => (location.state?.verdict ? null : recallVerdict()))
  const verdict = location.state?.verdict ?? stored?.verdict ?? null
  const report = location.state?.report ?? stored?.report ?? null

  useEffect(() => {
    if (location.state?.verdict) {
      rememberVerdict(location.state.verdict, location.state.report)
      setStored(null)
    }
  }, [location.state])

  if (!verdict) {
    return (
      <EmptyNote
        title="No verdict to show"
        body="A verdict appears here once a check has been run."
        action={
          <Link className="btn btn-primary" to="/safety-checker"
                style={{ alignSelf: 'flex-start', minHeight: 44, padding: '0 18px' }}>
            Run a safety check
          </Link>
        }
      />
    )
  }

  const risk = RISK[verdict.risk] ?? RISK.normal
  const { Icon } = risk
  const rules = verdict.rules ?? []
  const unmatched = verdict.unmatchedDrugs ?? []
  const ceiling = report?.heavyMetalDailyLimitMg ?? 0
  const hasHm = ceiling > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* CONSTRAINT 1: scale only. No opacity anywhere in this banner. */}
      <section style={{
        border: `1.5px solid ${risk.c}`, background: risk.bg, borderRadius: 16,
        padding: 'clamp(24px,3vw,40px)', display: 'flex', flexWrap: 'wrap',
        gap: 32, alignItems: 'center',
        transformOrigin: 'left center',
        animation: reduce ? undefined : 'smScale .5s cubic-bezier(.3,.7,.2,1) both',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: '1 1 360px' }}>
          <span style={{
            alignSelf: 'flex-start', fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 500,
            letterSpacing: '.1em', padding: '6px 14px', borderRadius: 8,
            background: risk.c, color: 'var(--onGold)',
          }}>
            {risk.word}
          </span>
          <h2 style={{
            fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 'clamp(36px,4vw,52px)',
            margin: 0, letterSpacing: '-.02em', color: risk.c,
          }}>
            {verdict.dispenseNote}
          </h2>
          <span style={{ fontSize: 15 }}>
            <strong style={{ fontWeight: 600 }}>{verdict.preparation}</strong>
          </span>
          <span style={{ fontSize: 14, color: 'var(--mu)' }}>
            Drugs: {report?.drugsEntered?.trim() || 'none given'} &middot;{' '}
            Conditions: {report?.conditionsEntered?.trim() || 'none given'}
          </span>
        </div>
        <div style={{
          flex: '1 1 280px', display: 'flex', gap: 16, alignItems: 'flex-start',
          padding: 20, borderRadius: 12, border: `1px solid ${risk.c}`, background: 'var(--bg)',
        }}>
          <Icon size={28} style={{ color: risk.c, flex: 'none' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: 'var(--serif)', fontSize: 22, color: risk.c }}>{risk.note}</span>
            <span style={{ fontSize: 14, color: 'var(--mu)' }}>{risk.body}</span>
          </div>
        </div>
      </section>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,440px),1fr))',
        gap: 24, alignItems: 'start',
      }}>
        <Card style={{ gap: 8 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'baseline', marginBottom: 8,
          }}>
            <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>
              Findings
            </h2>
            <span style={{ fontSize: 13, color: 'var(--mu)' }}>
              {rules.length} {rules.length === 1 ? 'finding' : 'findings'}
            </span>
          </div>
          {rules.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--mu)' }}>
              No rule matched these inputs. This is not a guarantee of safety &mdash; absence of
              a rule is not evidence of absence of risk.
            </p>
          ) : rules.map((f) => {
            const sc = SEVERITY_COLOR[f.severity] ?? 'var(--mu)'
            return (
              <article key={f.id} style={{
                display: 'flex', gap: 16, padding: '16px 0', borderTop: '1px solid var(--line)',
              }}>
                <span style={{
                  width: 40, height: 40, flex: 'none', borderRadius: 10, display: 'grid',
                  placeItems: 'center', border: `1px solid ${sc}`, color: sc,
                }}>
                  <Warning size={19} />
                </span>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', gap: 12,
                    alignItems: 'baseline', flexWrap: 'wrap',
                  }}>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{
                        fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--mu)',
                      }}>
                        {f.id.split('-')[0]}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: 16 }}>{f.name}</span>
                    </span>
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, padding: '3px 8px',
                      borderRadius: 6, border: `1px solid ${sc}`, color: sc,
                    }}>
                      {f.severity}
                    </span>
                  </div>
                  <span style={{ fontSize: 14 }}>{f.note}</span>
                  {f.advice && (
                    <span style={{ fontSize: 14, color: 'var(--mu)', display: 'flex', gap: 8 }}>
                      <ArrowBendDownRight size={14} style={{ marginTop: 3, color: 'var(--gold)', flex: 'none' }} />
                      {f.advice}
                    </span>
                  )}
                </div>
              </article>
            )
          })}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {hasHm && (
            <Card style={{ gap: 16 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', gap: 12,
                flexWrap: 'wrap', alignItems: 'baseline',
              }}>
                <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>
                  Heavy-metal daily ceiling
                </h2>
              </div>
              <div style={{ position: 'relative', paddingTop: 28 }}>
                <span style={{
                  position: 'absolute', right: 0, top: 0, fontFamily: 'var(--mono)',
                  fontSize: 12, color: 'var(--tx)',
                }}>
                  Ceiling &middot; {ceiling} mg/day
                </span>
                {/* Dashed and EMPTY. There is no measured value to fill it with. */}
                <div role="img"
                     aria-label={`No measured value. The ceiling of ${ceiling} milligrams per day is marked at the end of the track.`}
                     style={{
                       height: 12, borderRadius: 6, border: '1px dashed var(--line2)', position: 'relative',
                     }}>
                  <span style={{
                    position: 'absolute', right: -1, top: -8, bottom: -8,
                    width: 2, background: 'var(--amb)',
                  }} />
                </div>
              </div>
              <span style={{ fontSize: 13, color: 'var(--mu)' }}>
                No measured value is shown &mdash; SiddhaMind does not have a batch assay. The
                ceiling is the sum of the maximum permitted daily dose of each heavy-metal
                ingredient, taken from the formulation record.
              </span>
            </Card>
          )}

          <Card style={{ gap: 12 }}>
            <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>
              Unmatched drugs
            </h2>
            {unmatched.length === 0 ? (
              <span style={{ fontSize: 14, color: 'var(--mu)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <Check size={16} style={{ color: 'var(--jade)' }} />
                Every drug you entered was found in the interaction tables.
              </span>
            ) : (
              <>
                <span style={{ fontSize: 14, color: 'var(--mu)' }}>
                  These were not found, so no rule could be checked for them:
                </span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {unmatched.map((u) => (
                    <span key={u} style={{
                      fontSize: 13, padding: '4px 10px', borderRadius: 999,
                      border: '1px dashed var(--amb)', color: 'var(--amb)',
                    }}>
                      {u}
                    </span>
                  ))}
                </div>
              </>
            )}
          </Card>

          <section style={{
            border: '1px solid var(--goldT2)', background: 'var(--goldT)', borderRadius: 14,
            padding: 24, display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
              letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--gold)',
            }}>
              <Sparkle size={14} /> AI explanation
            </div>
            <p style={{ margin: 0, textWrap: 'pretty' }}>
              {verdict.explanation?.body
                ? verdict.explanation.body
                : 'The explainer returned no text. The verdict above was computed by the rule '
                  + 'engine before any explanation was requested and does not depend on one.'}
            </p>
          </section>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => navigate('/safety-checker')}
                    style={{ minHeight: 44, padding: '0 16px' }}>
              <ArrowCounterClockwise size={16} /> Edit inputs
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/formulary')}
                    style={{ minHeight: 44, padding: '0 12px' }}>
              Open formulary
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
