/**
 * Small shared pieces used by more than one Round B3 screen.
 * Kept here so a risk colour or a status word is defined once.
 */

/** Ingestion status -> colour. Reserved palette, not decoration. */
export function statusColor(status) {
  switch ((status ?? '').toUpperCase()) {
    case 'COMPLETE': case 'INDEXED': return 'var(--jade)'
    case 'RUNNING': case 'INDEXING': return 'var(--gold)'
    case 'FAILED': case 'ERROR': return 'var(--red)'
    case 'STALLED': return 'var(--amb)'
    default: return 'var(--mu)'
  }
}

export function StatusDot({ status }) {
  const c = statusColor(status)
  return (
    <span style={{
      fontSize: 12, fontWeight: 600, color: c,
      display: 'inline-flex', gap: 6, alignItems: 'center',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c, flex: 'none' }} />
      {status || 'UNKNOWN'}
    </span>
  )
}

/** Risk level pill. HIGH must stay red; that is the whole point of the colour. */
export function RiskPill({ level }) {
  const c = { HIGH: 'var(--red)', MODERATE: 'var(--amb)', LOW: 'var(--jade)' }[level] ?? 'var(--mu)'
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, padding: '3px 8px',
      borderRadius: 6, border: `1px solid ${c}`, color: c, flex: 'none',
    }}>
      {level || '—'}
    </span>
  )
}

/**
 * The three kutram as one bar.
 *
 * Proportional to the three scores against each other, which is what the engine
 * computed. It is not a percentage of anything else, and it never appears
 * without the underlying numbers being available somewhere on the same screen.
 */
export function DoshaBar({ v = 0, p = 0, k = 0, width = 120 }) {
  const total = (v ?? 0) + (p ?? 0) + (k ?? 0)
  const pct = (n) => (total > 0 ? `${Math.round(((n ?? 0) / total) * 100)}%` : '0%')
  return (
    <span style={{
      display: 'flex', width, height: 6, borderRadius: 3,
      overflow: 'hidden', gap: 2, background: 'var(--line)', flex: 'none',
    }}>
      <span style={{ background: 'var(--va)', width: pct(v) }} />
      <span style={{ background: 'var(--pi)', width: pct(p) }} />
      <span style={{ background: 'var(--ka)', width: pct(k) }} />
    </span>
  )
}

/** Card hover lift, shared by every card grid. */
export const lift = (e) => {
  e.currentTarget.style.transform = 'translateY(-3px)'
  e.currentTarget.style.borderColor = 'var(--goldT2)'
  e.currentTarget.style.boxShadow = '0 14px 36px -14px var(--goldT2)'
}
export const drop = (e) => {
  e.currentTarget.style.transform = 'none'
  e.currentTarget.style.borderColor = 'var(--line)'
  e.currentTarget.style.boxShadow = 'none'
}
