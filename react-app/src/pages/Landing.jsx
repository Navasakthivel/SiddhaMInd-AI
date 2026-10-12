import { useNavigate } from 'react-router-dom'
import { useReducedMotion } from 'framer-motion'
import {
  ArrowRight, ArrowUpRight, Info, Flask, ShieldCheck, Stethoscope,
  ChatCircleText, GraduationCap, Heart, ShieldStar,
} from '@phosphor-icons/react'
import { Mark, Wordmark } from '../components/ui'
import Herb, { HERB_HERO_LEFT, HERB_HERO_RIGHT } from '../components/Herb'

/**
 * 01 Landing.
 *
 * Pre-auth, so it makes no API call: every counting endpoint is behind the
 * session. Nothing here states a figure. The copy is the prototype's product
 * copy, which is a claim about what the product does, not data about what is in
 * it - the distinction the earlier fabricated-data audit turned on.
 */
const MODULES = [
  {
    icon: <Flask size={24} />, ta: 'மருந்து அட்டவணை', title: 'Formulary',
    body: 'Every preparation with its Tamil name, SFI code, composition and the book it is described in.',
    delay: '0s',
  },
  {
    icon: <ShieldCheck size={24} />, ta: 'மருந்து பாதுகாப்பு', title: 'Safety checker',
    body: 'Fixed rules for heavy metals, pregnancy, renal load and known interactions. The rule that fired is always shown.',
    delay: '.1s',
  },
  {
    icon: <Stethoscope size={24} />, ta: 'எண்வகைத் தேர்வு', title: 'Envagai Thervu',
    body: 'The eight-fold examination, scored into Vatham, Pitham and Kabam by a deterministic weighting.',
    delay: '.2s',
  },
]

const HOW = [
  { n: '01', title: 'The rules decide', body: 'A deterministic engine reads the database and produces the verdict. No model is consulted to reach it.' },
  { n: '02', title: 'The model explains', body: 'Only once a verdict exists is the assistant asked to phrase it. If the assistant is unreachable, the verdict still stands.' },
  { n: '03', title: 'Every answer cites', body: 'Retrieval answers only from the scanned pharmacopoeia, and returns the book, page and verse. If the corpus is silent, it says so.' },
]

const ROLES = [
  { key: 'PRACTITIONER', icon: <Stethoscope size={26} />, color: 'var(--jade)', label: 'Doctor', via: 'Doctor ID from your admin · DOC-0001', desc: 'Run the eight-fold examination, screen preparations against modern medicines, review your own records.' },
  { key: 'STUDENT', icon: <GraduationCap size={26} />, color: 'var(--va)', label: 'Student', via: 'Student ID from your admin · STU-0001', desc: 'Study the formulary, practise safety checks and ask the assistant with full citations.' },
  { key: 'PATIENT', icon: <Heart size={26} />, color: 'var(--tx)', label: 'Patient', via: 'Email · register yourself', desc: 'Read plain-language information about preparations and which ingredients need extra care.' },
  { key: 'ADMIN', icon: <ShieldStar size={26} />, color: 'var(--gold)', label: 'Admin', via: 'Email · seeded account', desc: 'Manage accounts, issue doctor and student IDs, index the corpus and review system-wide activity.' },
]

export default function Landing() {
  const navigate = useNavigate()
  const goLogin = (role) => navigate('/login', role ? { state: { role } } : undefined)

  return (
    <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--bg)', minHeight: '100vh' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 24,
        padding: '16px clamp(16px,4vw,56px)', borderBottom: '1px solid var(--line)',
        position: 'relative', zIndex: 2,
      }}>
        <button onClick={() => navigate('/')} style={{
          display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 0,
          color: 'var(--tx)', cursor: 'pointer', padding: 0, minHeight: 44,
        }}>
          <Mark size={32} /><Wordmark size={21} />
        </button>
        <nav style={{ display: 'flex', gap: 32, marginLeft: 'auto', fontSize: 14 }} className="sm-landing-nav">
          <a href="#modules" style={{ color: 'var(--mu)' }}>Modules</a>
          <a href="#how" style={{ color: 'var(--mu)' }}>How it works</a>
          <a href="#roles" style={{ color: 'var(--mu)' }}>Access</a>
        </nav>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn btn-secondary" onClick={() => goLogin()} style={{ minHeight: 44, padding: '0 16px' }}>
            Sign in
          </button>
          {/* Desktop only, as in the prototype's notMobile guard. Kept in the
              header below 760px it pushed the wordmark into wrapping mid-word
              ("SiddhaMin / d AI"). Registration is still reachable on mobile:
              the sign-in screen links to it. */}
          <button className="btn btn-primary sm-landing-cta" onClick={() => navigate('/register')}
                  style={{ minHeight: 44, padding: '0 18px' }}>
            Register as patient
          </button>
        </div>
      </header>

      <section style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 48,
        padding: 'clamp(40px,7vw,96px) clamp(16px,4vw,56px) clamp(48px,6vw,80px)',
        maxWidth: 1440, margin: '0 auto',
      }}>
        <div style={{ flex: '1 1 440px', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{
            fontSize: 12, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--gold)',
            animation: 'smUp .7s ease both', animationDelay: '.05s',
          }}>
            Siddha medicine &middot; clinical decision support
          </div>
          <h1 style={{
            fontFamily: 'var(--serif)', fontWeight: 350, fontSize: 'clamp(46px,6.4vw,88px)',
            lineHeight: 1, letterSpacing: '-.025em', margin: 0,
            animation: 'smUp .8s ease both', animationDelay: '.15s',
          }}>
            Rules decide.<br />
            <em style={{ color: 'var(--gold)', fontWeight: 300 }}>AI explains.</em>
          </h1>
          <p style={{
            fontSize: 'clamp(16px,1.4vw,18px)', color: 'var(--mu)', maxWidth: 540, margin: 0,
            textWrap: 'pretty', animation: 'smUp .8s ease both', animationDelay: '.28s',
          }}>
            A searchable Siddha formulary, a rule-based drug-safety checker, Envagai Thervu
            diagnosis and an assistant that answers only from the scanned Tamil pharmacopoeia
            &mdash; with the book and page it came from.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, animation: 'smUp .8s ease both', animationDelay: '.4s' }}>
            <button className="btn btn-primary" onClick={() => goLogin()}
                    style={{ minHeight: 48, padding: '0 24px', fontSize: 15 }}>
              Sign in to SiddhaMind <ArrowRight size={16} />
            </button>
            <a href="#roles" className="btn btn-secondary"
               style={{ minHeight: 48, padding: '0 20px', fontSize: 15, color: 'var(--tx)' }}>
              Continue as a role
            </a>
          </div>
          <div style={{
            display: 'flex', gap: 24, flexWrap: 'wrap', fontFamily: 'var(--tamil)',
            fontSize: 15, color: 'var(--mu)', animation: 'smUp .8s ease both', animationDelay: '.52s',
          }}>
            <span>சித்த மருத்துவம்</span>
            <span style={{ color: 'var(--gold)' }}>&middot;</span>
            <span>எண்வகைத் தேர்வு</span>
            <span style={{ color: 'var(--gold)' }}>&middot;</span>
            <span>மருந்து பாதுகாப்பு</span>
          </div>
        </div>

        <div style={{ flex: '1 1 360px', maxWidth: 560, aspectRatio: '1', position: 'relative', margin: '0 auto' }}>
          <Yantra />
          {/* The two herbs the prototype draws over the yantra: jade growing up
              from the lower left, a smaller gold one mirrored into the top
              right. Both sit outside the yantra's square on purpose, which is
              why the hero wrapper clips nothing and the section is overflow
              hidden further up. */}
          <Herb leaves={HERB_HERO_LEFT} stroke="var(--jade)" strokeWidth={1.3}
                style={{ left: '-4%', bottom: '-2%', width: '30%' }} />
          <Herb leaves={HERB_HERO_RIGHT} stroke="var(--gold)" strokeWidth={1.2}
                style={{ right: '-2%', top: '2%', width: '22%', transform: 'scaleX(-1) rotate(18deg)' }} />
        </div>
      </section>

      <Section id="modules" eyebrow="Modules" title="Three tools over one verified formulary">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 24 }}>
          {MODULES.map((m) => (
            <button key={m.title} onClick={() => goLogin()} style={{
              textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer',
              background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
              padding: 32, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 280,
              transition: 'transform .25s ease, box-shadow .25s ease, border-color .25s',
              animation: 'smUp .7s ease both', animationDelay: m.delay,
            }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
              <span style={{
                width: 48, height: 48, borderRadius: 12, border: '1px solid var(--goldT2)',
                display: 'grid', placeItems: 'center', color: 'var(--gold)',
              }}>{m.icon}</span>
              <span style={{ fontFamily: 'var(--tamil)', fontSize: 14, color: 'var(--mu)' }}>{m.ta}</span>
              <span style={{ fontFamily: 'var(--serif)', fontSize: 26, lineHeight: 1.15 }}>{m.title}</span>
              <span style={{ color: 'var(--mu)', fontSize: 15, flex: 1, textWrap: 'pretty' }}>{m.body}</span>
              <span style={{ color: 'var(--gold)', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                Open module <ArrowRight size={14} />
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section id="how" eyebrow="How it works" title="The model never makes the call">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 40 }}>
          {HOW.map((h) => (
            <div key={h.n} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--gold)' }}>{h.n}</span>
                <span style={{ flex: 1, height: 1, background: 'linear-gradient(to right,var(--goldT2),transparent)' }} />
              </div>
              <div style={{ fontFamily: 'var(--serif)', fontSize: 28, letterSpacing: '-.01em' }}>{h.title}</div>
              <p style={{ margin: 0, color: 'var(--mu)', textWrap: 'pretty' }}>{h.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="roles" eyebrow="Continue as" title="Each role sees what it needs">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 16 }}>
          {ROLES.map((r, i) => (
            <button key={r.key} onClick={() => goLogin(r.key)} style={{
              textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer',
              background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
              padding: 24, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 200,
              transition: 'transform .25s ease, box-shadow .25s ease, border-color .25s',
              animation: 'smUp .7s ease both', animationDelay: `${i * 0.08}s`,
            }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: r.color }}>{r.icon}</span>
                <ArrowUpRight size={16} style={{ color: 'var(--mu)' }} />
              </span>
              <span style={{ fontFamily: 'var(--serif)', fontSize: 24 }}>{r.label}</span>
              <span style={{ color: 'var(--mu)', fontSize: 14, flex: 1, textWrap: 'pretty' }}>{r.desc}</span>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 12, color: r.color === 'var(--tx)' ? 'var(--gold)' : r.color,
                borderTop: '1px solid var(--line)', paddingTop: 12,
              }}>
                Sign in with: {r.via}
              </span>
            </button>
          ))}
        </div>
      </Section>

      <footer style={{
        borderTop: '1px solid var(--line)', padding: '32px clamp(16px,4vw,56px)',
        display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center',
        justifyContent: 'space-between', maxWidth: 1440, margin: '0 auto',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 18 }}>SiddhaMind AI</span>
          <span style={{ color: 'var(--mu)', fontSize: 13 }}>
            Built on the Siddha Formulary of India preparations
          </span>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--goldT2)',
          borderRadius: 12, padding: '12px 16px', maxWidth: 560,
        }}>
          <Info size={20} style={{ color: 'var(--gold)', flex: 'none' }} />
          <span style={{ fontSize: 14 }}>
            Education and decision support &mdash; not a prescription. Consult a registered
            Siddha practitioner before taking any preparation.
          </span>
        </div>
      </footer>
    </div>
  )
}

function Section({ id, eyebrow, title, children }) {
  return (
    <section id={id} style={{
      padding: 'clamp(48px,6vw,88px) clamp(16px,4vw,56px)', maxWidth: 1440,
      margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 640 }}>
        <div style={{ fontSize: 12, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--gold)' }}>
          {eyebrow}
        </div>
        <h2 style={{
          fontFamily: 'var(--serif)', fontWeight: 400,
          fontSize: 'clamp(30px,3.4vw,44px)', margin: 0, letterSpacing: '-.02em',
        }}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  )
}

const hoverIn = (e) => {
  e.currentTarget.style.transform = 'translateY(-4px)'
  e.currentTarget.style.borderColor = 'var(--goldT2)'
  e.currentTarget.style.boxShadow = '0 18px 44px -16px var(--goldT2)'
}
const hoverOut = (e) => {
  e.currentTarget.style.transform = 'none'
  e.currentTarget.style.borderColor = 'var(--line)'
  e.currentTarget.style.boxShadow = 'none'
}

/** The eight points of the octagon, as the prototype marks them. */
const OUTER_DOTS = [
  [347.8, 261.2], [261.2, 347.8], [138.8, 347.8], [52.2, 261.2],
  [52.2, 138.8], [138.8, 52.2], [261.2, 52.2], [347.8, 138.8],
]
const INNER_DOTS = [
  [310, 200], [277.8, 277.8], [200, 310], [122.2, 277.8],
  [90, 200], [122.2, 122.2], [200, 90], [277.8, 122.2],
]

/**
 * The counter-rotating kolam. Decorative, aria-hidden.
 *
 * Two groups turning opposite ways at 160s and 110s — slow enough to read as
 * drift rather than motion. Under reduced motion neither turns at all.
 */
function Yantra() {
  const reduce = useReducedMotion()
  const spin = (name, secs) => (reduce
    ? { transformOrigin: '200px 200px' }
    : { transformOrigin: '200px 200px', animation: `${name} ${secs}s linear infinite` })

  return (
    <svg viewBox="0 0 400 400" width="100%" height="100%" fill="none" stroke="var(--gold)"
         aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
      <g style={spin('smSpin', 160)}>
        <circle cx="200" cy="200" r="190" strokeOpacity=".28" />
        <circle cx="200" cy="200" r="174" strokeOpacity=".5" strokeDasharray="1.5 7" strokeLinecap="round" strokeWidth="1.4" />
        <rect x="92" y="92" width="216" height="216" rx="34" strokeOpacity=".38" />
        <rect x="92" y="92" width="216" height="216" rx="34" strokeOpacity=".38" transform="rotate(45 200 200)" />
        <g fill="var(--gold)" stroke="none" fillOpacity=".8">
          {OUTER_DOTS.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.4" />)}
        </g>
      </g>
      <g style={spin('smSpinR', 110)} strokeWidth="1.1">
        {[0, 45, 90, 135].map((deg) => (
          <ellipse key={deg} cx="200" cy="200" rx="44" ry="146" strokeOpacity=".7"
                   transform={deg ? `rotate(${deg} 200 200)` : undefined} />
        ))}
        <g fill="var(--gold)" stroke="none">
          {INNER_DOTS.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.6" />)}
        </g>
      </g>
      <circle cx="200" cy="200" r="66" strokeOpacity=".6" />
      <circle cx="200" cy="200" r="34" strokeOpacity=".8" />
      <circle cx="200" cy="200" r="4" fill="var(--gold)" stroke="none" />
    </svg>
  )
}

/**
 * Where a role lands after sign-in. The server decides the role; this only
 * decides where that role goes. PATIENT now has its own dashboard, so the
 * default is no longer the formulary for it.
 */
export function routeForRole(role) {
  switch (role) {
    case 'ADMIN': return '/admin-dashboard'
    case 'PRACTITIONER': return '/practitioner-dashboard'
    case 'STUDENT': return '/student-dashboard'
    case 'PATIENT': return '/patient-dashboard'
    default: return '/formulary'
  }
}
