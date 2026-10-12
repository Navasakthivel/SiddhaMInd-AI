import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { searchFormulary } from '../api/client'
import { useRequest } from '../components/ViewState'
import { Loading, ErrorNote, EmptyNote } from '../components/ui'
import { lift, drop } from '../components/bits'

/**
 * 18 Formulary.
 *
 * Search runs on the server - GET /api/formulary?q= hits name_english,
 * name_tamil and sfi_code - so a Tamil query works without the browser holding
 * the whole table. The dosage-form filter is applied client-side on top of the
 * rows the search already returned, and its buttons are built from the dosage
 * forms actually present in those rows rather than a hardcoded list: a filter
 * offering "Mezhugu" when no mezhugu exists is a dead end that looks like a
 * broken search.
 *
 * `total` is the count of rows this query returned, not the size of the table.
 * The server was changed to send it that way, because the previous
 * formulationRepository.count() contradicted the list sitting next to it the
 * moment a search narrowed the results.
 */
export default function Formulary() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [form, setForm] = useState('All')
  const navigate = useNavigate()

  const req = useRequest(() => searchFormulary(query), [query], {
    isEmpty: (d) => !d?.results?.length,
  })
  const results = req.data?.results ?? []

  const forms = useMemo(() => {
    const seen = [...new Set(results.map((f) => f.dosageForm).filter(Boolean))].sort()
    return ['All', ...seen]
  }, [results])

  const rows = form === 'All' ? results : results.filter((f) => f.dosageForm === form)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(input.trim()) }}
              style={{ position: 'relative', flex: '1 1 320px', maxWidth: 520 }}>
          <MagnifyingGlass size={18} style={{ position: 'absolute', left: 14, top: 15, color: 'var(--mu)' }} />
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)}
                 placeholder="Search English, &#3980;&#2990;&#3007;&#2996;&#3021; or SFI code"
                 aria-label="Search formulary"
                 style={{ minHeight: 48, paddingLeft: 40, background: 'var(--s1)' }} />
        </form>

        <div role="group" aria-label="Dosage form" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {forms.map((f) => {
            const on = f === form
            return (
              <button key={f} onClick={() => setForm(f)} aria-pressed={on} style={{
                minHeight: 44, padding: '0 16px', borderRadius: 999, font: 'inherit',
                fontSize: 14, cursor: 'pointer',
                background: on ? 'var(--goldT)' : 'none',
                border: `1px solid ${on ? 'var(--gold)' : 'var(--line2)'}`,
                color: on ? 'var(--gold)' : 'var(--mu)',
              }}>
                {f}
              </button>
            )
          })}
        </div>

        {req.state === 'ready' && (
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--mu)' }}>
            {rows.length} of {req.data.total} preparations
          </span>
        )}
      </div>

      {req.state === 'loading' && <Loading rows={4} />}
      {req.state === 'error' && <ErrorNote message={req.error?.message} onRetry={req.reload} />}
      {req.state === 'empty' && (
        <EmptyNote title="No formulation matches"
                   body="Try the Tamil name or an SFI code such as SFI-P-017." />
      )}

      {req.state === 'ready' && (rows.length === 0 ? (
        <EmptyNote title="Nothing in that dosage form"
                   body={`No result for this search is a ${form}.`} />
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,280px),1fr))',
          gap: 16,
        }}>
          {rows.map((f, i) => (
            <button key={f.formId} onClick={() => navigate(`/formulary/${f.formId}`)} style={{
              textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer',
              background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
              padding: 24, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 190,
              animation: 'smUp .5s ease both', animationDelay: `${Math.min(i, 8) * 0.04}s`,
              transition: 'transform .25s, box-shadow .25s, border-color .25s',
            }} onMouseEnter={lift} onMouseLeave={drop}>
              <span style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)' }}>
                  {f.sfiCode || '—'}
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                  {/* RED is the seeded safety class for a preparation that needs a
                      prescriber's judgement; it is a stored column, not inferred
                      from whether a heavy metal is present. */}
                  {f.safetyClass === 'RED' && (
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 6,
                      background: 'var(--red)', color: 'var(--onGold)', whiteSpace: 'nowrap',
                    }}>
                      High risk
                    </span>
                  )}
                  {f.containsHeavyMetal && (
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 6,
                      border: '1px solid var(--amb)', color: 'var(--amb)', whiteSpace: 'nowrap',
                    }}>
                      Heavy metal
                    </span>
                  )}
                </span>
              </span>
              <span style={{ fontFamily: 'var(--tamil)', fontSize: 20, lineHeight: 1.4 }}>
                {f.nameTamil}
              </span>
              <span style={{ fontFamily: 'var(--serif)', fontSize: 20 }}>{f.nameEnglish}</span>
              {/* The prototype prints "For <indications>" here. The list endpoint
                  returns scalars only - indications are a separate query on the
                  detail screen - so the safety class goes here instead of a
                  sentence nothing on the wire supports. */}
              <span style={{ fontSize: 13, color: 'var(--mu)', flex: 1 }}>
                {SAFETY_TEXT[f.safetyClass] ?? 'Safety class not recorded'}
              </span>
              <span style={{
                alignSelf: 'flex-start', fontSize: 12, padding: '2px 10px', borderRadius: 6,
                border: '1px solid var(--line2)', color: 'var(--mu)',
              }}>
                {f.dosageForm || '—'}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

/** The three seeded safety classes, in words. */
const SAFETY_TEXT = {
  GREEN: 'General use under supervision',
  AMBER: 'Caution — check the contraindications',
  RED: 'Prescriber judgement required',
}
