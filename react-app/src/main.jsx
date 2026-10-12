import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth'
import { ThemeProvider, applyTheme, resolveInitialTheme } from './theme'
import { ToastProvider } from './components/Toast'

// The design system, imported globally rather than per component. Order
// matters: tokens.css defines the custom properties (colour, type, elevation,
// the risk palette) that siddhamind.css consumes, so it has to come first.
//
// These two files are the design as delivered and are not hand-maintained -
// the component classes are prefixed sm-* and are meant to be used, not
// rewritten. Edit them only to change the design system itself.
import './styles/tokens.css'
import './styles/siddhamind.css'
// v2 layers on top of the two delivered files rather than editing them.
import './styles/v2.css'

// Publishes window.SiddhaMind for parity with the static export's documented
// integration surface.
import './api/client'

// Paint the theme before React mounts. Doing this inside a component means
// the first frame renders with the default theme and then repaints - a
// white flash on a dark-mode machine, which is exactly what someone using
// dark mode is trying to avoid.
applyTheme(resolveInitialTheme())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Both flags opt in to behaviour React Router makes default in v7, which
        is what the console warnings are asking for. Taking them now means the
        eventual upgrade is a version bump rather than a behavioural change to
        debug:
          v7_startTransition    - route state updates wrapped in
                                  React.startTransition
          v7_relativeSplatPath  - relative links inside a splat route ("*")
                                  resolve from the matched path. This app has
                                  one splat, the catch-all that redirects to
                                  "/", so the change is inert here today. */}
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {/* Above the routes: the nav inside Shell needs the role on every page,
          and asking once here means one /api/auth/me per session rather than
          one per screen. */}
      <ThemeProvider>
        <AuthProvider>
          {/* Above the router so a toast survives the navigation that
              triggered it - "user created" is raised just before the
              screen changes. */}
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
