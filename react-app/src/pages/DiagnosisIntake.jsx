import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  WaveSine, Smiley, Palette, SpeakerHigh, Eye, Hand, DropHalf, Drop,
  ArrowRight, Scales,
} from '@phosphor-icons/react'
import { diagnosisOptions, computeDoshaReading } from '../api/client'
import { useRequest } from '../components/ViewState'
import { Card, Loading, ErrorNote } from '../components/ui'
import { useToast } from '../components/Toast'
import { rememberReading } from './DiagnosisResults'

/**
 * 10 Diagnosis intake.
 *
 * THE OPTION STRINGS ARE THE SERVER'S. Every chip label comes verbatim from
 * GET /api/diagnosis/options, which DiagnosisService derives from the same
 * SCORING table it later scores against. Hardcoding them here would let the two
 * drift: the service logs "Unrecognised {} value" and scores the finding as
 * zero, so a typo in a label would silently produce a different reading rather
 * than an error.
 *
 * The eight keys and their order are fixed by the examination itself; only the
 * labels, Tamil names and icons are local, and none of those is sent.
 */
const EXAMS = [
  { key: 'naadi', en: 'Naadi', ta: 'நாடி', hint: 'Pulse', icon: WaveSine },
  { key: 'naa', en: 'Naa', ta: 'நா', hint: 'Tongue', icon: Smiley },
  { key: 'niram', en: 'Niram', ta: 'நிறம்', hint: 'Complexion', icon: Palette },
  { key: 'mozhi', en: 'Mozhi', ta: 'மொழி', hint: 'Voice', icon: SpeakerHigh },
  { key: 'vizhi', en: 'Vizhi', ta: 'விழி', hint: 'Eyes', icon: Eye },
  { key: 'sparisam', en: 'Sparisam', ta: 'ஸ்பரிசம்', hint: 'Touch', icon: Hand },
  { key: 'malam', en: 'Malam', ta: 'மலம்', hint: 'Stool', icon: DropHalf },
  { key: 'moothiram', en: 'Moothiram', ta: 'மூத்திரம்', hint: 'Urine', icon: Drop },
]

export default function DiagnosisIntake() {
  const navigate = useNavigate()
  const toast = useToast()
  const opts = useRequest(() => diagnosisOptions(), [], { isEmpty: (d) => !d || !Object.keys(d).length })

  const [pt, setPt] = useState({ name: '', age: '', gender: 'Female', complaint: '' })
  const [exam, setExam] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const recorded = useMemo(() => EXAMS.filter((e) => exam[e.key]).length, [exam])
  const setField = (k) => (e) => setPt((p) => ({ ...p, [k]: e.target.value }))

  // Tap again to clear, as the prototype says. A cleared finding is not the same
  // as "Normal" - the engine needs all eight, so clearing must block submit.
  const pick = (key, value) =>
    setExam((s) => ({ ...s, [key]: s[key] === value ? undefined : value }))

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!pt.name.trim()) {
      setError('Enter the patient name before computing a reading.')
      return
    }
    const missing = EXAMS.filter((x) => !exam[x.key]).map((x) => x.en)
    if (missing.length) {
      setError(`All eight examinations are weighted together. Still to record: ${missing.join(', ')}.`)
      return
    }

    setBusy(true)
    try {
      const result = await computeDoshaReading({
        patientName: pt.name,
        age: pt.age ? Number(pt.age) : null,
        gender: pt.gender,
        complaint: pt.complaint,
        examination: exam,
      })
      rememberReading(result, pt.name)
      toast.success('Examination scored')
      navigate('/diagnosis-results', { state: { result, patientName: pt.name } })
    } catch (err) {
      setError(err.body?.missing
        ? `The server rejected the examination as incomplete: ${err.body.missing.join(', ')}.`
        : err.message)
      setBusy(false)
    }
  }

  if (opts.state === 'loading') return <Loading rows={6} />
  if (opts.state === 'error') return <ErrorNote message={opts.error?.message} onRetry={opts.reload} />
  if (opts.state === 'empty') {
    return <ErrorNote message="The server returned no permitted values for the eight-fold examination." />
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Card style={{ gap: 20 }}>
        <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>Patient</h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))',
          gap: 16,
        }}>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="pt-name">Patient name</label>
            <input id="pt-name" className="input" value={pt.name} onChange={setField('name')}
                   placeholder="Full name" style={{ minHeight: 48 }} />
          </div>
          <div className="field">
            <label htmlFor="pt-age">Age</label>
            <input id="pt-age" className="input" inputMode="numeric" value={pt.age}
                   onChange={setField('age')} style={{ minHeight: 48 }} />
          </div>
          <div className="field">
            <label htmlFor="pt-g">Gender</label>
            <select id="pt-g" className="input" value={pt.gender} onChange={setField('gender')}
                    style={{ minHeight: 48 }}>
              <option>Female</option><option>Male</option><option>Other</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="pt-c">Chief complaint</label>
          <textarea id="pt-c" className="input" value={pt.complaint} onChange={setField('complaint')}
                    style={{ minHeight: 80 }} />
        </div>
      </Card>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 24, margin: 0 }}>
            Eight examinations{' '}
            <span style={{ fontFamily: 'var(--tamil)', fontSize: 18, color: 'var(--mu)' }}>
              எண்வகைத் தேர்வு
            </span>
          </h2>
          <span style={{ fontSize: 13, color: 'var(--mu)' }}>
            Pick one finding per examination. Tap again to clear.
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 220 }}>
          <span style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
            <span style={{
              display: 'block', height: '100%', background: 'var(--gold)',
              transition: 'width .4s', width: `${(recorded / EXAMS.length) * 100}%`,
            }} />
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{recorded}/8 recorded</span>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,280px),1fr))',
        gap: 16,
      }}>
        {EXAMS.map((e, i) => {
          const Icon = e.icon
          const choices = opts.data?.[e.key] ?? []
          return (
            <fieldset key={e.key} style={{
              margin: 0, background: 'var(--s1)', border: '1px solid var(--line)',
              borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 16,
              animation: 'smUp .5s ease both', animationDelay: `${i * 0.04}s`,
            }}>
              <legend style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
                {e.en}
              </legend>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{
                  width: 40, height: 40, borderRadius: 10, border: '1px solid var(--goldT2)',
                  display: 'grid', placeItems: 'center', color: 'var(--gold)', flex: 'none',
                }}>
                  <Icon size={19} />
                </span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontFamily: 'var(--serif)', fontSize: 19, lineHeight: 1.2 }}>
                    {e.en}{' '}
                    <span style={{ fontFamily: 'var(--tamil)', fontSize: 15, color: 'var(--mu)' }}>{e.ta}</span>
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--mu)' }}>{e.hint}</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {choices.map((label) => {
                  const on = exam[e.key] === label
                  return (
                    <button
                      key={label} type="button" aria-pressed={on}
                      onClick={() => pick(e.key, label)}
                      style={{
                        minHeight: 40, padding: '0 14px', borderRadius: 999,
                        font: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        transition: 'all .2s',
                        background: on ? 'var(--goldT)' : 'transparent',
                        border: `1px solid ${on ? 'var(--gold)' : 'var(--line2)'}`,
                        color: on ? 'var(--gold)' : 'var(--mu)',
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )
        })}
      </div>

      {error && (
        <p role="alert" style={{
          margin: 0, color: 'var(--red)', fontSize: 14,
          border: '1px solid var(--redT)', background: 'var(--redT)',
          borderRadius: 10, padding: '12px 14px',
        }}>
          {error}
        </p>
      )}

      <div style={{
        position: 'sticky', bottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12,
        justifyContent: 'flex-end', alignItems: 'center', padding: '12px 16px',
        borderRadius: 14, background: 'var(--glass)', backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)', border: '1px solid var(--line2)', zIndex: 5,
      }}>
        <span style={{
          marginRight: 'auto', fontSize: 13, color: 'var(--mu)',
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <Scales size={16} /> Scores are computed by rules. The AI writes the summary only.
        </span>
        <button type="button" className="btn btn-secondary"
                onClick={() => { setExam({}); setError(null) }}
                style={{ minHeight: 44, padding: '0 16px' }}>
          Clear findings
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}
                style={{ minHeight: 44, padding: '0 20px' }}>
          {busy ? 'Computing…' : 'Compute dosha & noi'} <ArrowRight size={16} />
        </button>
      </div>
    </form>
  )
}
