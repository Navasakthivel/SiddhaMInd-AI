import { useReducedMotion } from 'framer-motion'

/**
 * The self-drawing herb line-art from the prototype.
 *
 * Shared because it appears twice — twice over the landing hero's kolam, and
 * once in the login aside — with the same five path shapes and different
 * subsets, colours and stagger each time. One copy of the geometry means a
 * corrected curve is corrected everywhere.
 *
 * HOW THE DRAWING WORKS. Each path declares pathLength="1", which rescales its
 * geometry so a dash of length 1 covers the whole stroke whatever its real arc
 * length. Starting at stroke-dashoffset 1 the stroke is entirely in the gap and
 * invisible; smDraw pulls the offset to 0 and the line appears to be drawn.
 * Without pathLength each path would need its own hand-measured dash length.
 *
 * REDUCED MOTION. The finished drawing is rendered directly: no dasharray, no
 * offset, no animation, so the stroke is simply complete on first paint.
 * tokens.css also collapses every animation to .001ms under that preference,
 * which would get to the same picture, but a drawing that snaps into existence
 * is still a drawing that moved — and relying on a global override leaves the
 * intent implicit in a component whose whole purpose is motion.
 */

/** The five strokes: one stem, then leaves alternating right and left. */
export const STEM = 'M60 236 C 58 180, 64 120, 58 20'
export const LEAF_1 = 'M60 190 C 30 184, 18 164, 16 150 C 40 152, 56 170, 60 190'
export const LEAF_2 = 'M60 160 C 90 152, 102 132, 104 118 C 80 122, 64 140, 60 160'
export const LEAF_3 = 'M59 128 C 32 120, 22 100, 22 86 C 44 90, 56 108, 59 128'
export const LEAF_4 = 'M59 96 C 84 88, 94 70, 96 56 C 74 60, 62 78, 59 96'
export const LEAF_5 = 'M58 62 C 42 52, 38 36, 40 24 C 54 32, 58 46, 58 62'

/**
 * `leaves` is a list of [pathData, durationSeconds, delaySeconds], copied from
 * the prototype rather than generated: the stagger is hand-tuned so the stem
 * finishes growing just as the first leaf starts to unfurl.
 */
export default function Herb({ leaves, stroke = 'var(--jade)', strokeWidth = 1.3, style }) {
  const reduce = useReducedMotion()
  return (
    <svg viewBox="0 0 120 240" fill="none" stroke={stroke} strokeWidth={strokeWidth}
         strokeLinecap="round" aria-hidden="true" style={{ position: 'absolute', ...style }}>
      {leaves.map(([d, dur, delay]) => (
        <path
          key={d + delay}
          pathLength="1"
          d={d}
          style={reduce ? undefined : {
            strokeDasharray: 1,
            strokeDashoffset: 1,
            animation: `smDraw ${dur}s ease forwards`,
            animationDelay: `${delay}s`,
          }}
        />
      ))}
    </svg>
  )
}

/** Landing hero, lower left: the full plant in jade. */
export const HERB_HERO_LEFT = [
  [STEM, 2.4, 0.5], [LEAF_1, 1.4, 1.1], [LEAF_2, 1.4, 1.4],
  [LEAF_3, 1.4, 1.7], [LEAF_4, 1.4, 2.0], [LEAF_5, 1.4, 2.3],
]

/** Landing hero, upper right: a sparser sprig in gold, mirrored and tilted. */
export const HERB_HERO_RIGHT = [
  [STEM, 2.4, 0.9], [LEAF_1, 1.4, 1.6], [LEAF_3, 1.4, 2.0], [LEAF_4, 1.4, 2.4],
]

/** Login aside: five strokes, starting sooner than the hero's. */
export const HERB_LOGIN = [
  [STEM, 2.4, 0.3], [LEAF_1, 1.4, 0.9], [LEAF_2, 1.4, 1.2],
  [LEAF_3, 1.4, 1.5], [LEAF_4, 1.4, 1.8],
]
