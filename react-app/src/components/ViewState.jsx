import { useCallback, useEffect, useState } from 'react'

/**
 * The four-state container from the static design.
 *
 * The shipped CSS does the switching: a parent carrying `[data-view-state]`
 * reveals exactly the child whose `[data-state-view]` matches. That contract
 * is reproduced rather than replaced, so the same stylesheet drives it and the
 * same ids the README names stay addressable.
 *
 * `state` comes from a real request - see useRequest below - never a timer.
 */
export default function ViewState({ id, state, loading, empty, error, children }) {
  return (
    <div id={id} data-view-state={state}>
      <div data-state-view="loading">{loading}</div>
      <div data-state-view="empty">{empty}</div>
      <div data-state-view="error">{error}</div>
      <div data-state-view="ready">{children}</div>
    </div>
  )
}

/**
 * The standard empty state.
 *
 * An empty screen is an invitation to act, not a shrug - so this takes a
 * `action` and says what to do next. The illustration is inline SVG drawn from
 * the app's own vocabulary (a manuscript leaf and a search arc, the two things
 * this product is actually about) rather than a generic icon-font glyph, and
 * it is aria-hidden because it carries no information the title does not.
 */
export function EmptyState({ title, body, action, illustration = 'leaf' }) {
  return (
    <div className="sm-emptystate">
      <div className="sm-emptystate-art" aria-hidden="true">
        {illustration === 'search' ? <SearchArt /> : illustration === 'alert' ? <AlertArt /> : <LeafArt />}
      </div>
      <div className="sm-emptystate-title">{title}</div>
      {body && <p className="sm-emptystate-body">{body}</p>}
      {action && <div className="sm-emptystate-action">{action}</div>}
    </div>
  )
}

/** The standard error state. Says what failed and what to do, never apologises. */
export function ErrorState({ title = 'Could not load this', message, onRetry }) {
  return (
    <div className="sm-emptystate sm-emptystate--error">
      <div className="sm-emptystate-art" aria-hidden="true"><AlertArt /></div>
      <div className="sm-emptystate-title">{title}</div>
      {message && <p className="sm-emptystate-body">{message}</p>}
      {onRetry && (
        <div className="sm-emptystate-action">
          <button type="button" className="sm-btn sm-btn-ghost" onClick={onRetry}>Try again</button>
        </div>
      )}
    </div>
  )
}

/* — illustrations —
   Stroke-only, currentColor, one weight. They read on both themes because
   they inherit the text colour rather than carrying their own. */

function LeafArt() {
  return (
    <svg viewBox="0 0 64 64" fill="none" width="56" height="56">
      <path d="M14 50c0-18 12-31 34-34 2 20-9 34-25 35-4 .3-7 .3-9-1Z"
            stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M46 18C36 26 26 36 18 50" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity=".55" />
      <path d="M30 30h9M26 38h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity=".35" />
    </svg>
  )
}

function SearchArt() {
  return (
    <svg viewBox="0 0 64 64" fill="none" width="56" height="56">
      <circle cx="28" cy="28" r="14" stroke="currentColor" strokeWidth="1.7" />
      <path d="M38.5 38.5L52 52" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M21 26h14M21 32h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity=".45" />
    </svg>
  )
}

function AlertArt() {
  return (
    <svg viewBox="0 0 64 64" fill="none" width="56" height="56">
      <path d="M32 13 54 50H10L32 13Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M32 28v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="43" r="1.5" fill="currentColor" />
    </svg>
  )
}

/**
 * Runs an async call and reports it as one of the four view states.
 *
 * `isEmpty` decides what "empty" means for this particular call, because the
 * answer differs per screen - an empty array, a zero count, a null record.
 * Without it every successful-but-empty response would render as `ready` and
 * show a table with no rows and no explanation.
 */
export function useRequest(fn, deps = [], { isEmpty = defaultIsEmpty, skip = false } = {}) {
  const [state, setState] = useState(skip ? 'ready' : 'loading')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const run = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      const result = await fn()
      setData(result)
      setState(isEmpty(result) ? 'empty' : 'ready')
    } catch (e) {
      setError(e)
      setState('error')
    }
    // fn is redefined every render by design; deps are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    if (skip) return
    run()
  }, [run, skip])

  return { state, data, error, reload: run, setData }
}

function defaultIsEmpty(result) {
  if (result == null) return true
  if (Array.isArray(result)) return result.length === 0
  return false
}
