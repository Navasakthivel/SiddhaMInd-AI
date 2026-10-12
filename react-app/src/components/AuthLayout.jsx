import { useNavigate } from 'react-router-dom'
import { useReducedMotion } from 'framer-motion'
import { ArrowLeft } from '@phosphor-icons/react'
import { Mark, Wordmark } from './ui'
import Herb, { HERB_LOGIN } from './Herb'

/**
 * The split layout shared by sign-in and activation: the kolam aside on the
 * left (hidden on narrow screens by tokens.css), the form column on the right.
 * Extracted from Login so /activate is visibly the same place, not a lookalike.
 */
export default function AuthLayout({ children, onSubmit, label }) {
  const navigate = useNavigate()
  const reduce = useReducedMotion()

  /** The aside's kolam. Turning it off entirely is the reduced-motion answer. */
  const spin = (name, secs) => (reduce
    ? { transformOrigin: '200px 200px' }
    : { transformOrigin: '200px 200px', animation: `${name} ${secs}s linear infinite` })

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexWrap: 'wrap', background: 'var(--bg)' }}>
      <div className="sm-login-aside" style={{
        flex: '1 1 520px', position: 'relative', overflow: 'hidden', background: 'var(--s1)',
        borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', padding: 48, minHeight: '100vh',
      }}>
        <button onClick={() => navigate('/')} style={{
          display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 0,
          color: 'var(--tx)', cursor: 'pointer', padding: 0, minHeight: 44,
          alignSelf: 'flex-start', position: 'relative', zIndex: 1,
        }}>
          <Mark size={32} /><Wordmark size={21} />
        </button>

        <svg viewBox="0 0 400 400" fill="none" stroke="var(--gold)" aria-hidden="true" style={{
          position: 'absolute', width: '88%', maxWidth: 600, left: '50%', top: '50%',
          marginLeft: '-44%', marginTop: '-44%', opacity: .9,
        }}>
          <g style={spin('smSpin', 160)}>
            <circle cx="200" cy="200" r="190" strokeOpacity=".22" />
            <circle cx="200" cy="200" r="174" strokeOpacity=".4" strokeDasharray="1.5 7" strokeLinecap="round" strokeWidth="1.4" />
            <rect x="92" y="92" width="216" height="216" rx="34" strokeOpacity=".3" />
            <rect x="92" y="92" width="216" height="216" rx="34" strokeOpacity=".3" transform="rotate(45 200 200)" />
          </g>
          <g style={spin('smSpinR', 110)} strokeOpacity=".55">
            {[0, 45, 90, 135].map((d) => (
              <ellipse key={d} cx="200" cy="200" rx="44" ry="146"
                       transform={d ? `rotate(${d} 200 200)` : undefined} />
            ))}
          </g>
          <circle cx="200" cy="200" r="66" strokeOpacity=".5" />
          <circle cx="200" cy="200" r="4" fill="var(--gold)" stroke="none" />
        </svg>

        {/* The prototype's jade herb, lower left of the aside. */}
        <Herb leaves={HERB_LOGIN} stroke="var(--jade)" strokeWidth={1.3}
              style={{ left: '6%', bottom: '8%', width: 130 }} />

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 40, lineHeight: 1.05, letterSpacing: '-.02em' }}>
            Rules decide.<br /><em style={{ color: 'var(--gold)' }}>AI explains.</em>
          </div>
          <div style={{ fontFamily: 'var(--tamil)', color: 'var(--mu)' }}>
            விதிகள் முடிவெடுக்கின்றன &middot; AI விளக்குகிறது
          </div>
        </div>
      </div>

      <div style={{
        flex: '1 1 440px', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 'clamp(24px,5vw,64px)',
      }}>
        <form onSubmit={onSubmit} aria-label={label} noValidate style={{
          width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column',
          gap: 24, animation: 'smUp .6s ease both',
        }}>
          <button type="button" onClick={() => navigate('/')} className="sm-login-back" style={{
            display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 0,
            color: 'var(--mu)', cursor: 'pointer', padding: 0, minHeight: 44, font: 'inherit',
          }}>
            <ArrowLeft size={16} /> SiddhaMind AI
          </button>
          {children}
        </form>
      </div>
    </div>
  )
}

const TONES = {
  error: { color: 'var(--red)', bg: 'var(--redT)' },
  warn: { color: 'var(--amb)', bg: 'var(--ambT)' },
  ok: { color: 'var(--jade)', bg: 'var(--jadeT)' },
}

/** The inline message box the auth forms use, in the existing error style. */
export function Notice({ tone = 'error', children, testId }) {
  const t = TONES[tone] ?? TONES.error
  return (
    <p role={tone === 'ok' ? 'status' : 'alert'} data-testid={testId} style={{
      margin: 0, color: t.color, fontSize: 13,
      border: `1px solid ${t.bg}`, background: t.bg,
      borderRadius: 10, padding: '10px 12px',
    }}>
      {children}
    </p>
  )
}
