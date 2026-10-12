import { useMemo, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { ingredients as fetchIngredients } from '../api/client'
import { useRequest } from '../components/ViewState'
import { TableCard, Lede, Loading, ErrorNote, EmptyNote, toxicityColor } from '../components/ui'

/**
 * 16a Ingredients.
 *
 * Every row comes from GET /api/formulary/ingredients. The search filters the
 * already-fetched list in the browser rather than re-querying: the formulary is
 * small and bounded, and a round trip per keystroke would be slower than the
 * filter and would put load on the database for no gain.
 *
 * Columns follow the prototype, minus "Common name" - the ingredient record has
 * nameEnglish, nameTamil and scientificName, and no separate common-name field.
 * Rather than repeat nameEnglish under a second heading, the column is dropped
 * and partUsed shown instead, which is real.
 */
export default function Ingredients() {
  const req = useRequest(() => fetchIngredients(), [], { isEmpty: (d) => !d?.ingredients?.length })
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const all = req.data?.ingredients ?? []
    const term = q.trim().toLowerCase()
    if (!term) return all
    return all.filter((i) => [i.nameEnglish, i.nameTamil, i.scientificName, i.sourceType, i.elementSymbol]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(term)))
  }, [req.data, q])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <label style={{ position: 'relative', maxWidth: 520 }}>
        <MagnifyingGlass size={18} style={{ position: 'absolute', left: 14, top: 15, color: 'var(--mu)' }} />
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search English, Tamil or scientific name"
          aria-label="Search ingredients"
          style={{ minHeight: 48, paddingLeft: 40, background: 'var(--s1)' }}
        />
      </label>

      <Lede>
        Raw drugs used across the formulary. Metals and minerals carry a toxicity class and
        must go through sutthi (purification) before use.
      </Lede>

      {req.state === 'loading' && <Loading rows={6} />}
      {req.state === 'error' && <ErrorNote message={req.error?.message} onRetry={req.reload} />}
      {req.state === 'empty' && (
        <EmptyNote
          title="No ingredients recorded"
          body="The formulary has no ingredient rows in this instance yet."
        />
      )}

      {req.state === 'ready' && (rows.length === 0 ? (
        <EmptyNote
          title="Nothing matched"
          body={'No ingredient matched that search. Nothing has been inferred in its place.'}
        />
      ) : (
        <TableCard minWidth={820}>
          <thead>
            <tr>
              <th>Tamil</th><th>Name</th><th>Identity</th><th>Type</th>
              <th>Part used</th><th>Metal</th><th>Toxicity class</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.ingredientId}>
                <td style={{ fontFamily: 'var(--tamil)', fontSize: 16, padding: '12px 6px' }}>
                  {i.nameTamil || '—'}
                </td>
                <td style={{ fontWeight: 600 }}>{i.nameEnglish}</td>
                <td style={{ fontStyle: 'italic', color: 'var(--mu)', fontSize: 13 }}>
                  {i.scientificName || '—'}
                </td>
                <td style={{ fontSize: 13 }}>{i.sourceType || '—'}</td>
                <td style={{ fontSize: 13, color: 'var(--mu)' }}>{i.partUsed || '—'}</td>
                <td>
                  {i.heavyMetal && (
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: 12, padding: '2px 8px',
                      borderRadius: 6, border: '1px solid var(--amb)', color: 'var(--amb)',
                    }}>
                      {i.elementSymbol || 'metal'}
                    </span>
                  )}
                </td>
                <td style={{ fontSize: 13, fontWeight: 600, color: toxicityColor(i.toxicityClass) }}>
                  {i.toxicityClass || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      ))}
    </div>
  )
}
