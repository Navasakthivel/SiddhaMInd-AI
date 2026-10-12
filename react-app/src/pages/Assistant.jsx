import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useReducedMotion } from 'framer-motion'
import {
  Plus, ChatCircleText, PaperPlaneRight, BookOpen, Plugs, Flask,
} from '@phosphor-icons/react'
import {
  assistantStatus, assistantChats, assistantChat, askAssistant,
} from '../api/client'
import { Mark, fmtDate } from '../components/ui'

/**
 * 20 Assistant.
 *
 * Four endpoints: /assistant/status for the liveness pill, /assistant/chats for
 * the sidebar, /assistant/chats/{id} to reopen one, /assistant/ask to send.
 *
 * THREE THINGS THIS SCREEN DELIBERATELY DOES NOT DO.
 *
 * 1. It does not show a match score beside a citation. The server strips it on
 *    purpose: the value is an RRF fusion rank, and a number printed next to a
 *    source reads as a confidence in the answer, which it is not. The prototype
 *    draws "match 0.87"; that field does not exist on the wire.
 *
 * 2. It does not treat "not found in corpus" as an error. The server returns
 *    three statuses - cited, notfound, error - and they mean different things.
 *    An outage rendered as "the books do not cover this" would be a false
 *    negative about the corpus, so each gets its own panel below.
 *
 * 3. It does not invent a reachability claim. The pill reflects
 *    HttpAiQueryAdapter's cached /health probe, so "Connected" means the service
 *    answered, not that a base-url is configured.
 *
 * The typing reveal is presentation only. /ask is a single POST, not a stream -
 * the whole answer is in hand before the first character appears - so the
 * reveal is capped short and skipped entirely under prefers-reduced-motion. It
 * never gates the citations, which render with the text.
 */
export default function Assistant() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const reduced = useReducedMotion()

  const [online, setOnline] = useState(null)
  const [chats, setChats] = useState([])
  const [chatId, setChatId] = useState(() => {
    const raw = params.get('chat')
    return raw && /^\d+$/.test(raw) ? Number(raw) : null
  })
  const [turns, setTurns] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const scrollRef = useRef(null)

  const refreshChats = useCallback(async () => {
    try {
      const r = await assistantChats()
      setChats(r?.chats ?? [])
    } catch {
      // The sidebar is not load-bearing. A failure here must not stop someone
      // asking a question, so it stays empty rather than blocking the screen.
      setChats([])
    }
  }, [])

  useEffect(() => {
    assistantStatus().then((r) => setOnline(Boolean(r?.aiAvailable))).catch(() => setOnline(false))
    refreshChats()
  }, [refreshChats])

  // Open a conversation named in the URL, so a link from a dashboard lands on it.
  useEffect(() => {
    if (chatId == null) { setTurns([]); return undefined }
    let cancelled = false
    setLoadError(null)
    assistantChat(chatId)
      .then((c) => {
        if (cancelled) return
        setTurns(replay(c?.messages ?? []))
      })
      .catch((e) => { if (!cancelled) setLoadError(e.message) })
    return () => { cancelled = true }
  }, [chatId])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, sending])

  function openChat(id) {
    setChatId(id)
    setParams(id == null ? {} : { chat: String(id) }, { replace: true })
  }

  async function send(e) {
    e?.preventDefault()
    const q = draft.trim()
    if (!q || sending) return
    setDraft('')
    setSending(true)
    setTurns((t) => [...t, { kind: 'q', body: q }])
    try {
      const r = await askAssistant(q, chatId ?? undefined)
      if (r?.chatId && r.chatId !== chatId) {
        setChatId(r.chatId)
        setParams({ chat: String(r.chatId) }, { replace: true })
      }
      setTurns((t) => [...t, {
        kind: 'a',
        status: r?.status ?? 'error',
        body: r?.body ?? '',
        citations: r?.citations ?? [],
        fresh: true,
      }])
      refreshChats()
    } catch (err) {
      // A thrown request is a transport failure, which is the offline case -
      // distinct from the server answering with status "error".
      setOnline(false)
      setTurns((t) => [...t, { kind: 'a', status: 'offline', body: err.message, citations: [] }])
    } finally {
      setSending(false)
    }
  }

  const pill = online == null ? 'var(--mu)' : online ? 'var(--jade)' : 'var(--red)'

  return (
    <div style={{
      display: 'flex', gap: 24, minWidth: 0,
      minHeight: 'calc(100vh - 136px)',
    }}>
      <aside aria-label="Past chats" className="sm-chat-aside"
             style={{ width: 260, flex: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button className="btn btn-primary" onClick={() => openChat(null)} style={{ minHeight: 44 }}>
          <Plus size={16} /> New chat
        </button>
        <span style={{
          fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase',
          color: 'var(--mu)', padding: '16px 4px 4px',
        }}>
          Past chats
        </span>
        {chats.length === 0 ? (
          <span style={{ fontSize: 13, color: 'var(--mu)', padding: '0 4px' }}>
            Nothing yet. Your questions are saved here once you ask one.
          </span>
        ) : chats.map((c) => {
          const on = c.chatId === chatId
          return (
            <button key={c.chatId} onClick={() => openChat(c.chatId)} style={{
              display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12,
              borderRadius: 10, font: 'inherit', textAlign: 'left', cursor: 'pointer',
              minHeight: 44, background: on ? 'var(--goldT)' : 'none',
              border: `1px solid ${on ? 'var(--gold)' : 'var(--line)'}`,
              color: 'var(--mu)',
            }}>
              <ChatCircleText size={17} style={{ marginTop: 3, flex: 'none' }} />
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--tx)' }}>
                  {c.title || 'Untitled conversation'}
                </span>
                <span style={{ fontSize: 12 }}>{fmtDate(c.lastMessageAt ?? c.createdAt)}</span>
              </span>
            </button>
          )
        })}
      </aside>

      <section style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
        overflow: 'hidden',
      }}>
        {/* Below 900px the sidebar is hidden and the same chats appear as a strip. */}
        <div aria-label="Past chats" className="sm-chat-strip" style={{
          display: 'none', gap: 8, overflowX: 'auto',
          padding: '12px 16px', borderBottom: '1px solid var(--line)',
        }}>
          <button className="btn btn-primary" onClick={() => openChat(null)}
                  style={{ minHeight: 40, flex: 'none' }}>
            <Plus size={15} /> New
          </button>
          {chats.map((c) => {
            const on = c.chatId === chatId
            return (
              <button key={c.chatId} onClick={() => openChat(c.chatId)} style={{
                flex: 'none', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', minHeight: 40, padding: '0 14px', borderRadius: 999,
                font: 'inherit', fontSize: 13, cursor: 'pointer',
                background: on ? 'var(--goldT)' : 'none',
                border: `1px solid ${on ? 'var(--gold)' : 'var(--line2)'}`,
                color: on ? 'var(--gold)' : 'var(--mu)',
              }}>
                {c.title || 'Untitled'}
              </button>
            )
          })}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          borderBottom: '1px solid var(--line)', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, color: 'var(--mu)', flex: 1, minWidth: 0 }}>
            Answers only from the indexed corpus
          </span>
          <span role="status" style={{
            display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '0 12px',
            borderRadius: 999, border: `1px solid ${pill}`, color: pill,
            fontSize: 12, fontWeight: 600,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: pill }} />
            {online == null ? 'Checking…' : online ? 'Connected' : 'Offline'}
          </span>
        </div>

        <div ref={scrollRef} style={{
          flex: 1, overflow: 'auto', padding: 'clamp(16px,3vw,32px)',
          display: 'flex', flexDirection: 'column', gap: 24,
        }}>
          {loadError && (
            <Panel tone="amb" Icon={BookOpen} title="That conversation is not available">
              {loadError} The assistant answers 404 both for a chat that does not
              exist and for one belonging to someone else, so this does not tell
              you which.
            </Panel>
          )}

          {turns.length === 0 && !loadError && (
            <Opening onPick={(q) => setDraft(q)} />
          )}

          {turns.map((t, i) => t.kind === 'q' ? (
            <div key={i} style={{
              alignSelf: 'flex-end', maxWidth: '80%', padding: '12px 16px',
              borderRadius: '14px 14px 4px 14px', background: 'var(--s3)', fontSize: 15,
            }}>
              {t.body}
            </div>
          ) : (
            <Answer key={i} turn={t} reduced={reduced} onFormulary={() => navigate('/formulary')} />
          ))}

          {sending && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <Avatar />
              <div aria-label="Assistant is thinking" style={{ display: 'flex', gap: 6, padding: '14px 0' }}>
                {[0, 0.15, 0.3].map((d) => (
                  <span key={d} style={{
                    width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)',
                    animation: 'smDot 1.2s infinite', animationDelay: `${d}s`,
                  }} />
                ))}
              </div>
            </div>
          )}
        </div>

        <form onSubmit={send} style={{
          display: 'flex', gap: 8, alignItems: 'flex-end', padding: 16,
          borderTop: '1px solid var(--line)',
        }}>
          <textarea className="input" value={draft} rows={1}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e) }
                    }}
                    placeholder="Ask in English or &#3980;&#2990;&#3007;&#2996;&#3021;"
                    aria-label="Message"
                    style={{
                      minHeight: 48, resize: 'none', fontFamily: 'var(--sans)',
                      background: 'var(--s2)',
                    }} />
          <button type="submit" className="btn btn-primary" aria-label="Send" disabled={sending}
                  style={{ width: 48, height: 48, padding: 0, flex: 'none' }}>
            <PaperPlaneRight size={19} />
          </button>
        </form>
      </section>
    </div>
  )
}

/**
 * One assistant turn.
 *
 * cited / notfound / error come from the server; offline is added by the caller
 * when the request itself never landed. They are four different things and each
 * says which it is.
 */
function Answer({ turn, reduced, onFormulary }) {
  const text = useTypedText(turn.body, turn.fresh && !reduced && turn.status === 'cited')
  const typing = text.length < (turn.body?.length ?? 0)

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', maxWidth: 760 }}>
      <Avatar />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {turn.status === 'cited' && (
          <>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, textWrap: 'pretty' }}>
              {text}
              {typing && (
                <span style={{
                  display: 'inline-block', width: 2, height: '1.1em', background: 'var(--gold)',
                  verticalAlign: 'text-bottom', marginLeft: 2,
                  animation: 'smCaret 1s steps(1) infinite',
                }} />
              )}
            </p>
            {turn.citations.length > 0 && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))',
                gap: 12,
              }}>
                {turn.citations.map((c, i) => (
                  <article key={i} style={{
                    border: '1px solid var(--goldT2)', borderRadius: 12, padding: 16,
                    display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg)',
                    animation: 'smPop .45s ease both', animationDelay: `${i * 0.06}s`,
                  }}>
                    {/* No match score. The server withholds it on purpose - it is a
                        fusion rank, not a confidence - so there is nothing to print. */}
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--gold)' }}>
                      [{c.passageNo ?? i + 1}]
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{c.bookName}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)' }}>
                      {[c.pageNo == null ? null : `p. ${c.pageNo}`,
                        c.verseNo ? `verse ${c.verseNo}` : null].filter(Boolean).join(' · ')}
                    </span>
                    {c.snippet && (
                      <span style={{
                        fontFamily: 'var(--tamil)', fontSize: 14, color: 'var(--mu)',
                        borderLeft: '1px solid var(--goldT2)', paddingLeft: 10,
                      }}>
                        {c.snippet}
                      </span>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )}

        {turn.status === 'notfound' && (
          <div style={{
            border: '1.5px dashed var(--amb)', borderRadius: 14, padding: 24,
            display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--ambT)',
          }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <BookOpen size={24} style={{ color: 'var(--amb)' }} />
              <span style={{ fontFamily: 'var(--serif)', fontSize: 22, color: 'var(--amb)' }}>
                Not found in corpus
              </span>
            </div>
            <span style={{ textWrap: 'pretty' }}>
              No passage in the indexed books answers this question, so the assistant
              will not guess. A dose that is not in the source should never come from
              a language model.
            </span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={onFormulary}
                      style={{ minHeight: 44, padding: '0 14px' }}>
                <Flask size={16} /> Search the formulary
              </button>
            </div>
          </div>
        )}

        {(turn.status === 'error' || turn.status === 'offline') && (
          <Panel tone="red" Icon={Plugs} title={null}>
            {turn.status === 'offline'
              ? 'The AI service could not be reached. Search and the rule-based safety checks still work; answers will resume when it reconnects.'
              : `The assistant could not answer this one. ${turn.body || ''}`.trim()}
          </Panel>
        )}
      </div>
    </div>
  )
}

function Panel({ tone, Icon, title, children }) {
  const c = tone === 'red' ? 'var(--red)' : 'var(--amb)'
  const bg = tone === 'red' ? 'var(--redT)' : 'var(--ambT)'
  return (
    <div style={{
      border: `1px solid ${c}`, borderRadius: 14, padding: 20, background: bg,
      display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <Icon size={22} style={{ color: c, flex: 'none' }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {title && <strong style={{ color: c }}>{title}</strong>}
        <span>{children}</span>
      </span>
    </div>
  )
}

function Avatar() {
  return (
    <span style={{
      width: 36, height: 36, flex: 'none', borderRadius: '50%',
      border: '1px solid var(--goldT2)', display: 'grid', placeItems: 'center',
    }}>
      <Mark size={20} />
    </span>
  )
}

function Opening({ onPick }) {
  const asks = [
    'What is the dose of Thiripala Chooranam?',
    'Which preparations contain a heavy metal?',
    'What is the anupanam for Linga Chenthuram?',
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 620 }}>
      <span style={{ fontFamily: 'var(--serif)', fontSize: 26 }}>
        Ask the corpus
      </span>
      <span style={{ color: 'var(--mu)', fontSize: 15, lineHeight: 1.7 }}>
        Every answer comes back with the book, page and verse it was read from.
        When the indexed books do not cover a question, the assistant says so
        rather than filling the gap.
      </span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {asks.map((a) => (
          <button key={a} type="button" className="btn btn-secondary" onClick={() => onPick(a)}
                  style={{ minHeight: 40, padding: '0 12px', fontSize: 13 }}>
            {a}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Rebuilds a stored conversation into the same turn shape a live exchange
 * produces, so a reopened chat reads exactly as it did when it happened -
 * including which answers were "not found" rather than answered.
 */
function replay(messages) {
  return messages.map((m) => (m.sender === 'USER' || m.sender === 'user')
    ? { kind: 'q', body: m.body }
    : { kind: 'a', status: m.status, body: m.body, citations: m.citations ?? [], fresh: false })
}

/**
 * Reveals `full` a character at a time when `on`, otherwise returns it whole.
 *
 * Presentation only - the entire string is already in memory. Capped at roughly
 * 1.6 seconds regardless of length, because a clinician waiting on a dose
 * should not be watching an animation.
 */
function useTypedText(full, on) {
  const [n, setN] = useState(on ? 0 : (full?.length ?? 0))

  useEffect(() => {
    const len = full?.length ?? 0
    if (!on) { setN(len); return undefined }
    setN(0)
    const step = Math.max(1, Math.ceil(len / 120))
    const timer = setInterval(() => {
      setN((prev) => {
        if (prev + step >= len) { clearInterval(timer); return len }
        return prev + step
      })
    }, 13)
    return () => clearInterval(timer)
  }, [full, on])

  return (full ?? '').slice(0, n)
}
