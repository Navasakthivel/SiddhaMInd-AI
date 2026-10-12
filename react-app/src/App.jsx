import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import PageTransition from './components/PageTransition'
import Shell from './components/Shell'
import { canAccess } from './nav'
import { useAuth } from './auth'

import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import Activate from './pages/Activate'
import AccessDenied from './pages/AccessDenied'
import AdminDashboard from './pages/AdminDashboard'
import UserManagement from './pages/UserManagement'
import CorpusUpload from './pages/CorpusUpload'
import PractitionerDashboard from './pages/PractitionerDashboard'
import StudentDashboard from './pages/StudentDashboard'
import Formulary from './pages/Formulary'
import FormularyDetail from './pages/FormularyDetail'
import SafetyChecker from './pages/SafetyChecker'
import SafetyResult from './pages/SafetyResult'
import DiagnosisIntake from './pages/DiagnosisIntake'
import DiagnosisResults from './pages/DiagnosisResults'
import Assistant from './pages/Assistant'
import Ingredients from './pages/Ingredients'
import Diseases from './pages/Diseases'
import DiseaseDetail from './pages/DiseaseDetail'
import PatientDashboard from './pages/PatientDashboard'
import DiagnosisHistory from './pages/DiagnosisHistory'
import SystemReports from './pages/SystemReports'
import Profile from './pages/Profile'

/**
 * The 16 screens.
 *
 * landing, login and access-denied render bare, exactly as the static export
 * does - they have no nav because there is no session to scope one to. Every
 * other screen is wrapped in Shell, which supplies the topbar, drawer and
 * rail, and takes its title from the nav table so the two cannot disagree.
 */
const CHROME_PAGES = [
  ['/admin-dashboard',        AdminDashboard],
  ['/user-management',        UserManagement],
  ['/corpus-upload',          CorpusUpload],
  ['/practitioner-dashboard', PractitionerDashboard],
  ['/student-dashboard',      StudentDashboard],
  ['/formulary',              Formulary],
  ['/formulary-detail',       FormularyDetail],
  ['/safety-checker',         SafetyChecker],
  ['/safety-result',          SafetyResult],
  ['/diagnosis-intake',       DiagnosisIntake],
  ['/diagnosis-results',      DiagnosisResults],
  ['/assistant',              Assistant],

  // Round B1 screens.
  ['/reports',                SystemReports],
  ['/ingredients',            Ingredients],
  ['/diseases',               Diseases],
  ['/diagnosis-history',      DiagnosisHistory],
  ['/patient-dashboard',      PatientDashboard],
  ['/profile',                Profile],
]

export default function App() {
  const location = useLocation()
  const { mustSetPassword } = useAuth()

  // An activated session that has not chosen a password goes to the
  // create-password step and nowhere else - public pages included. The server
  // refuses every other API call from such a session anyway; this keeps the UI
  // from rendering screens that could only fail.
  if (mustSetPassword && location.pathname !== '/activate') {
    return <Navigate to="/activate" replace />
  }

  return (
    /* Keyed on pathname so a route change is what swaps the page, not a
       re-render. mode is left at the default: "wait" would hold the new screen
       back until the old one finished leaving, which doubles how long
       navigation feels. */
    <AnimatePresence initial={false}>
      <Routes location={location} key={location.pathname}>
      <Route path="/" element={<PageTransition><Landing /></PageTransition>} />
      <Route path="/landing" element={<PageTransition><Landing /></PageTransition>} />
      <Route path="/login" element={<PageTransition><Login /></PageTransition>} />
      {/* Public, matching AuthInterceptor.PUBLIC_EXACT. */}
      <Route path="/register" element={<PageTransition><Register /></PageTransition>} />
      {/* Public: first sign-in with a one-time code, then the forced
          create-password step. */}
      <Route path="/activate" element={<PageTransition><Activate /></PageTransition>} />
      <Route path="/access-denied" element={<PageTransition><AccessDenied /></PageTransition>} />

      {CHROME_PAGES.map(([path, Page]) => (
        <Route key={path} path={path} element={<Chrome><Page /></Chrome>} />
      ))}

      {/* A formulary row links to a record; keep the flat design route too. */}
      <Route path="/formulary/:id" element={<Chrome><FormularyDetail /></Chrome>} />
      <Route path="/disease/:id" element={<Chrome><DiseaseDetail /></Chrome>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  )
}

/**
 * Chrome plus a route guard.
 *
 * Hiding a link is not access control - it only stops the nav offering
 * something the server would refuse. Typing the URL still has to be handled,
 * and the honest answer for a role that may not open a screen is the
 * access-denied screen, which is also the only way a user should ever reach
 * it. The server refuses the underlying API call regardless; this just means
 * the refusal is legible instead of a screen full of failed requests.
 */
function Chrome({ children }) {
  const { pathname } = useLocation()
  const { role, loading } = useAuth()

  if (!loading && role && !canAccess(role, pathname)) {
    return <Navigate to="/access-denied" replace state={{ attempted: pathname }} />
  }
  // The transition wraps the CONTENT, not Shell: fading the rail and topbar
  // on every navigation would make the furniture flicker around a page that
  // is only changing in the middle.
  // Shell derives its own title and breadcrumb from the route via nav.js, so it
  // takes no title prop - one lookup, not two that can disagree.
  return (
    <Shell>
      <PageTransition>{children}</PageTransition>
    </Shell>
  )
}
