import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

/**
 * Toasts: confirmation that something a person did actually happened.
 *
 * Scope, deliberately narrow: a toast says "this succeeded". It never carries
 * a validation message, because a field error has to stay on screen next to
 * the field it is about - a message that slides away after four seconds is
 * useless for fixing an input, and worse, it moves the eye away from the thing
 * that needs correcting. Inline error states are not replaced by this; they
 * are the other half of the pair.
 *
 * `error` exists here only for actions with no field to attach to - an upload
 * that failed, an ingest the AI service refused. Those have no inline home.
 *
 * The stack is capped. A person who clicks a button six times gets six
 * confirmations otherwise, and the sixth covers the page.
 */
const ToastContext = createContext(null)
const MAX_VISIBLE = 3
const DEFAULT_MS = 4200

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())
  const seq = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    const handle = timers.current.get(id)
    if (handle) {
      clearTimeout(handle)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback((message, { tone = 'success', duration = DEFAULT_MS, detail } = {}) => {
    if (!message) return null
    seq.current += 1
    const id = seq.current
    setToasts((list) => [...list, { id, message, detail, tone }].slice(-MAX_VISIBLE))
    if (duration > 0) {
      timers.current.set(id, setTimeout(() => dismiss(id), duration))
    }
    return id
  }, [dismiss])

  const api = useMemo(() => ({
    push,
    dismiss,
    success: (message, opts) => push(message, { ...opts, tone: 'success' }),
    // Failures hold longer: they are read, not just noticed.
    error: (message, opts) => push(message, { tone: 'error', duration: 7000, ...opts }),
    info: (message, opts) => push(message, { ...opts, tone: 'info' }),
  }), [push, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function ToastViewport({ toasts, onDismiss }) {
  const reduce = useReducedMotion()

  return (
    <div className="sm-toast-viewport" role="region" aria-label="Notifications">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`sm-toast sm-glass sm-toast--${t.tone}`}
            /* Reduced motion cross-fades in place instead of travelling. The
               toast still appears and still leaves; only the distance goes. */
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 28, scale: 0.96 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: 28, scale: 0.96 }}
            transition={{ duration: reduce ? 0.12 : 0.26, ease: [0.2, 0.8, 0.3, 1] }}
            layout={!reduce}
            /* assertive for failures so a screen reader interrupts; polite for
               confirmations, which can wait for a gap in speech. */
            role={t.tone === 'error' ? 'alert' : 'status'}
            aria-live={t.tone === 'error' ? 'assertive' : 'polite'}
          >
            <span className="sm-toast-mark" aria-hidden="true">
              {t.tone === 'error' ? <ExclamationMark /> : <CheckMark />}
            </span>
            <div className="sm-toast-text">
              <div className="sm-toast-message">{t.message}</div>
              {t.detail && <div className="sm-toast-detail">{t.detail}</div>}
            </div>
            <button
              type="button"
              className="sm-toast-close"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function CheckMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M3 8.5L6.2 11.5L13 4.5" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ExclamationMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 4v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="8" cy="11.8" r="1.05" fill="currentColor" />
    </svg>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
