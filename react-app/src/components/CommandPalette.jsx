import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { getNavForRole } from '../nav'
import { useAuth } from '../auth'

/**
 * Cmd/Ctrl+K navigation.
 *
 * The list comes from `getNavForRole`, not from NAV_ITEMS directly. That is
 * the same rule the rail and the drawer follow, and it matters more here than
 * in either of them: a palette is a search box, so it invites someone to type
 * the name of a screen they have heard of. Filtering NAV_ITEMS locally would
 * let a student type "users" and find an admin screen that the server will
 * then refuse - which teaches them the app is broken rather than that the
 * screen is not theirs.
 *
 * Fuzzy matching is subsequence-based, not Levenshtein: "usrmgt" should find
 * "User management", and typo-correction is the wrong trade here because a
 * wrong-but-close match in a navigation list sends you somewhere you did not
 * ask for.
 */
export default function CommandPalette({ open, onClose }) {
  const { role } = useAuth()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const restoreFocusTo = useRef(null)

  const items = useMemo(() => getNavForRole(role), [role])
  const results = useMemo(() => filterNav(items, query), [items, query])

  // Reset per opening, so the palette never reopens showing the last search.
  useEffect(() => {
    if (!open) return undefined
    restoreFocusTo.current = document.activeElement
    setQuery('')
    setActive(0)
    // Focus after paint; focusing during the enter animation makes some
    // browsers scroll the dialog into view mid-transform.
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [open])

  // Focus goes back where it came from, or a keyboard user is dumped at the
  // top of the document every time they dismiss the palette.
  useEffect(() => {
    if (open) return
    const el = restoreFocusTo.current
    if (el && typeof el.focus === 'function') el.focus()
  }, [open])

  useEffect(() => { setActive(0) }, [query])

  const go = useCallback((item) => {
    if (!item) return
    onClose()
    navigate(item.path)
  }, [navigate, onClose])

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (results.length ? (i + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(results[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Tab') {
      // The palette is the only thing on screen while it is open; letting Tab
      // walk into the page behind it is what makes a dialog feel unfinished.
      e.preventDefault()
    }
  }

  // Keep the highlighted row visible when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="sm-palette-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.08 : 0.16 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
        >
          {/* The one aurora moment in the chrome. Decorative, aria-hidden. */}
          <div className="sm-palette-aurora" aria-hidden="true" />

          <motion.div
            className="sm-palette sm-glass"
            role="dialog"
            aria-modal="true"
            aria-label="Go to screen"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.98 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.985 }}
            transition={{ duration: reduce ? 0.1 : 0.2, ease: [0.2, 0.8, 0.3, 1] }}
            onKeyDown={onKeyDown}
          >
            <div className="sm-palette-field">
              <SearchGlyph />
              <input
                ref={inputRef}
                className="sm-palette-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Go to a screen"
                aria-label="Search screens"
                aria-controls="sm-palette-list"
                aria-activedescendant={results[active] ? `sm-palette-opt-${active}` : undefined}
                autoComplete="off"
                spellCheck="false"
              />
              <kbd className="sm-palette-kbd">Esc</kbd>
            </div>

            <div className="sm-palette-list" id="sm-palette-list" role="listbox" ref={listRef}>
              {results.length === 0 ? (
                <div className="sm-palette-empty">
                  No screen matches “{query}”. Only screens your role can open are listed.
                </div>
              ) : (
                results.map((item, i) => (
                  <button
                    key={item.path}
                    id={`sm-palette-opt-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    data-active={i === active}
                    className="sm-palette-row"
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(item)}
                  >
                    <span className="sm-palette-glyph" aria-hidden="true">{item.glyph}</span>
                    <span className="sm-palette-label">{item.label}</span>
                    <span className="sm-palette-path">{item.path}</span>
                  </button>
                ))
              )}
            </div>

            <div className="sm-palette-foot">
              <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
              <span><kbd>↵</kbd> open</span>
              <span>Showing screens for {role ?? 'your role'}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/**
 * Subsequence match over label and path, ranked so that a contiguous hit in
 * the label beats a scattered one across the path.
 */
function filterNav(items, query) {
  const q = query.trim().toLowerCase()
  if (!q) return items
  const scored = []
  for (const item of items) {
    const label = item.label.toLowerCase()
    const path = item.path.toLowerCase()
    let score = null
    if (label.includes(q)) score = 0 + label.indexOf(q) / 100
    else if (path.includes(q)) score = 1 + path.indexOf(q) / 100
    else if (isSubsequence(q, label)) score = 2
    else if (isSubsequence(q, path)) score = 3
    if (score !== null) scored.push({ item, score })
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.item)
}

function isSubsequence(needle, haystack) {
  let i = 0
  for (let j = 0; j < haystack.length && i < needle.length; j += 1) {
    if (haystack[j] === needle[i]) i += 1
  }
  return i === needle.length
}

function SearchGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

/** Owns the Cmd/Ctrl+K listener so Shell does not have to. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return { open, setOpen, close: useCallback(() => setOpen(false), []) }
}
