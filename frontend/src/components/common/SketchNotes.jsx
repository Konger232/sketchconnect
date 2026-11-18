import { useCallback, useEffect, useRef, useState } from 'react'
import Button from './Button'
import ConfirmDialog from './ConfirmDialog'
import Icon from './Icon'
import NoteRecorder from './NoteRecorder'
import { api } from '../../lib/api'
import { dateLabel, timeLabel } from '../../lib/media'

/**
 * The sketcher's own notes on a sketch (November 18, 2026): voice notes,
 * with a text version the AI writes, and short clips of the scene. For what
 * the sketch and the photo can't hold on a busy street. Only the sketcher
 * sees them (backend notes/router.py): not shared, not in the critique.
 */
const clock = (s) => (s == null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
const EXT = { 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'video/mp4': 'mp4', 'video/webm': 'webm' }

function Note({ note, onChange, onDelete }) {
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

  const voice = note.kind === 'voice'
  return (
    <li className="flex flex-col gap-2 border-b border-[var(--ed-row-rule)] py-3 last:border-0">
      <div className="flex items-center gap-3">
        <Icon name={voice ? 'mic' : 'video'} size={18} className="shrink-0 text-ink/70" />
        <span className="flex-1 text-sm text-ink/80">
          {voice ? 'Voice note' : 'Clip'} · {dateLabel(note.created_at)} {timeLabel(note.created_at)}{note.duration_s != null ? ` · ${clock(note.duration_s)}` : ''}
        </span>
        {!src && (
          <button type="button" onClick={play} disabled={loading} className="text-sm font-semibold underline disabled:opacity-50">
            {loading ? 'Loading…' : 'Play'}
          </button>
        )}
        <button type="button" onClick={() => onDelete(note)} aria-label="Delete this note" className="text-ink/50 hover:text-ink">
          <Icon name="delete" size={16} />
        </button>
      </div>
      {src && (voice
        ? <audio src={src} controls autoPlay className="w-full" />
        : <video src={src} controls autoPlay playsInline className="w-full rounded-md bg-black" />)}
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
              <p className="m-0 flex-1 whitespace-pre-line text-base text-ink">
                {note.transcript_status === 'failed' ? <span className="text-ink/55">Could not write this one down. Play it, or type it in.</span>
                  : note.transcript || <span className="text-ink/55">No words were made out.</span>}
              </p>
              <button type="button" onClick={() => setEditing(true)} aria-label="Edit the text" className="text-ink/50 hover:text-ink">
                <Icon name="edit" size={15} />
              </button>
            </div>
          )
      )}
    </li>
  )
}

export default function SketchNotes({ sketchId }) {
  const [notes, setNotes] = useState(null)
  const [recording, setRecording] = useState(null) // 'voice' | 'clip'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [removing, setRemoving] = useState(null)
  const poll = useRef(null)

  const load = useCallback(() => api.get(`/api/sketches/${sketchId}/notes`).then(({ data }) => setNotes(data)).catch(() => setNotes([])), [sketchId])
  useEffect(() => { load() }, [load])

  // While a voice note is being written down, look again every few seconds.
  useEffect(() => {
    clearTimeout(poll.current)
    if (notes?.some((n) => n.transcript_status === 'pending')) poll.current = setTimeout(load, 4000)
    return () => clearTimeout(poll.current)
  }, [notes, load])

  async function upload({ blob, type, seconds }) {
    const kind = recording
    setRecording(null)
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

  async function remove() {
    const n = removing
    setRemoving(null)
    await api.delete(`/api/notes/${n.id}`)
    setNotes((list) => list.filter((x) => x.id !== n.id))
  }

  return (
    <section className="ed-section">
      <div className="ed-section-head">
        <h2 className="ed-kicker m-0">Your notes</h2>
        <span className="flex items-center gap-1.5 text-xs text-ink/60"><Icon name="lock" size={12} /> Only you</span>
      </div>
      <p className="m-0 text-sm text-ink/70">Talk about the place, the light and what is happening, or record a short clip of the scene.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="editorial" onClick={() => setRecording('voice')} disabled={saving}><Icon name="mic" size={16} /> Voice note</Button>
        <Button variant="editorial" onClick={() => setRecording('clip')} disabled={saving}><Icon name="video" size={16} /> Clip</Button>
      </div>
      {saving && <p className="m-0 animate-pulse text-sm text-ink/60">Saving the recording…</p>}
      {error && <p className="m-0 text-sm text-accent">{error}</p>}
      {notes?.length > 0 && (
        <ul className="m-0 list-none p-0">
          {notes.map((n) => (
            <Note key={n.id} note={n} onDelete={setRemoving}
              onChange={(d) => setNotes((list) => list.map((x) => (x.id === d.id ? d : x)))} />
          ))}
        </ul>
      )}
      {recording && <NoteRecorder kind={recording} onDone={upload} onClose={() => setRecording(null)} />}
      <ConfirmDialog open={Boolean(removing)} title="Delete this note?"
        message={removing?.kind === 'clip' ? 'The clip will be deleted.' : 'The recording and its text will be deleted.'}
        confirmLabel="Delete" cancelLabel="Keep it" onConfirm={remove} onCancel={() => setRemoving(null)} />
    </section>
  )
}
