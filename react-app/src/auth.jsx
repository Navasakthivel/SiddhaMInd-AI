import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { currentUser, SESSION_ENDED_EVENT } from './api/client'

/**
 * Who is signed in, asked once.
 *
 * The session lives in an HttpOnly cookie, so the client cannot read the role
 * out of it - only the server can say who this is. `GET /api/auth/me` is that
 * question, and it is asked once here rather than per screen: the nav needs
 * the role on every page, and a fetch per component would be one request per
 * mount for an answer that does not change.
 *
 * Three states, kept distinct because they render differently:
 *   loading  - we have not been told yet; show nothing rather than guessing
 *   signed in - `user` is set
 *   signed out - `user` is null after a 401, which is an answer, not an error
 *
 * Two flags ride along:
 *   mustSetPassword - the session was opened with an activation code and the
 *                     server will refuse everything but set-password until a
 *                     password is chosen. App routes it to /activate only.
 *   sessionEnded    - the server revoked the session (an admin suspended or
 *                     reset the account). Kept here, not only in router state,
 *                     because Shell's own "no role -> /login" redirect would
 *                     otherwise replace the state carrying the explanation.
 *                     Cleared by the next successful sign-in.
 */
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const navigate = useNavigate()
  const [user, setUserState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sessionEnded, setSessionEnded] = useState(false)

  const setUser = useCallback((u) => {
    if (u) setSessionEnded(false)
    setUserState(u)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setUser(await currentUser())
    } catch (err) {
      // 401 is the expected answer for a visitor who has not signed in. Any
      // other failure also leaves us without a role, and a nav built without a
      // role shows nothing - which is the safe direction to fail in.
      setUserState(null)
    } finally {
      setLoading(false)
    }
  }, [setUser])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    function onEnded() {
      setUserState(null)
      setSessionEnded(true)
      navigate('/login', { replace: true, state: { sessionEnded: true } })
    }
    window.addEventListener(SESSION_ENDED_EVENT, onEnded)
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded)
  }, [navigate])

  return (
    <AuthContext.Provider value={{
      user, role: user?.role ?? null, loading, refresh, setUser,
      mustSetPassword: Boolean(user?.mustSetPassword), sessionEnded,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
