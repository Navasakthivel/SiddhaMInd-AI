import { useEffect, useRef, useState } from 'react'
import { Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  X, List, MagnifyingGlass, Sun, Moon, Bell, SignOut, UserCircle,
} from '@phosphor-icons/react'
import {
  getNavSectionsForRole, titleForPath, crumbForPath, ROLE_STYLE, initialsFor,
} from '../nav'
import { useAuth } from '../auth'
import { useTheme } from '../theme'
import { signOut, profile as fetchProfile } from '../api/client'
import CommandPalette, { useCommandPalette } from './CommandPalette'

/**
 * Sidebar + topbar, rebuilt to the Claude Design prototype's layout.
 *
 * FIXES BUG-01. The previous Shell put the command-palette trigger and the
 * theme toggle inside `.sm-topbar`, which the delivered stylesheet hid above
 * 640px - so on every desktop viewport both controls were in the DOM and
 * invisible, and light mode was unreachable by clicking. The chrome here owns
 * its own layout: the sidebar is a permanent column at >=760px and a slide-in
 * drawer below it, and the topbar is present at every width.
 *
 * The nav comes from getNavSectionsForRole and nowhere else. A second copy of
 * the role table is a second thing that can disagree with AuthInterceptor, and
 * the copy that disagrees quietly is the dangerous one.
 */
const MOBILE_MAX = 760

export default function Shell({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, role, loading, setUser } = useAuth()
  const { theme, toggle } = useTheme()
  const palette = useCommandPalette()

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < MOBILE_MAX)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifs, setNotifs] = useState([])

  const hamburgerRef = useRef(null)
  const notifRef = useRef(null)
  const menuRef = useRef(null)

  // One listener, not a media query per component.
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_MAX)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // A route change with the drawer open would leave it covering the page it
  // just navigated to.
  useEffect(() => {
    setDrawerOpen(false)
    setNotifOpen(false)
    setMenuOpen(false)
  }, [location.pathname])

  // Escape closes whichever overlay is open, innermost first.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (menuOpen) setMenuOpen(false)
      else if (notifOpen) setNotifOpen(false)
      else if (drawerOpen) { setDrawerOpen(false); hamburgerRef.current?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen, notifOpen, menuOpen])

  // Click-away for the two dropdowns.
  useEffect(() => {
    if (!notifOpen && !menuOpen) return undefined
    const onDown = (e) => {
      if (notifOpen && notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false)
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [notifOpen, menuOpen])

  // Notifications are real: /api/profile returns them. A failure leaves the
  // list empty rather than inventing a badge.
  useEffect(() => {
    if (!role) return undefined
    let cancelled = false
    fetchProfile()
      .then((d) => { if (!cancelled) setNotifs(d?.notifications ?? []) })
      .catch(() => { if (!cancelled) setNotifs([]) })
    return () => { cancelled = true }
  }, [role])

  async function onSignOut() {
    try {
      await signOut()
    } catch {
      // A failed logout still means this client should stop acting signed in;
      // the cookie is the server's to clear and it will expire regardless.
    }
    setUser(null)
    navigate('/login', { replace: true })
  }

  // Nothing is drawn until the server has said who this is. Rendering the
  // chrome first would flash a sidebar that grows once the role arrives.
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
        <div style={{ padding: 32 }}>
          <div style={{
            height: 22, width: '30%', borderRadius: 6,
            background: 'var(--s2)', animation: 'smPulse 1.6s ease-in-out infinite',
          }} />
        </div>
      </div>
    )
  }

  // No role means no session - every API call from here would 401 anyway.
  if (!role) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  const sections = getNavSectionsForRole(role)
  const title = titleForPath(location.pathname, role)
  const crumb = crumbForPath(location.pathname)
  const roleStyle = ROLE_STYLE[role] ?? { label: role, color: 'var(--tx)' }
  const initials = initialsFor(user)
  const unread = notifs.filter((n) => !n.read).length

  const sidebar = (
    <aside
      aria-label="Main navigation"
      style={{
        width: 'var(--sidebar-width)', flex: 'none', height: '100vh',
        top: 0, left: 0, zIndex: 50,
        background: 'var(--s1)', borderRight: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column',
        position: isMobile ? 'fixed' : 'sticky',
        transform: isMobile && !drawerOpen ? 'translateX(-100%)' : 'translateX(0)',
        transition: 'transform .3s ease',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 20px 16px',
      }}>
        <button
          onClick={() => navigate('/')}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, background: 'none',
            border: 0, color: 'var(--tx)', cursor: 'pointer', padding: 0, minHeight: 44,
          }}
        >
          <Mark />
          <span style={{ fontFamily: 'var(--serif)', fontSize: 19 }}>
            SiddhaMind{' '}
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)' }}>AI</span>
          </span>
        </button>
        {isMobile && (
          <button
            className="btn btn-secondary"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            style={{ width: 44, height: 44, padding: 0 }}
          >
            <X size={18} />
          </button>
        )}
      </div>

      <nav style={{
        flex: 1, overflow: 'auto', padding: '4px 12px',
        display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        {sections.map((group, gi) => (
          <div key={group.section ?? `g${gi}`} style={{ display: 'contents' }}>
            {group.section && (
              <div style={{
                fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase',
                color: 'var(--mu)', padding: '16px 12px 6px',
              }}>
                {group.section}
              </div>
            )}
            {group.items.map((item) => (
              <NavItem key={item.path} item={item} />
            ))}
          </div>
        ))}
      </nav>

      <div style={{
        padding: 16, borderTop: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <button
          onClick={() => navigate('/profile')}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, background: 'none',
            border: 0, padding: 0, color: 'inherit', font: 'inherit',
            cursor: 'pointer', textAlign: 'left', minHeight: 44,
          }}
        >
          <Avatar initials={initials} color={roleStyle.color} size={40} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{
              fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {user?.name ?? user?.email ?? 'Signed in'}
            </span>
            <span style={{
              alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, letterSpacing: '.04em',
              padding: '1px 8px', borderRadius: 6,
              border: `1px solid ${roleStyle.color}`, color: roleStyle.color,
            }}>
              {roleStyle.label}
            </span>
          </span>
        </button>

        <button
          className="btn btn-secondary"
          onClick={onSignOut}
          style={{ minHeight: 44, justifyContent: 'flex-start', padding: '0 12px', color: 'var(--mu)' }}
        >
          <SignOut size={18} /> Sign out
        </button>
      </div>
    </aside>
  )

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      {sidebar}

      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
          style={{
            position: 'fixed', inset: 0, zIndex: 40,
            background: 'rgba(0,0,0,.5)', animation: 'smUp .2s ease both',
          }}
        />
      )}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header style={{
          position: 'sticky', top: 0, zIndex: 30,
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px clamp(16px,3vw,32px)', minHeight: 'var(--topbar-height)',
          background: 'var(--glass)', backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--line)',
        }}>
          {isMobile && (
            <button
              ref={hamburgerRef}
              className="btn btn-secondary"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              style={{ width: 44, height: 44, padding: 0, flex: 'none' }}
            >
              <List size={20} />
            </button>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <span style={{
              fontSize: 12, color: 'var(--mu)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {crumb}
            </span>
            <h1 style={{
              fontFamily: 'var(--serif)', fontWeight: 400,
              fontSize: 'clamp(20px,2vw,26px)', margin: 0, letterSpacing: '-.01em',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {title}
            </h1>
          </div>

          {/* Visible at every width. This is the BUG-01 fix. */}
          <button
            onClick={() => palette.setOpen(true)}
            aria-label="Open command palette"
            className="sm-palette-trigger"
            style={{
              display: 'flex', alignItems: 'center', gap: 10, minHeight: 44,
              padding: '0 12px', border: '1px solid var(--line2)', borderRadius: 10,
              background: 'var(--s1)', color: 'var(--mu)', font: 'inherit',
              fontSize: 14, cursor: 'pointer', minWidth: 44,
            }}
          >
            <MagnifyingGlass size={17} />
            {!isMobile && <span style={{ width: 160, textAlign: 'left' }}>Search or jump to…</span>}
            {!isMobile && <kbd>Ctrl K</kbd>}
          </button>

          <button
            className="btn btn-secondary"
            aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            onClick={toggle}
            style={{ width: 44, height: 44, padding: 0, flex: 'none' }}
          >
            {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
          </button>

          <div style={{ position: 'relative', flex: 'none' }} ref={notifRef}>
            <button
              className="btn btn-secondary"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
              aria-expanded={notifOpen}
              onClick={() => { setNotifOpen((v) => !v); setMenuOpen(false) }}
              style={{ width: 44, height: 44, padding: 0, position: 'relative' }}
            >
              <Bell size={19} />
              {/* The dot appears only when something is actually unread. A badge
                  that is always lit teaches people to ignore it. */}
              {unread > 0 && (
                <span style={{
                  position: 'absolute', top: 10, right: 11, width: 7, height: 7,
                  borderRadius: '50%', background: 'var(--gold)',
                }} />
              )}
            </button>
            {notifOpen && (
              <Dropdown>
                <div style={{
                  padding: '8px 12px', fontSize: 12, letterSpacing: '.12em',
                  textTransform: 'uppercase', color: 'var(--mu)',
                }}>
                  Notifications
                </div>
                {notifs.length === 0 ? (
                  <div style={{ padding: '12px', fontSize: 14, color: 'var(--mu)' }}>
                    Nothing yet. Alerts about your checks and the corpus appear here.
                  </div>
                ) : notifs.slice(0, 5).map((n) => (
                  <div key={n.notifId} style={{ display: 'flex', gap: 12, padding: 12, borderRadius: 10 }}>
                    <Bell size={18} style={{ color: 'var(--gold)', marginTop: 2, flex: 'none' }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 14 }}>{n.title}</span>
                      <span style={{ fontSize: 12, color: 'var(--mu)' }}>{n.message}</span>
                    </div>
                  </div>
                ))}
                <button
                  className="btn btn-ghost"
                  onClick={() => navigate('/profile')}
                  style={{ width: '100%', minHeight: 44 }}
                >
                  View all in profile
                </button>
              </Dropdown>
            )}
          </div>

          <div style={{ position: 'relative', flex: 'none' }} ref={menuRef}>
            <button
              onClick={() => { setMenuOpen((v) => !v); setNotifOpen(false) }}
              aria-label="Profile menu"
              aria-expanded={menuOpen}
              style={{
                width: 44, height: 44, borderRadius: '50%', display: 'grid',
                placeItems: 'center', fontFamily: 'var(--serif)', fontSize: 15,
                background: 'var(--s1)', cursor: 'pointer',
                border: `1px solid ${roleStyle.color}`, color: roleStyle.color,
              }}
            >
              {initials}
            </button>
            {menuOpen && (
              <Dropdown width={240}>
                <div style={{ padding: '8px 12px 12px', display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{user?.name ?? 'Signed in'}</span>
                  <span style={{ fontSize: 12, color: 'var(--mu)' }}>{user?.email}</span>
                </div>
                <MenuItem icon={<UserCircle size={18} />} onClick={() => navigate('/profile')}>Profile</MenuItem>
                <MenuItem
                  icon={theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
                  onClick={toggle}
                >
                  {theme === 'light' ? 'Dark theme' : 'Light theme'}
                </MenuItem>
                <MenuItem icon={<SignOut size={18} />} onClick={onSignOut}>Sign out</MenuItem>
              </Dropdown>
            )}
          </div>
        </header>

        <main style={{
          flex: 1, padding: 'clamp(16px,3vw,32px)',
          maxWidth: 1280, width: '100%', boxSizing: 'border-box',
        }}>
          {children}
        </main>
      </div>

      <CommandPalette open={palette.open} onClose={palette.close} />
    </div>
  )
}

/** One sidebar row. NavLink supplies the active state; the gold bar marks it. */
function NavItem({ item }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.path}
      end
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 12, minHeight: 44,
        padding: '0 12px', border: 0, borderRadius: 10,
        font: 'inherit', fontSize: 14, fontWeight: 500,
        cursor: 'pointer', textAlign: 'left', position: 'relative',
        textDecoration: 'none',
        background: isActive ? 'var(--goldT)' : 'transparent',
        color: isActive ? 'var(--tx)' : 'var(--mu)',
        transition: 'background .2s, color .2s',
      })}
    >
      {({ isActive }) => (
        <>
          <span style={{
            position: 'absolute', left: 0, top: 10, bottom: 10, width: 2,
            borderRadius: 2, background: isActive ? 'var(--gold)' : 'transparent',
          }} />
          <Icon size={19} weight={isActive ? 'fill' : 'regular'} />
          {item.label}
        </>
      )}
    </NavLink>
  )
}

function Dropdown({ children, width = 340 }) {
  return (
    <div style={{
      position: 'absolute', right: 0, top: 52,
      width: `min(${width}px, 86vw)`,
      background: 'var(--glass)', backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid var(--line2)', borderRadius: 14, padding: 8,
      boxShadow: '0 24px 60px -20px rgba(0,0,0,.6)',
      animation: 'smUp .25s ease both',
      display: 'flex', flexDirection: 'column', zIndex: 60,
    }}>
      {children}
    </div>
  )
}

function MenuItem({ icon, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', gap: 12, alignItems: 'center', minHeight: 44,
        padding: '0 12px', border: 0, borderRadius: 10, background: 'none',
        color: 'var(--tx)', font: 'inherit', fontSize: 14, cursor: 'pointer',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--goldT)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
    >
      {icon}
      {children}
    </button>
  )
}

function Avatar({ initials, color, size }) {
  return (
    <span style={{
      width: size, height: size, flex: 'none', borderRadius: '50%',
      display: 'grid', placeItems: 'center',
      fontFamily: 'var(--serif)', fontSize: 15,
      border: `1px solid ${color}`, color,
    }}>
      {initials}
    </span>
  )
}

/** The mark from the prototype: three rotated ellipses for the three kutram. */
function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 40 40" fill="none"
         stroke="var(--gold)" strokeWidth="1.3" aria-hidden="true">
      <circle cx="20" cy="20" r="18" strokeOpacity=".5" />
      <ellipse cx="20" cy="20" rx="6" ry="15" />
      <ellipse cx="20" cy="20" rx="6" ry="15" transform="rotate(60 20 20)" />
      <ellipse cx="20" cy="20" rx="6" ry="15" transform="rotate(120 20 20)" />
      <circle cx="20" cy="20" r="2" fill="var(--gold)" />
    </svg>
  )
}
