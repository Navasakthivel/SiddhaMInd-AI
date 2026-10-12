import { createContext, useCallback, useContext, useEffect, useState } from 'react'

/**
 * Light/dark, resolved in exactly one place.
 *
 * The resolution order is: an explicit stored choice, then the operating
 * system's preference, then dark. Whatever wins is written to
 * `document.documentElement` as `data-theme`, and tokens.css only ever reacts
 * to that attribute.
 *
 * There is deliberately no `@media (prefers-color-scheme)` rule in the
 * stylesheet. If both an attribute and a media query set the same custom
 * properties, the cascade decides which wins, and the answer flips depending
 * on which selector happens to be more specific - so someone who toggles to
 * light on a dark-mode OS gets a half-applied theme that is very hard to read
 * from the CSS alone. One mechanism, one source of truth.
 *
 * Storage is wrapped because it throws in private mode and in embedded
 * webviews with site data blocked. A theme is a convenience; losing it must
 * never take the page down with it.
 */
const STORAGE_KEY = 'siddhamind:theme'
const ThemeContext = createContext(null)

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

function systemPreference() {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** The theme to paint before React mounts. Exported so main.jsx can call it. */
export function resolveInitialTheme() {
  return readStored() ?? systemPreference()
}

/** Writes the attribute. Called on boot and on every change. */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(resolveInitialTheme)

  useEffect(() => { applyTheme(theme) }, [theme])

  // Follow the OS only while the user has not expressed a preference of their
  // own. Once they have chosen, their choice outranks the system changing
  // underneath them - otherwise sunset would silently undo their setting.
  useEffect(() => {
    if (readStored()) return undefined
    let mq
    try {
      mq = window.matchMedia('(prefers-color-scheme: light)')
    } catch {
      return undefined
    }
    const onChange = (e) => { if (!readStored()) setThemeState(e.matches ? 'light' : 'dark') }
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  const setTheme = useCallback((next) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Blocked storage means the choice lasts for this tab only, which is a
      // better outcome than refusing to switch at all.
    }
  }, [])

  const toggle = useCallback(() => {
    setThemeState((cur) => {
      const next = cur === 'light' ? 'dark' : 'light'
      try { localStorage.setItem(STORAGE_KEY, next) } catch { /* see above */ }
      return next
    })
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
