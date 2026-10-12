import { motion, useReducedMotion } from 'framer-motion'

/**
 * Route-change transition.
 *
 * Deliberately short. A page transition is the one piece of motion in an app
 * that sits directly between a person's intent and the result, so every
 * millisecond of it is added latency they did not ask for. 160ms reads as
 * "the page changed"; 400ms reads as "the app is slow", and on a clinical tool
 * that someone uses forty times a shift it becomes the dominant impression.
 *
 * `mode="wait"` is NOT used by the caller: waiting for the outgoing screen to
 * finish before the incoming one starts doubles the perceived duration. These
 * cross-fade over each other instead, which is why the exit is shorter than
 * the enter.
 *
 * Opacity is animated on the page *container* only. Nothing inside a clinical
 * screen - a verdict, a risk badge, a citation, a dosha percentage - is gated
 * by this: by the time a screen's content exists, its wrapper has already
 * reached opacity 1, and the constraint those elements carry is about their
 * own entrance animations, not about the route change that brought them here.
 */
export default function PageTransition({ children }) {
  const reduce = useReducedMotion()

  if (reduce) {
    // No wrapper animation at all - not even a fast one. A 1ms opacity
    // transition still creates a paint the person asked not to have.
    return <div className="sm-page-transition">{children}</div>
  }

  return (
    <motion.div
      className="sm-page-transition"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{
        duration: 0.16,
        ease: [0.2, 0.8, 0.3, 1],
        exit: { duration: 0.11 },
      }}
    >
      {children}
    </motion.div>
  )
}
