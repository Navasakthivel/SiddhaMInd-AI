import {
  SquaresFour, UsersThree, Books, ChartBar, HouseLine, Stethoscope,
  ClockCounterClockwise, ShieldCheck, ShieldWarning, Flask, Leaf,
  ListBullets, ChatCircleText, UserCircle, LockKey,
} from '@phosphor-icons/react'

/**
 * The navigation, and who may see each entry.
 *
 * `roles` MIRRORS AuthInterceptor.RULES on the Java side, which is the real
 * enforcement - this file decides nothing. The nav's only job is to never offer
 * a destination the server will refuse, because a link that 403s tells the user
 * the application is broken when it is in fact working correctly.
 *
 * WHAT `roles` IS ACTUALLY MIRRORING. These paths are React Router paths; they
 * never reach Java, so AuthInterceptor never sees "/diagnosis-history". What it
 * does see are the /api/** calls each screen makes, and those are what the roles
 * below are taken from:
 *
 *     screen                  calls                        rule      allowed
 *     /admin-dashboard        /api/admin/stats             /admin    ADMIN
 *     /user-management        /api/admin/users             /admin    ADMIN
 *     /corpus-upload          /api/admin/corpus            /admin    ADMIN
 *     /reports                /api/admin/reports           /admin    ADMIN
 *     /practitioner-dashboard /api/practitioner/dashboard  /practitioner  PRACTITIONER, ADMIN
 *     /student-dashboard      /api/student/dashboard       /student  STUDENT, ADMIN
 *     /patient-dashboard      /api/patient/dashboard       /patient  PATIENT, ADMIN
 *     /diagnosis-intake       /api/diagnosis/compute       /diagnosis     PRACTITIONER, ADMIN
 *     /diagnosis-results      (router state)               /diagnosis     PRACTITIONER, ADMIN
 *     /diagnosis-history      /api/diagnosis/history       /diagnosis     PRACTITIONER, ADMIN
 *     /safety-checker         /api/safety/check            /safety   ADMIN, PRACTITIONER, STUDENT
 *     /safety-result          (router state)               /safety   ADMIN, PRACTITIONER, STUDENT
 *     /formulary              /api/formulary               (none)    any signed-in
 *     /ingredients            /api/formulary/ingredients   (none)    any signed-in
 *     /diseases               /api/formulary/diseases      (none)    any signed-in
 *     /assistant              /api/assistant/*             (none)    any signed-in
 *     /profile                /api/profile                 (none)    any signed-in
 *
 * A mismatch here is not a security hole - the server still refuses - but it is
 * a menu item that leads to a broken screen, which is how users learn to
 * distrust the whole app.
 *
 * NOT IN THIS LIST, deliberately:
 *   /landing /login /register   pre-auth screens. Reaching them from inside a
 *                               session is not navigation, it is signing out by
 *                               accident. /register is public on the server too
 *                               (AuthInterceptor.PUBLIC_EXACT).
 *   /access-denied              reached only by a refusal. Offering it as a menu
 *                               item invites someone to go and look at the error
 *                               page, which is not a place you visit on purpose.
 *   /formulary-detail           reached from a formulary row, not the menu.
 *   /disease/:id                reached from a disease row, not the menu.
 * All still have routes and still render; they are simply not somewhere the
 * sidebar sends a signed-in user.
 */

/** Every role the backend issues. Used for "any signed-in user". */
export const ALL_ROLES = ['ADMIN', 'PRACTITIONER', 'STUDENT', 'PATIENT']

const PRAC = ['PRACTITIONER', 'ADMIN']
const ADMIN_ONLY = ['ADMIN']

/**
 * Sidebar entries, in display order, with the section headings the prototype
 * groups them under. A heading is rendered only when at least one item beneath
 * it survives the role filter, so a role never sees an empty "Administration".
 */
export const NAV_ITEMS = [
  // ---- Administration ----
  // `adminLabel` replaces `label` for ADMIN only. An admin sees three
  // dashboards - their own and the practitioner's and student's - and three
  // items all called "Dashboard" gave no way to tell them apart. Every other
  // role sees only its own, so "Dashboard" stays unambiguous for them.
  { path: '/admin-dashboard', label: 'Dashboard', adminLabel: 'Admin dashboard', icon: SquaresFour, section: 'Administration', roles: ADMIN_ONLY },
  { path: '/user-management', label: 'User management', icon: UsersThree, section: 'Administration', roles: ADMIN_ONLY },
  { path: '/corpus-upload', label: 'Corpus', icon: Books, section: 'Administration', roles: ADMIN_ONLY },
  { path: '/reports', label: 'System reports', icon: ChartBar, section: 'Administration', roles: ADMIN_ONLY },

  // ---- role landing pages ----
  { path: '/practitioner-dashboard', label: 'Dashboard', adminLabel: 'Practitioner view', icon: SquaresFour, section: null, roles: PRAC },
  { path: '/student-dashboard', label: 'Dashboard', adminLabel: 'Student view', icon: SquaresFour, section: null, roles: ['STUDENT', 'ADMIN'] },
  { path: '/patient-dashboard', label: 'Home', icon: HouseLine, section: null, roles: ['PATIENT', 'ADMIN'] },

  // ---- Clinical ----
  { path: '/diagnosis-intake', label: 'New examination', icon: Stethoscope, section: 'Clinical', roles: PRAC },
  { path: '/diagnosis-history', label: 'Diagnosis history', icon: ClockCounterClockwise, section: 'Clinical', roles: PRAC },
  { path: '/safety-checker', label: 'Safety checker', icon: ShieldCheck, section: 'Clinical', roles: ['ADMIN', 'PRACTITIONER', 'STUDENT'] },

  // ---- Knowledge ----
  { path: '/formulary', label: 'Formulary', icon: Flask, section: 'Knowledge', roles: ALL_ROLES },
  { path: '/ingredients', label: 'Ingredients', icon: Leaf, section: 'Knowledge', roles: ALL_ROLES },
  { path: '/diseases', label: 'Diseases (Noi)', icon: ListBullets, section: 'Knowledge', roles: ALL_ROLES },
  { path: '/assistant', label: 'Assistant', icon: ChatCircleText, section: 'Knowledge', roles: ALL_ROLES },
]

/**
 * Screens that have a route and a title but never appear in the sidebar.
 * Kept beside NAV_ITEMS so removing a menu entry cannot silently leave its page
 * titled "SiddhaMind AI".
 */
export const OFF_NAV = [
  { path: '/profile', label: 'Profile', icon: UserCircle, roles: ALL_ROLES },
  { path: '/diagnosis-results', label: 'Diagnosis result', icon: Stethoscope, roles: PRAC },
  { path: '/safety-result', label: 'Safety result', icon: ShieldWarning, roles: ['ADMIN', 'PRACTITIONER', 'STUDENT'] },
  { path: '/formulary-detail', label: 'Formulation', icon: Flask, roles: ALL_ROLES },
  { path: '/disease', label: 'Disease', icon: ListBullets, roles: ALL_ROLES },
  { path: '/access-denied', label: 'Access denied', icon: LockKey, roles: ALL_ROLES },
]

const PRE_AUTH_TITLES = {
  '/': 'SiddhaMind AI',
  '/landing': 'SiddhaMind AI',
  '/login': 'Sign in',
  '/register': 'Create an account',
}

/** Every routed screen, for title and access lookups. */
const ALL_ENTRIES = [...NAV_ITEMS, ...OFF_NAV]

/**
 * The nav for one role.
 *
 * The ONLY place nav is filtered. Every component that renders navigation - the
 * sidebar and the drawer today, the command palette as well - goes through here,
 * for the same reason AuthInterceptor matches /api/** against the table it
 * already uses for pages: two copies of an authorisation decision are two things
 * that can disagree, and the one that disagrees quietly is the dangerous one.
 *
 * An unknown or absent role returns nothing rather than everything. A nav that
 * failed open would show the admin menu to a session whose role could not be read.
 */
export function getNavForRole(role) {
  if (!role) return []
  return NAV_ITEMS
    .filter((item) => item.roles.includes(role))
    .map((item) => labelledFor(item, role))
}

/** The entry with the label this role sees. See `adminLabel` on NAV_ITEMS. */
function labelledFor(item, role) {
  return role === 'ADMIN' && item.adminLabel ? { ...item, label: item.adminLabel } : item
}

/**
 * The same list, grouped into the prototype's sections.
 *
 * Returns `[{ section, items }]`. A section with no surviving items is dropped
 * entirely rather than rendered empty, and items with `section: null` come first
 * in an unlabelled group - that is where each role's own dashboard sits.
 */
export function getNavSectionsForRole(role) {
  const items = getNavForRole(role)
  const groups = []
  for (const item of items) {
    const key = item.section ?? null
    const last = groups[groups.length - 1]
    if (last && last.section === key) last.items.push(item)
    else groups.push({ section: key, items: [item] })
  }
  return groups.filter((g) => g.items.length > 0)
}

/** Longest-prefix match, so /disease/7 resolves to the /disease entry. */
function entryFor(path) {
  let best = null
  for (const e of ALL_ENTRIES) {
    if (path === e.path || path.startsWith(e.path + '/')) {
      if (!best || e.path.length > best.path.length) best = e
    }
  }
  return best
}

/** `role` is optional; given ADMIN, the title matches the admin's sidebar label. */
export function titleForPath(path, role) {
  const entry = entryFor(path)
  return (entry && labelledFor(entry, role).label) ?? PRE_AUTH_TITLES[path] ?? 'SiddhaMind AI'
}

/** The section a path sits under, shown as the breadcrumb above the title. */
export function crumbForPath(path) {
  const entry = entryFor(path)
  if (!entry) return ''
  return NAV_ITEMS.includes(entry) ? (entry.section ?? 'SiddhaMind AI') : 'SiddhaMind AI'
}

export function iconForPath(path) {
  return entryFor(path)?.icon ?? null
}

/** Whether a role may open a path, for guarding a route as well as a link. */
export function canAccess(role, path) {
  if (!role) return false
  const entry = entryFor(path)
  // Not in the table means not role-restricted - the same "authenticated and not
  // covered by a rule" branch the Java interceptor ends on.
  return entry ? entry.roles.includes(role) : true
}

/**
 * Per-role identity shown on the user card, matching the prototype's ROLES map.
 * The colour is the role's own, never the risk palette.
 */
export const ROLE_STYLE = {
  ADMIN: { label: 'Admin', color: 'var(--gold)' },
  PRACTITIONER: { label: 'Practitioner', color: 'var(--jade)' },
  STUDENT: { label: 'Student', color: 'var(--va)' },
  PATIENT: { label: 'Patient', color: 'var(--tx)' },
}

/** Initials for the avatar. Falls back to the email when there is no name. */
export function initialsFor(user) {
  const source = (user?.name ?? user?.email ?? '').trim()
  if (!source) return '·'
  const words = source.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}
