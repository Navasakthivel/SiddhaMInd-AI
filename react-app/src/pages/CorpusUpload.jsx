import { useEffect, useRef, useState } from 'react'
import {
  FileArrowUp, FilePdf, Play, ArrowClockwise, WarningCircle,
  Check, CircleNotch, Tray,
} from '@phosphor-icons/react'
import { corpusDocuments, uploadCorpusSource, triggerIngest, ingestStatus } from '../api/client'
import { useRequest } from '../components/ViewState'
import { Loading, ErrorNote, EmptyNote } from '../components/ui'
import { useToast } from '../components/Toast'
import { statusColor } from '../components/bits'

/**
 * 07 Corpus upload.
 *
 * Upload is a real multipart POST. Ingestion is a separate, explicitly triggered
 * job - the upload stores the file and nothing more - so the button on each row
 * is what starts it, and the row's stage is read back from the server rather
 * than guessed at. Each row polls GET /api/admin/corpus/{id}/status, which Java
 * proxies from the AI service. Polling stops for a document the moment it
 * reaches a terminal state, and the whole poll pauses when the tab is hidden.
 *
 * TWO THINGS THE DESIGN ASKS FOR THAT THE PIPELINE CANNOT HONESTLY PROVIDE:
 *
 * 1. A percentage. The pipeline writes its row exactly twice - RUNNING when it
 *    starts, the final status when it ends - and `indexed` is a boolean rather
 *    than a page counter, so no figure moves while a run is in flight. The bar
 *    here is indeterminate (smIndet sweeps, it does not fill), because a bar at
 *    60% would read as measured progress when nothing measured it.
 *
 * 2. A five-stage stepper. The prototype draws Uploaded / OCR / Chunk / Embed /
 *    Indexed, but the server reports one undivided RUNNING state covering the
 *    middle three. Lighting them up one at a time would be inventing four
 *    transitions. The stepper is therefore three steps that map exactly onto the
 *    states the API returns, with the middle step named for the work it holds.
 */
export default function CorpusUpload() {
  const req = useRequest(() => corpusDocuments(), [], { isEmpty: (d) => !d?.documents?.length })
  const fileRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const toast = useToast()
  const [live, setLive] = useState({})

  const documents = req.data?.documents ?? []
  // Only rows that can still change are worth asking about.
  const pollKey = documents
    .filter((d) => !TERMINAL.has(live[d.docId]?.status ?? d.ingestStatus))
    .map((d) => d.docId).join(',')

  useEffect(() => {
    if (!pollKey) return undefined
    let cancelled = false

    async function tick() {
      if (document.hidden) return
      const ids = pollKey.split(',').map(Number)
      const results = await Promise.all(ids.map((id) => ingestStatus(id).catch(() => null)))
      if (cancelled) return
      const next = {}
      let finished = false
      ids.forEach((id, i) => {
        if (!results[i]) return
        next[id] = results[i]
        if (TERMINAL.has(results[i].status)) finished = true
      })
      setLive((prev) => ({ ...prev, ...next }))
      // A finished run changes chunk counts and totals on the row itself, so the
      // list is refetched once rather than left stale.
      if (finished) req.reload()
    }

    tick()
    const timer = setInterval(tick, 2000)
    return () => { cancelled = true; clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollKey])

  async function send(files) {
    const list = Array.from(files ?? [])
    if (!list.length) return
    setBusy(true)
    setError(null)
    try {
      // Sequential, not Promise.all: each upload is a 50MB-capped multipart POST
      // and the server writes to the same corpus directory.
      for (const f of list) {
        await uploadCorpusSource(f, f.name)
        toast.success('Source uploaded', { detail: `${f.name} is stored and ready to index.` })
      }
      await req.reload()
    } catch (e) {
      setError(e.message)
      toast.error('Upload failed', { detail: e.message })
    } finally {
      setBusy(false)
    }
  }

  async function startIngest(docId, retry) {
    setBusy(true)
    setError(null)
    try {
      const r = await triggerIngest(docId)
      // `accepted: false` is a real, expected answer - the AI service refusing or
      // being unreachable - not a thrown error, so it must not read as success.
      if (r.accepted) toast.success(retry ? 'Retrying' : 'Indexing started')
      else toast.error('Indexing did not start', {
        detail: r.message ?? 'The AI service did not accept the request.',
      })
      await req.reload()
    } catch (e) {
      setError(e.message)
      toast.error('Could not start indexing', { detail: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); send(e.dataTransfer.files) }}
        style={{
          position: 'relative', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center',
          padding: '48px 24px', borderRadius: 14, cursor: busy ? 'progress' : 'pointer',
          border: `1.5px dashed ${dragging ? 'var(--gold)' : 'var(--goldT2)'}`,
          background: dragging ? 'var(--goldT)' : 'var(--s1)',
          transition: 'border-color .2s, background .2s',
        }}
      >
        <input ref={fileRef} type="file" accept="application/pdf" multiple disabled={busy}
               onChange={(e) => { send(e.target.files); e.target.value = '' }}
               style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
        <span style={{
          width: 56, height: 56, borderRadius: '50%', border: '1px solid var(--goldT2)',
          display: 'grid', placeItems: 'center', color: 'var(--gold)',
        }}>
          {busy ? <CircleNotch size={26} style={{ animation: 'smSpin 1s linear infinite' }} />
                : <FileArrowUp size={26} />}
        </span>
        <span style={{ fontFamily: 'var(--serif)', fontSize: 22 }}>
          {busy ? 'Uploading…' : 'Drop scanned PDFs here'}
        </span>
        <span style={{ color: 'var(--mu)', fontSize: 14, maxWidth: 460 }}>
          Tamil and English pharmacopoeia scans. Pages are OCR&rsquo;d, split into cited
          chunks and embedded for the assistant.{' '}
          <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Browse files</span>
        </span>
      </label>

      {error && (
        <p role="alert" style={{
          margin: 0, color: 'var(--red)', fontSize: 14, display: 'flex', gap: 8,
          alignItems: 'center', border: '1px solid var(--redT)', background: 'var(--redT)',
          borderRadius: 10, padding: '12px 14px',
        }}>
          <WarningCircle size={18} /> {error}
        </p>
      )}

      {req.state === 'loading' && <Loading rows={2} />}
      {req.state === 'error' && <ErrorNote message={req.error?.message} onRetry={req.reload} />}
      {req.state === 'empty' && (
        <EmptyNote title="No sources yet"
                   body="Nothing has been uploaded to this corpus. Add a scanned text above to begin." />
      )}

      {req.state === 'ready' && documents.map((d) => {
        const s = live[d.docId]
        const status = s?.status && s.status !== 'UNKNOWN' ? s.status : d.ingestStatus
        const complete = status === 'COMPLETE'
        const failed = status === 'FAILED'
        const stalled = Boolean(s?.stalled)
        const running = Boolean(s?.running) && !stalled
        const sc = stalled ? statusColor('STALLED') : statusColor(status)
        const label = stalled ? 'STALLED' : (status || 'PENDING')

        return (
          <section key={d.docId} style={{
            background: 'var(--s1)', border: '1px solid var(--line)', borderRadius: 14,
            padding: 24, display: 'flex', flexDirection: 'column', gap: 20,
            animation: 'smUp .45s ease both',
          }}>
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 16,
              alignItems: 'flex-start', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <FilePdf size={28} style={{ color: 'var(--gold)', flex: 'none' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontFamily: 'var(--serif)', fontSize: 20 }}>{d.title}</span>
                  <span style={{ fontSize: 13, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>
                    {d.slug}
                  </span>
                </div>
              </div>
              <span style={{
                fontSize: 12, fontWeight: 600, color: sc, whiteSpace: 'nowrap',
                display: 'inline-flex', gap: 6, alignItems: 'center',
                padding: '4px 10px', borderRadius: 999, border: `1px solid ${sc}`,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc }} />
                {label}
              </span>
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 16,
            }}>
              <Stat label="Language" value={d.language || '—'} />
              <Stat label="Pages" value={s?.totalPages ?? d.totalPages ?? 0} mono />
              <Stat label="Chunks" value={s?.chunkCount ?? d.chunkCount ?? 0} mono />
              {/* Only shown once a run has reported. Before that the server has no
                  skipped-page figure at all, and a zero would claim otherwise. */}
              <Stat label="Skipped OCR pages"
                    value={s?.skippedPages == null ? '—' : s.skippedPages} mono />
            </div>

            <Stepper complete={complete} running={running} failed={failed} stalled={stalled} />

            {running && (
              <div role="progressbar" aria-label="Indexing in progress" style={{
                height: 4, borderRadius: 2, background: 'var(--line)', overflow: 'hidden',
              }}>
                {/* Indeterminate on purpose: it sweeps, it does not fill. */}
                <div style={{
                  width: '32%', height: '100%', borderRadius: 2,
                  background: 'linear-gradient(90deg,transparent,var(--gold),transparent)',
                  animation: 'smIndet 1.6s ease-in-out infinite',
                }} />
              </div>
            )}

            {(stalled || s?.error || s?.reachable === false) && (
              <span style={{
                display: 'flex', gap: 8, alignItems: 'center', fontSize: 14,
                color: s?.error ? 'var(--red)' : 'var(--amb)',
              }}>
                <WarningCircle size={18} style={{ flex: 'none' }} />
                {s?.error
                  ? s.error
                  : stalled
                    ? 'Marked running, but no process is working on it — start it again.'
                    : `Live status unavailable: ${s.message}`}
              </span>
            )}

            {!complete && !running && (
              req.data?.ingestAvailable ? (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" disabled={busy}
                          onClick={() => startIngest(d.docId, failed || stalled)}
                          style={{ minHeight: 44, padding: '0 18px' }}>
                    {failed || stalled ? <ArrowClockwise size={17} /> : <Play size={17} />}
                    {failed || stalled ? 'Retry' : 'Start indexing'}
                  </button>
                  <span style={{ fontSize: 13, color: 'var(--mu)' }}>
                    OCR &rarr; Chunk &rarr; Embed runs in the background.
                  </span>
                </div>
              ) : (
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--mu)' }}>
                  <Tray size={16} /> The ingestion service is not reachable, so indexing
                  cannot be started from here.
                </span>
              )
            )}
          </section>
        )
      })}
    </div>
  )
}

function Stat({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 12, color: 'var(--mu)' }}>{label}</span>
      <span style={{ fontFamily: mono ? 'var(--mono)' : 'inherit' }}>{value}</span>
    </div>
  )
}

/**
 * Three steps, because three is what the server reports.
 *
 * Uploaded is always done - the row would not exist otherwise. The middle step
 * carries OCR, chunking and embedding together, since the pipeline exposes them
 * as one RUNNING state. Indexed is done only on COMPLETE.
 */
function Stepper({ complete, running, failed, stalled }) {
  const done = 'var(--jade)'
  const now = failed || stalled ? 'var(--red)' : 'var(--gold)'
  const idle = 'var(--line2)'

  const steps = [
    { label: 'Uploaded', state: 'done' },
    {
      label: 'OCR · Chunk · Embed',
      state: complete ? 'done' : failed || stalled ? 'bad' : running ? 'now' : 'idle',
    },
    { label: 'Indexed', state: complete ? 'done' : 'idle' },
  ]

  return (
    <ol aria-label="Processing stages" style={{
      listStyle: 'none', margin: 0, padding: 0,
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
    }}>
      {steps.map((g, i) => {
        const active = g.state === 'done' || g.state === 'now' || g.state === 'bad'
        const c = g.state === 'done' ? done : g.state === 'idle' ? idle : now
        return (
          <li key={g.label} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 120px' }}>
            <span style={{
              width: 28, height: 28, flex: 'none', borderRadius: '50%',
              display: 'grid', placeItems: 'center',
              border: `1.5px solid ${c}`,
              background: g.state === 'done' ? c : 'transparent',
              color: g.state === 'done' ? 'var(--onGold)' : c,
            }}>
              {g.state === 'done' ? <Check size={15} weight="bold" />
                : g.state === 'now' ? <CircleNotch size={15} style={{ animation: 'smSpin 1s linear infinite' }} />
                : g.state === 'bad' ? <WarningCircle size={15} />
                : <span style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>{i + 1}</span>}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--tx)' : 'var(--mu)' }}>
              {g.label}
            </span>
            {i < steps.length - 1 && (
              <span style={{
                flex: 1, height: 1.5, minWidth: 16,
                background: steps[i + 1].state === 'idle' ? idle : done,
              }} />
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** States that will not change again without someone starting a new run. */
const TERMINAL = new Set(['COMPLETE', 'FAILED'])
