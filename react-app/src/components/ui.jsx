import { Info } from '@phosphor-icons/react'

/**
 * Shared pieces for the Round B screens, matching the prototype's surfaces.
 * Kept here rather than repeated inline so a spacing change lands once.
 */

export function Card({ children, style, ...rest }) {
  return <section className="sm-card" style={style} {...rest}>{children}</section>
}

/** The prototype's table-in-a-card: the card scrolls, the table keeps its min-width. */
export function TableCard({ minWidth = 760, children }) {
  return (
    <section style={{
      background: 'var(--s1)', border: '1px solid var(--line)',
      borderRadius: 14, padding: '8px 24px 16px', overflowX: 'auto',
    }}>
      <table className="table" style={{ minWidth }}>{children}</table>
    </section>
  )
}

export function Lede({ children }) {
  return <p style={{ margin: 0, color: 'var(--mu)', maxWidth: '68ch', textWrap: 'pretty' }}>{children}</p>
}

/** Loading, error and empty, in the prototype's voice: say what to do next. */
export function Loading({ rows = 4 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          height: 44, borderRadius: 10, background: 'var(--s2)',
          animation: 'smPulse 1.6s ease-in-out infinite', animationDelay: `${i * 0.08}s`,
        }} />
      ))}
    </div>
  )
}

export function ErrorNote({ message, onRetry }) {
  return (
    <Card style={{ borderColor: 'var(--redT)' }}>
      <span style={{ fontFamily: 'var(--serif)', fontSize: 20, color: 'var(--red)' }}>
        Could not load this
      </span>
      {message && <span style={{ color: 'var(--mu)', fontSize: 14 }}>{message}</span>}
      {onRetry && (
        <button className="btn btn-secondary" onClick={onRetry}
                style={{ alignSelf: 'flex-start', minHeight: 44, padding: '0 16px' }}>
          Try again
        </button>
      )}
    </Card>
  )
}

export function EmptyNote({ title, body, action }) {
  return (
    <Card>
      <span style={{ fontFamily: 'var(--serif)', fontSize: 20 }}>{title}</span>
      {body && <span style={{ color: 'var(--mu)', fontSize: 14, textWrap: 'pretty' }}>{body}</span>}
      {action}
    </Card>
  )
}

/** The gold advisory panel used on the patient portal and the landing footer. */
export function Advisory({ title, children }) {
  return (
    <section style={{
      border: '1px solid var(--goldT2)', background: 'var(--goldT)', borderRadius: 14,
      padding: 24, display: 'flex', gap: 16, alignItems: 'flex-start',
    }}>
      <Info size={24} style={{ color: 'var(--gold)', flex: 'none' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {title && <span style={{ fontFamily: 'var(--serif)', fontSize: 22 }}>{title}</span>}
        <span style={{ textWrap: 'pretty' }}>{children}</span>
      </div>
    </section>
  )
}

/** Toxicity class colour. Reserved palette: this is clinical, not decorative. */
export function toxicityColor(cls) {
  const v = (cls ?? '').toUpperCase()
  if (v.includes('HIGH') || v.includes('SEVERE')) return 'var(--red)'
  if (v.includes('MODERATE') || v.includes('MEDIUM')) return 'var(--amb)'
  if (v.includes('LOW') || v.includes('MILD')) return 'var(--jade)'
  return 'var(--mu)'
}

/** Kutram colour, matching the prototype's KUT map. */
export const KUTRAM = {
  VATHAM: { ta: 'வாதம்', el: 'Air', c: 'var(--va)' },
  PITHAM: { ta: 'பித்தம்', el: 'Fire', c: 'var(--pi)' },
  KABAM: { ta: 'கபம்', el: 'Water · Earth', c: 'var(--ka)' },
  MIXED: { ta: 'கலப்பு', el: 'Mixed', c: 'var(--mu)' },
}
export function kutram(name) {
  return KUTRAM[(name ?? '').toUpperCase()] ?? { ta: '', el: '', c: 'var(--mu)' }
}

export function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return String(iso) }
}

/** The SiddhaMind mark: three rotated ellipses for the three kutram. */
export function Mark({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none"
         stroke="var(--gold)" strokeWidth="1.3" aria-hidden="true">
      <circle cx="20" cy="20" r="18" strokeOpacity=".5" />
      <ellipse cx="20" cy="20" rx="6" ry="15" />
      <ellipse cx="20" cy="20" rx="6" ry="15" transform="rotate(60 20 20)" />
      <ellipse cx="20" cy="20" rx="6" ry="15" transform="rotate(120 20 20)" />
      <circle cx="20" cy="20" r="2" fill="var(--gold)" />
    </svg>
  )
}

export function Wordmark({ size = 21 }) {
  return (
    <span style={{ fontFamily: 'var(--serif)', fontSize: size, letterSpacing: '-.01em' }}>
      SiddhaMind{' '}
      <span style={{ fontFamily: 'var(--mono)', fontSize: size * 0.57, color: 'var(--gold)', letterSpacing: '.08em' }}>
        AI
      </span>
    </span>
  )
}

/**
 * The name to greet someone by. FIXES BUG-04.
 *
 * `name.split(" ")[0]` produced "Good afternoon, Dr." for the seeded
 * "Dr. Meenakshi Sundaram", because the honorific is the first token. Titles are
 * skipped so the greeting lands on the given name, and a name that is ONLY a
 * title falls back to the whole string rather than to nothing.
 */
const TITLES = new Set(['dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'prof', 'prof.', 'vaidya', 'shri', 'smt', 'smt.'])

export function firstNameOf(fullName, fallback = 'there') {
  const words = String(fullName ?? '').trim().split(/\s+/).filter(Boolean)
  const named = words.filter((w) => !TITLES.has(w.toLowerCase()))
  if (named.length > 0) return named[0]
  if (words.length > 0) return words[0]
  return fallback
}
