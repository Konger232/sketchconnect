import { useCallback, useEffect, useRef, useState } from 'react'
import Button from './Button'
import ConfirmDialog from './ConfirmDialog'
import Icon from './Icon'
import InfoTip from './InfoTip'
import NoteRecorder from './NoteRecorder'
import { api } from '../../lib/api'
import { dateLabel, timeLabel } from '../../lib/media'

/**
 * Field notes (November 20, 2026): what the sketcher typed and what they
 * recorded, in one list. A voice note is a field note delivered as a
 * recording; the AI writes its text (a clean transcript), which the
 * sketcher can edit. Each note says how it came in: Typed, Recorded, or
 * Recorded · edited.
 *
 * Private by default. "Share my notes" (sketches.notes_shared) lets anyone
 * who can see the sketch read them: the typed notes and the voice notes'
 * text, never the recordings. A separate switch lets the coach read them
 * (sketches.notes_for_coach), off by default.
 *
 * useSketchNotes holds the recordings for both places they are made: this
 * section on the SketchDetail page, and the Details tab (DetailsVoiceNotes).
 */
// Clips are set aside (November 18, 2026) while it is decided whether a
// clip belongs with the reference photo instead. Clips already recorded
// still play and can be deleted; turn this on to record new ones.
const CLIPS = false

export const clock = (s) => (s == null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
const EXT = { 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'video/mp4': 'mp4', 'video/webm': 'webm' }

export function useSketchNotes(sketchId) {
  const [notes, setNotes] = useState(null)
  const [forCoach, setForCoach] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const poll = useRef(null)

  const load = useCallback(() => (sketchId ? api.get(`/api/sketches/${sketchId}/notes`)
    .then(({ data }) => { setNotes(data.notes || []); setForCoach(Boolean(data.for_coach)) })
    .catch(() => setNotes([])) : Promise.resolve()), [sketchId])
  useEffect(() => { load() }, [load])

  // While a voice note is being written down, look again every few seconds.
  useEffect(() => {
    clearTimeout(poll.current)
    if (notes?.some((n) => n.transcript_status === 'pending')) poll.current = setTimeout(load, 4000)
    return () => clearTimeout(poll.current)
  }, [notes, load])

  async function upload(kind, { blob, type, seconds }) {
    if (!blob.size) return
    setSaving(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('kind', kind)
      form.append('duration_s', String(seconds))
      form.append('file', blob, `${kind}.${EXT[type] || 'bin'}`)
      const { data } = await api.post(`/api/sketches/${sketchId}/notes`, form)
      setNotes((list) => [...(list || []), data])
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save the recording. Try again.')
    } finally { setSaving(false) }
  }

  async function remove(note) {
    await api.delete(`/api/notes/${note.id}`)
    setNotes((list) => list.filter((x) => x.id !== note.id))
  }

  async function toggleCoach(on) {
    setForCoach(on)
    try {
      const { data } = await api.put(`/api/sketches/${sketchId}/notes/for-coach`, { on })
      setForCoach(Boolean(data.for_coach))
    } catch { setForCoach(!on) }
  }

  const replace = (d) => setNotes((list) => list.map((x) => (x.id === d.id ? d : x)))
  return { notes, forCoach, saving, error, upload, remove, toggleCoach, replace }
}

/** The share switch, saved at once. Returns [shared, setShared]. */
export function useNotesShared(sketchId, initial) {
  const [shared, setShared] = useState(Boolean(initial))
  useEffect(() => { setShared(Boolean(initial)) }, [initial])
  async function save(on) {
    setShared(on)
    try {
      const { data } = await api.put(`/api/sketches/${sketchId}`, { notes_shared: on })
      setShared(Boolean(data.notes_shared))
    } catch { setShared(!on) }
  }
  return [shared, save]
}

/** How a note came in. */
export function noteOrigin(note) {
  if (note.kind === 'typed') return 'Typed'
  if (note.kind === 'clip') return 'Clip'
  return note.edited ? 'Recorded · edited' : 'Recorded'
}

function NoteRow({ note, owner, onChange, onDelete }) {
  const [src, setSrc] = useState(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.transcript || '')
  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])
  useEffect(() => { if (!editing) setText(note.transcript || '') }, [note.transcript, editing])

  // The recording comes only to its owner, with the sign-in, so it's fetched
  // and played from memory.
  async function play() {
    setLoading(true)
    try {
      const { data } = await api.get(`/api/notes/${note.id}/file`, { responseType: 'blob' })
      setSrc(URL.createObjectURL(data))
    } finally { setLoading(false) }
  }
  async function save() {
    const { data } = await api.patch(`/api/notes/${note.id}`, { transcript: text })
    onChange(data)
    setEditing(false)
  }

  const typed = note.kind === 'typed'
  const voice = note.kind === 'voice'
  const recorded = !typed
  return (
    <li className="flex flex-col gap-2 border-b border-[var(--ed-row-rule)] py-3 last:border-0">
      <div className="flex items-center gap-2.5">
        <Icon name={typed ? 'edit' : voice ? 'mic' : 'video'} size={16} className="shrink-0 text-ink/70" />
        <span className="flex-1 text-xs text-ink/70">
          <span className="font-semibold text-ink">{noteOrigin(note)}</span>
          {note.created_at && ` · ${dateLabel(note.created_at)} ${timeLabel(note.created_at)}`}
          {recorded && note.duration_s != null ? ` · ${clock(note.duration_s)}` : ''}
        </span>
        {owner && recorded && !src && (
          <button type="button" onClick={play} disabled={loading} className="text-sm font-semibold underline disabled:opacity-50">
            {loading ? 'Loading…' : 'Play'}
          </button>
        )}
        {owner && recorded && (
          <button type="button" onClick={() => onDelete(note)} aria-label="Delete this note" className="text-ink/50 hover:text-ink">
            <Icon name="delete" size={16} />
          </button>
        )}
      </div>
      {src && (voice
        ? <audio src={src} controls autoPlay className="w-full" />
        : <video src={src} controls autoPlay playsInline className="w-full rounded-md bg-black" />)}
      {typed && <p className="m-0 whitespace-pre-line text-base leading-relaxed text-ink">{note.transcript}</p>}
      {voice && (
        note.transcript_status === 'pending' ? <p className="m-0 animate-pulse text-sm text-ink/55">Writing it down…</p>
          : editing ? (
            <div className="flex flex-col gap-2">
              <textarea className="field-input min-h-[96px]" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="editorialSolid" size="sm" onClick={save}>Save</Button>
                <Button variant="editorial" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <p className="m-0 flex-1 whitespace-pre-line text-base leading-relaxed text-ink">
                {note.transcript_status === 'failed' ? <span className="text-ink/55">Could not write this one down. Play it, or type it in.</span>
                  : note.transcript || <span className="text-ink/55">No words were made out.</span>}
              </p>
              {owner && (
                <button type="button" onClick={() => setEditing(true)} aria-label="Edit the text" className="text-ink/50 hover:text-ink">
                  <Icon name="edit" size={15} />
                </button>
              )}
            </div>
          )
      )}
    </li>
  )
}

/**
 * The Field notes section on the SketchDetail page.
 *   sketch   the sketch (field_notes, notes_shared, captured_at; for others,
 *            shared_notes: the voice notes' text)
 *   owner    the sketcher themselves
 */
export default function SketchNotes({ sketch, owner }) {
  const rec = useSketchNotes(owner ? sketch.id : null)
  const [shared, setShared] = useNotesShared(sketch.id, sketch.notes_shared)
  const [recording, setRecording] = useState(null) // 'voice' | 'clip'
  const [removing, setRemoving] = useState(null)

  const typed = (sketch.field_notes || '').trim()
    ? [{ id: 'typed', kind: 'typed', transcript: sketch.field_notes, created_at: sketch.captured_at || sketch.created_at }]
    : []
  const recorded = owner ? (rec.notes || []) : (sketch.shared_notes || []).map((n) => ({ ...n, kind: 'voice', transcript_status: 'done' }))
  const all = [...typed, ...recorded]
  if (!owner && !all.length) return null

  async function confirmRemove() {
    const n = removing
    setRemoving(null)
    await rec.remove(n)
  }

  return (
    <section className="ed-section">
      <div className="ed-section-head">
        <h2 className="ed-kicker m-0">Field notes</h2>
        {owner && (
          <span className="flex items-center gap-1.5 text-xs text-ink/60">
            <Icon name={shared ? 'globe' : 'lock'} size={12} /> {shared ? 'Shared' : 'Only you'}
          </span>
        )}
      </div>
      {owner && !all.length && (
        <p className="m-0 text-sm text-ink/70">Talk about the place, the light and what is happening. Type notes in Edit sketch, Details.</p>
      )}
      {all.length > 0 && (
        <ul className="m-0 max-w-[720px] list-none p-0">
          {all.map((n) => (
            <NoteRow key={n.id} note={n} owner={owner} onDelete={setRemoving} onChange={rec.replace} />
          ))}
        </ul>
      )}
      {owner && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="editorial" onClick={() => setRecording('voice')} disabled={rec.saving}><Icon name="mic" size={16} /> Voice note</Button>
            {CLIPS && <Button variant="editorial" onClick={() => setRecording('clip')} disabled={rec.saving}><Icon name="video" size={16} /> Clip</Button>}
          </div>
          {rec.saving && <p className="m-0 animate-pulse text-sm text-ink/60">Saving the recording…</p>}
          {rec.error && <p className="m-0 text-sm text-accent">{rec.error}</p>}
          <label className="flex items-start gap-2.5 text-sm text-ink">
            <input type="checkbox" className="mt-0.5" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span>
              Share my notes
              <span className="block text-xs text-ink/60">Anyone who can see this sketch reads your typed notes and the text of your voice notes. The recordings stay private.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm text-ink">
            <input type="checkbox" className="mt-0.5" checked={rec.forCoach} onChange={(e) => rec.toggleCoach(e.target.checked)} />
            <span>
              Let the coach read my notes
              <span className="block text-xs text-ink/60">As part of this sketch's journey, for your next feedback. Only the text goes.</span>
            </span>
          </label>
          {recording && <NoteRecorder kind={recording} onDone={(r) => { const k = recording; setRecording(null); rec.upload(k, r) }} onClose={() => setRecording(null)} />}
          <ConfirmDialog open={Boolean(removing)} title="Delete this note?"
            message={removing?.kind === 'clip' ? 'The clip will be deleted.' : 'The recording and its text will be deleted.'}
            confirmLabel="Delete" cancelLabel="Keep it" onConfirm={confirmRemove} onCancel={() => setRemoving(null)} />
        </>
      )}
    </section>
  )
}

/**
 * The Details tab (Edit Sketch, and New Sketch's details), under the typed
 * field note: "Keep it private" (checked: only the sketcher reads the notes;
 * the inverse of sketches.notes_shared), then the voice notes recorded for
 * this sketch. The microphone sits on the Field note label in EditSketch,
 * and starts a recording here through recordRequest (a counter). Dark panel.
 */
export function DetailsVoiceNotes({ sketchId, notesShared, recordRequest = 0 }) {
  const rec = useSketchNotes(sketchId)
  const [shared, setShared] = useNotesShared(sketchId, notesShared)
  const [recording, setRecording] = useState(false)
  const [removing, setRemoving] = useState(null)
  const voice = (rec.notes || []).filter((n) => n.kind === 'voice')
  const firstRequest = useRef(recordRequest)
  useEffect(() => {
    if (recordRequest !== firstRequest.current && sketchId) setRecording(true)
  }, [recordRequest, sketchId])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-sm text-white">
        <label className="flex items-center gap-2.5 text-white">
          <input type="checkbox" checked={!shared} onChange={(e) => setShared(!e.target.checked)} className="h-4 w-4 accent-sc-guide" />
          Keep it private
        </label>
        <InfoTip label="About Keep it private">
          Checked: only you read your notes. Unchecked: anyone who can see this sketch reads your typed note and the text of your voice notes. The recordings always stay private.
        </InfoTip>
      </div>
      {rec.saving && <span className="animate-pulse text-sm text-sc-text3">Saving the recording…</span>}
      {rec.error && <p className="m-0 text-sm text-accent">{rec.error}</p>}
      {voice.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {voice.map((n) => (
            <li key={n.id} className="flex items-start gap-2.5 rounded-xl border-[1.5px] border-sc-border px-3 py-2">
              <Icon name="mic" size={15} className="mt-0.5 shrink-0 text-sc-text3" />
              <span className="min-w-0 flex-1 text-sm text-sc-text2">
                <span className="block text-xs font-semibold text-sc-text3">
                  {noteOrigin(n)} · {timeLabel(n.created_at)}{n.duration_s != null ? ` · ${clock(n.duration_s)}` : ''}
                </span>
                {n.transcript_status === 'pending' ? <span className="animate-pulse">Writing it down…</span>
                  : n.transcript_status === 'failed' ? 'Could not write this one down. Play it on the sketch page.'
                    : <span className="line-clamp-3">{n.transcript || 'No words were made out.'}</span>}
              </span>
              <button type="button" onClick={() => setRemoving(n)} aria-label="Delete this voice note" className="text-sc-text3 hover:text-white">
                <Icon name="delete" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {recording && <NoteRecorder kind="voice" onDone={(r) => { setRecording(false); rec.upload('voice', r) }} onClose={() => setRecording(false)} />}
      <ConfirmDialog open={Boolean(removing)} title="Delete this voice note?" message="The recording and its text will be deleted."
        confirmLabel="Delete" cancelLabel="Keep it" onConfirm={async () => { const n = removing; setRemoving(null); await rec.remove(n) }}
        onCancel={() => setRemoving(null)} />
    </div>
  )
}
