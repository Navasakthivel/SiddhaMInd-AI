import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { diseases as fetchDiseases } from '../api/client'
import { useRequest } from '../components/ViewState'
import { Loading, ErrorNote, EmptyNote, kutram } from '../components/ui'

/**
 * 16b Diseases (Noi).
 *
 * Cards from GET /api/formulary/diseases, which now carries preparationCount
 * per disease. That count is produced by one grouped query on the server, not by
 * a request per card - thirteen cards would otherwise mean fourteen round trips
 * to Supabase for a number on a tile.
 */
export default function Diseases() {
  const req = useRequest(() => fetchDiseases(), [], { isEmpty: (d) => !d?.diseases?.length })
  const [q, setQ] = useState('')
  const navigate = useNavigate()

  const rows = useMemo(() => {
    const all = req.data?.diseases ?? []
    const term = q.trim().toLowerCase()
    if (!term) return all
    return all.filter((n) => [n.noiEnglish, n.noiTamil, n.modernEquivalent, n.mukkutramType]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(term)))
  }, [req.data, q])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <label style={{ position: 'relative', flex: '1 1 320px', maxWidth: 520 }}>
          <MagnifyingGlass size={18} style={{ position: 'absolute', left: 14, top: 15, color: 'var(--mu)' }} />
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search English, Tamil, modern name or kutram"
            aria-label="Search diseases"
            style={{ minHeight: 48, paddingLeft: 40, background: 'var(--s1)' }}
          />
        </label>
        {req.state === 'ready' && (
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--mu)' }}>
            {rows.length} of {req.data.total} noi
          </span>
        )}
      </div>

      {req.state === 'loading' && <Loading rows={4} />}
      {req.state === 'error' && <ErrorNote message={req.error?.message} onRetry={req.reload} />}
      {req.state === 'empty' && (
        <EmptyNote title="No diseases recorded" body="This instance has no noi rows yet." />
      )}

      {req.state === 'ready' && (rows.length === 0 ? (
        <EmptyNote title="Nothing matched" body="No noi matched that search." />
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,280px),1fr))',
          gap: 16,
        }}>
          {rows.map((n, idx) => {
            const k = kutram(n.mukkutramType)
            return (
              <button
                key={n.diseaseId}
                onClick={() => navigate(`/disease/${n.diseaseId}`)}
                style={{
                  textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer',
                  background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
                  padding: 24, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 200,
                  animation: 'smUp .5s ease both',
                  animationDelay: `${Math.min(idx, 8) * 0.04}s`,
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
                {n.mukkutramType && (
                  <span style={{
                    alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, padding: '2px 8px',
                    borderRadius: 6, border: `1px solid ${k.c}`, color: k.c,
                  }}>
                    {n.mukkutramType}{' '}
                    <span style={{ fontFamily: 'var(--tamil)', fontWeight: 400 }}>{k.ta}</span>
                  </span>
                )}
                <span style={{ fontFamily: 'var(--tamil)', fontSize: 26, lineHeight: 1.4 }}>
                  {n.noiTamil}
                </span>
                <span style={{ fontFamily: 'var(--serif)', fontSize: 20 }}>{n.noiEnglish}</span>
                <span style={{ fontSize: 14, color: 'var(--mu)', flex: 1 }}>
                  {n.modernEquivalent || '—'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--mu)' }}>
                  Preparations: {n.preparationCount ?? 0}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
