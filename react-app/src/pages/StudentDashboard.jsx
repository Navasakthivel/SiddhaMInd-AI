import { useNavigate } from 'react-router-dom'
import { Buildings, IdentificationCard, ChatCircleText } from '@phosphor-icons/react'
import { studentDashboard, searchFormulary } from '../api/client'
import { useAuth } from '../auth'
import { useRequest } from '../components/ViewState'
import { Loading, ErrorNote, fmtDate } from '../components/ui'
import { lift, drop } from '../components/bits'

/**
 * 15 Student dashboard.
 *
 * WHAT WAS WRONG HERE ORIGINALLY. The first version was ported from the static
 * export "with its content intact", and that content was invented: a student
 * named Kavitha R. in Year 3, "3 saved" past checks, and a formulary of "1,284
 * entries" that actually holds ten. A student who reads 1,284 and finds ten
 * concludes the search is broken, when it is the label that is lying.
 *
 * Two real requests now back this screen: GET /api/student/dashboard for the
 * counts and the student's own chat sessions, and GET /api/formulary for the
 * study grid - the dashboard endpoint returns formulationCount but not the
 * formulations themselves, and a count is not a grid.
 *
 * Institution and registration number come from the session (/api/auth/me
 * returns both). Year of study does not exist on the user record, so it is not
 * claimed, and each pill is omitted when its field is empty rather than shown
 * with a dash that looks like a missing value in the database.
 */
export default function StudentDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const dash = useRequest(() => studentDashboard(), [], { isEmpty: () => false })
  const forms = useRequest(() => searchFormulary(''), [], { isEmpty: () => false })

  if (dash.state === 'loading') return <Loading rows={5} />
  if (dash.state === 'error') return <ErrorNote message={dash.error?.message} onRetry={dash.reload} />

  const d = dash.data ?? {}
  const chats = d.myChats ?? []
  const study = forms.data?.results ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        {user?.institution && (
          <Pill Icon={Buildings}>{user.institution}</Pill>
        )}
        {user?.regNumber && (
          <Pill Icon={IdentificationCard}>
            Reg. no. <span style={{ fontFamily: 'var(--mono)' }}>{user.regNumber}</span>
          </Pill>
        )}
        <Pill Icon={ChatCircleText}>
          {d.ingredientCount ?? 0} ingredients &middot; {d.diseaseCount ?? 0} noi
        </Pill>
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 22, margin: 0 }}>
            Formulations to study
          </h2>
          <button className="btn btn-ghost" onClick={() => navigate('/formulary')} style={{ minHeight: 40 }}>
            Full formulary
          </button>
        </div>

        {forms.state === 'loading' && <Loading rows={3} />}
        {forms.state === 'error' && <ErrorNote message={forms.error?.message} onRetry={forms.reload} />}
        {forms.state === 'ready' && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,240px),1fr))',
            gap: 16,
          }}>
            {study.map((f, i) => (
              <button key={f.formId} onClick={() => navigate(`/formulary/${f.formId}`)} style={{
                textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer',
                background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
                padding: 20, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 150,
                animation: 'smUp .5s ease both', animationDelay: `${Math.min(i, 8) * 0.04}s`,
                transition: 'transform .25s, box-shadow .25s, border-color .25s',
              }} onMouseEnter={lift} onMouseLeave={drop}>
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)' }}>
                    {f.sfiCode || '—'}
                  </span>
                  {f.containsHeavyMetal && (
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 6,
                      border: '1px solid var(--amb)', color: 'var(--amb)', whiteSpace: 'nowrap',
                    }}>
                      Heavy metal
                    </span>
                  )}
                </span>
                <span style={{ fontFamily: 'var(--tamil)', fontSize: 18, lineHeight: 1.4 }}>
                  {f.nameTamil}
                </span>
                <span style={{ fontFamily: 'var(--serif)', fontSize: 18, flex: 1 }}>{f.nameEnglish}</span>
                <span style={{ fontSize: 12, color: 'var(--mu)' }}>{f.dosageForm || '—'}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section style={{
        background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
        padding: 24, display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 12, marginBottom: 8,
        }}>
          <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20, margin: 0 }}>
            My past assistant chats
          </h2>
          <button className="btn btn-ghost" onClick={() => navigate('/assistant')} style={{ minHeight: 40 }}>
            Open assistant
          </button>
        </div>
        {chats.length === 0 ? (
          <span style={{ fontSize: 14, color: 'var(--mu)' }}>
            You have not asked the assistant anything yet. Every answer it gives
            cites the book, page and verse it came from.
          </span>
        ) : chats.map((c) => (
          <button key={c.chatId} onClick={() => navigate(`/assistant?chat=${c.chatId}`)} style={{
            display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0',
            border: 0, borderTop: '1px solid var(--line)', background: 'none',
            color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer', minHeight: 56,
          }}>
            <ChatCircleText size={19} style={{ color: 'var(--gold)', flex: 'none' }} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 500, minWidth: 0 }}>
              {c.title || 'Untitled conversation'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--mu)', whiteSpace: 'nowrap' }}>
              {c.messageCount ?? 0} {c.messageCount === 1 ? 'message' : 'messages'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--mu)', textAlign: 'right', whiteSpace: 'nowrap' }}>
              {fmtDate(c.lastMessageAt ?? c.createdAt)}
            </span>
          </button>
        ))}
      </section>
    </div>
  )
}

function Pill({ Icon, children }) {
  return (
    <span style={{
      display: 'inline-flex', gap: 8, alignItems: 'center', padding: '8px 14px',
      borderRadius: 999, border: '1px solid var(--line2)', fontSize: 13,
    }}>
      <Icon size={16} style={{ color: 'var(--va)', flex: 'none' }} />
      {children}
    </span>
  )
}
