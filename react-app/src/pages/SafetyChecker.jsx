import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, X, ArrowsLeftRight, Prohibit, Atom,
} from '@phosphor-icons/react'
import { safetyOptions, runSafetyCheck, toVerdict } from '../api/client'
import { useRequest } from '../components/ViewState'
import { Card, Loading, ErrorNote } from '../components/ui'
import { useToast } from '../components/Toast'
import { rememberVerdict } from './SafetyResult'

/**
 * 13 Safety checker.
 *
 * Both lists come from GET /api/safety/options: the formulations the engine can
 * screen, and the condition names that actually appear in the contraindication
 * table. The condition chips are NOT a local list - a condition the server has
 * never heard of would simply never match a rule, and the screen would look like
 * it had checked something it had not.
 *
 * Drugs are free text by design. The engine matches them against the drug
 * register and returns whatever it could not find as `unmatchedDrugs`, which the
 * result screen shows: "not screened" is a real answer and must not be hidden
 * behind a closed dropdown that makes the list look exhaustive.
 */
export default function SafetyChecker() {
  const navigate = useNavigate()
  const toast = useToast()
  const opts = useRequest(() => safetyOptions(), [], { isEmpty: (d) => !d?.formulations?.length })

  const [formId, setFormId] = useState('')
  const [drugs, setDrugs] = useState([])
  const [drugIn, setDrugIn] = useState('')
  const [conds, setConds] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const formulations = opts.data?.formulations ?? []
  const conditions = opts.data?.conditions ?? []
  const selected = useMemo(
    () => formulations.find((f) => String(f.formId) === String(formId)) ?? null,
    [formulations, formId],
  )

  const addDrug = (name) => {
    const v = name.trim()
    if (!v) return
    setDrugs((d) => (d.some((x) => x.toLowerCase() === v.toLowerCase()) ? d : [...d, v]))
    setDrugIn('')
  }
  const onDrugKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addDrug(drugIn) }
    else if (e.key === 'Backspace' && !drugIn && drugs.length) setDrugs((d) => d.slice(0, -1))
  }
  const toggleCond = (c) =>
    setConds((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!formId) { setError('Choose a preparation to screen.'); return }

    setBusy(true)
    try {
      // Any text still in the box counts: losing it because it was not
      // committed with Enter would silently drop a drug from the check.
      const allDrugs = drugIn.trim() ? [...drugs, drugIn.trim()] : drugs
      const report = await runSafetyCheck({
        formId: Number(formId),
        drugs: allDrugs.join(', '),
        conditions: conds,
      })
      const verdict = toVerdict(report)
      rememberVerdict(verdict, report)
      toast.success('Safety check complete')
      navigate('/safety-result', { state: { verdict, report } })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  if (opts.state === 'loading') return <Loading rows={6} />
  if (opts.state === 'error') return <ErrorNote message={opts.error?.message} onRetry={opts.reload} />

  return (
    <form onSubmit={onSubmit} style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))',
      gap: 24, alignItems: 'start',
    }}>
      <Card style={{ gap: 24 }}>
        <div className="field">
          <label htmlFor="sf-form">Formulation</label>
          <select id="sf-form" className="input" value={formId}
                  onChange={(e) => setFormId(e.target.value)} style={{ minHeight: 48 }}>
            <option value="">Select a preparation</option>
            {formulations.map((f) => (
              <option key={f.formId} value={f.formId}>{f.nameEnglish}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="sf-drug">Concurrent allopathic drugs</label>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
            minHeight: 48, padding: '6px 8px', border: '1px solid var(--line2)',
            borderRadius: 8, background: 'var(--s2)',
          }}>
            {drugs.map((d) => (
              <span key={d} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 4px 4px 12px', borderRadius: 999,
                background: 'var(--goldT)', border: '1px solid var(--goldT2)',
                fontSize: 13, fontWeight: 600,
              }}>
                {d}
                <button type="button" aria-label={`Remove ${d}`}
                        onClick={() => setDrugs((s) => s.filter((x) => x !== d))}
                        style={{
                          width: 28, height: 28, borderRadius: '50%', border: 0,
                          background: 'none', color: 'var(--mu)', cursor: 'pointer',
                          display: 'grid', placeItems: 'center',
                        }}>
                  <X size={12} />
                </button>
              </span>
            ))}
            <input
              id="sf-drug" value={drugIn}
              onChange={(e) => setDrugIn(e.target.value)} onKeyDown={onDrugKey}
              placeholder="Type a drug and press Enter"
              style={{
                flex: 1, minWidth: 160, minHeight: 36, border: 0, outline: 0,
                background: 'none', color: 'var(--tx)', font: 'inherit', fontSize: 14,
              }}
            />
          </div>
          <span style={{ fontSize: 12, color: 'var(--mu)', marginTop: 8, display: 'block' }}>
            Anything the drug register does not recognise is reported back as unscreened,
            never silently dropped.
          </span>
        </div>

        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend style={{ fontSize: 12, color: 'var(--mu)', marginBottom: 8 }}>
            Patient conditions
          </legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {conditions.map((c) => {
              const on = conds.includes(c)
              return (
                <button key={c} type="button" aria-pressed={on} onClick={() => toggleCond(c)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44,
                          padding: '0 14px', borderRadius: 10, font: 'inherit', fontSize: 14,
                          cursor: 'pointer',
                          background: on ? 'var(--goldT)' : 'transparent',
                          border: `1px solid ${on ? 'var(--gold)' : 'var(--line2)'}`,
                          color: on ? 'var(--gold)' : 'var(--mu)',
                        }}>
                  {c}
                </button>
              )
            })}
          </div>
        </fieldset>

        {error && (
          <p role="alert" style={{
            margin: 0, color: 'var(--red)', fontSize: 14,
            border: '1px solid var(--redT)', background: 'var(--redT)',
            borderRadius: 10, padding: '12px 14px',
          }}>
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={busy}
                style={{ minHeight: 52, fontSize: 16 }}>
          <ShieldCheck size={18} /> {busy ? 'Running check…' : 'Run check'}
        </button>
      </Card>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card style={{ gap: 8 }}>
          <span style={{
            fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--mu)',
          }}>
            Selected formulation
          </span>
          {selected ? (
            <>
              {selected.nameTamil && (
                <span style={{ fontFamily: 'var(--tamil)', fontSize: 22 }}>{selected.nameTamil}</span>
              )}
              <span style={{ fontFamily: 'var(--serif)', fontSize: 22 }}>{selected.nameEnglish}</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {selected.safetyClass && (
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)' }}>
                    Safety class {selected.safetyClass}
                  </span>
                )}
                {selected.containsHeavyMetal && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                    border: '1px solid var(--amb)', color: 'var(--amb)',
                  }}>
                    Heavy metal
                  </span>
                )}
              </div>
            </>
          ) : (
            <span style={{ color: 'var(--mu)', fontSize: 14 }}>
              Nothing chosen yet. Pick a preparation to see what the rules will screen.
            </span>
          )}
        </Card>

        <section style={{
          border: '1px solid var(--line)', borderRadius: 14, padding: 24,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 18 }}>What the rules check</span>
          {[
            [<ArrowsLeftRight key="a" size={16} />, 'Herb–drug and mineral–drug interactions'],
            [<Prohibit key="b" size={16} />, 'Contraindications recorded for the formulation'],
            [<Atom key="c" size={16} />, 'Heavy-metal content against the record’s daily ceiling'],
          ].map(([icon, text]) => (
            <span key={text} style={{ display: 'flex', gap: 12, fontSize: 14, color: 'var(--mu)' }}>
              <span style={{ color: 'var(--gold)', marginTop: 3, flex: 'none' }}>{icon}</span>{text}
            </span>
          ))}
        </section>
      </aside>
    </form>
  )
}
