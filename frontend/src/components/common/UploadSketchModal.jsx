import { useEffect, useRef, useState } from 'react'
import Button from './Button'
import SketchModal from './SketchModal'
import StageStrip, { StripImage } from '../analysis/StageStrip'
import PhotoDropzone from './PhotoDropzone'
import AdmiredPanel from './AdmiredPanel'
import { api } from '../../lib/api'
import { previewUrl } from '../../lib/previewUrl'
import { imageUrl as mediaUrl } from '../../lib/media'
import { useSheetDrag } from '../../lib/useSheetDrag'
import RightsNote from './RightsNote'

/**
 * Upload sketch (design doc, item 38): the black modal from New Sketch,
 * with only the upload. Opened from the SketchDetail page by the owner.
 *
 * Several photos at once (October 30, 2026): the uploads already on the
 * sketch come first, then the new ones; put them in order (drag on a
 * computer, the arrows on a phone; new ones start in the order they were
 * taken), remove any, and mark one as the final. Save then: uploads the new
 * photos (POST /uploads/batch), makes an existing one the final if you
 * picked it, deletes the removed ones, and saves the order (PUT /order).
 *
 *   Progress sketch  added to the sketch's uploads. No feedback.
 *   Final sketch     shares the sketch and asks the SketchConnect coach for
 *                    feedback, shaped by the sketchers you admire (one
 *                    voice, design doc item 39). It goes to the end of the set.
 *
 * With `upload` (an existing progress sketch), it only makes that upload
 * the final: the photo is fixed.
 *
 * Submit closes the modal right away. The SketchDetail page shows
 * "Feedback on its way…" until the critique lands.
 */
const MAX_UPLOADS = 10 // features/sketches/router.py MAX_SKETCH_UPLOADS

export default function UploadSketchModal({ sketch, upload = null, imageUrl, onClose, onDone }) {
  const hasFinal = Boolean(sketch.final_sketch_url)
  const pending = sketch.critique_status === 'pending'
  // The uploads already on the sketch, in their order: { key, uploadId, preview }.
  const existing = (sketch.uploads || []).map((u) => ({ key: `u-${u.id}`, uploadId: u.id, preview: mediaUrl(u.url), isFinal: u.is_final }))
  const startFinal = existing.find((p) => p.isFinal)?.key || null
  const room = MAX_UPLOADS // a sketch holds up to 10 uploads, these included
  const [photos, setPhotos] = useState(existing) // existing and new ({ key, file, preview }), in order
  const [shownKey, setShownKey] = useState(null) // the photo on the stage
  const [finalKey, setFinalKey] = useState(startFinal) // the photo marked final, or none
  const [dragKey, setDragKey] = useState(null)
  const [note, setNote] = useState(null) // e.g. "Only 3 more fit"
  // A new final (a new photo, or another existing one) asks for feedback.
  const kind = upload || (finalKey && finalKey !== startFinal) ? 'final' : 'progress'
  const [admired, setAdmired] = useState([]) // the sketchers you admire: they shape the coach's feedback
  const [sending, setSending] = useState(false)
  const [editingAdmired, setEditingAdmired] = useState(false) // the white Admired sketchers panel, over this modal
  const [error, setError] = useState(null)
  // Phone: the panel is a bottom sheet over the photo, as in Edit Sketch.
  const [sheetOpen, setSheetOpen] = useState(true)
  const sheet = useSheetDrag(sheetOpen, setSheetOpen)
  const libraryRef = useRef(null)
  const cameraRef = useRef(null)
  // A phone or tablet opens its camera; a computer has none to shoot with,
  // so its photo picker opens instead, where several can be chosen at once.
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  const takePhoto = () => (touch ? cameraRef : libraryRef).current?.click()
  const pickRef = useRef(0)

  useEffect(() => {
    api.get('/api/admired').then(({ data }) => setAdmired(data)).catch(() => setAdmired([]))
  }, [])
  const photosRef = useRef(photos)
  photosRef.current = photos
  useEffect(() => () => photosRef.current.forEach((p) => { if (p.file) URL.revokeObjectURL(p.preview) }), [])

  // Add the picked photos after the ones already in the set, oldest first
  // (a photo's file time is when it was taken, for camera-roll photos).
  // HEIC photos are converted for the preview only; the original uploads.
  async function pickFiles(e) {
    const files = Array.from(e.target.files || []).sort((a, b) => a.lastModified - b.lastModified)
    e.target.value = ''
    if (!files.length) return
    setError(null)
    setNote(null)
    const space = room - photos.length
    if (files.length > space) setNote(space > 0 ? `Only ${space} more ${space === 1 ? 'photo fits' : 'photos fit'}: a sketch holds up to ${MAX_UPLOADS}.` : `A sketch holds up to ${MAX_UPLOADS} uploads.`)
    const added = []
    for (const f of files.slice(0, Math.max(0, space))) {
      try {
        added.push({ key: `${f.name}-${f.lastModified}-${++pickRef.current}`, file: f, preview: await previewUrl(f) })
      } catch {
        setError(`Could not open ${f.name}. Try a JPEG or PNG.`)
      }
    }
    if (!added.length) return
    // Keep a marked final at the end.
    setPhotos((list) => {
      const fin = list.find((p) => p.key === finalKey)
      return fin ? [...list.filter((p) => p !== fin), ...added, fin] : [...list, ...added]
    })
    setShownKey(added[added.length - 1].key)
  }

  function move(key, by) {
    setPhotos((list) => {
      const i = list.findIndex((p) => p.key === key)
      const j = i + by
      if (i < 0 || j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  // Drag on a computer: the dragged photo takes the place of the one under it.
  function dragOver(e, key) {
    e.preventDefault()
    if (!dragKey || dragKey === key) return
    setPhotos((list) => {
      const from = list.findIndex((p) => p.key === dragKey)
      const to = list.findIndex((p) => p.key === key)
      const next = [...list]
      next.splice(to, 0, ...next.splice(from, 1))
      return next
    })
  }
  function remove(key) {
    setPhotos((list) => {
      const gone = list.find((p) => p.key === key)
      if (gone?.file) URL.revokeObjectURL(gone.preview)
      const next = list.filter((p) => p.key !== key)
      if (shownKey === key) setShownKey(next[next.length - 1]?.key || null)
      return next
    })
    if (finalKey === key) setFinalKey(null)
    setNote(null)
  }
  // One final at most, and it goes to the end of the set.
  function toggleFinal(key) {
    // The shared final stays until another is marked: unmarking it would
    // unshare the sketch (remove it for that).
    if (finalKey === key) return key === startFinal ? undefined : setFinalKey(startFinal && photos.some((p) => p.key === startFinal) ? startFinal : null)
    setFinalKey(key)
    setPhotos((list) => [...list.filter((p) => p.key !== key), list.find((p) => p.key === key)])
  }

  async function submit() {
    setSending(true)
    setError(null)
    try {
      let data
      if (upload) {
        ;({ data } = await api.post(`/api/sketches/${sketch.id}/uploads/${upload.id}/final`, {}))
      } else {
        const base = `/api/sketches/${sketch.id}/uploads`
        const ids = Object.fromEntries(photos.filter((p) => p.uploadId).map((p) => [p.key, p.uploadId]))
        // 1. The new photos, after the existing ones; a new final shares now.
        const fresh = photos.filter((p) => p.file)
        if (fresh.length) {
          const form = new FormData()
          fresh.forEach((p) => form.append('images', p.file))
          const fin = fresh.findIndex((p) => p.key === finalKey)
          if (fin >= 0) form.append('final_index', String(fin))
          ;({ data } = await api.post(`${base}/batch`, form))
          const before = new Set(existing.map((p) => p.uploadId))
          const added = (data?.uploads || []).filter((u) => !before.has(u.id)).map((u) => u.id)
          fresh.forEach((p, i) => { ids[p.key] = added[i] })
        }
        // 2. Another existing photo as the final.
        const pick = photos.find((p) => p.key === finalKey)
        if (pick?.uploadId && finalKey !== startFinal) ({ data } = await api.post(`${base}/${pick.uploadId}/final`, {}))
        // 3. The ones removed from the list.
        for (const p of existing.filter((e) => !photos.some((x) => x.key === e.key))) {
          ;({ data } = await api.delete(`${base}/${p.uploadId}`))
        }
        // 4. The order, when there is more than one.
        const order = photos.map((p) => ids[p.key]).filter(Boolean)
        if (order.length > 1) ({ data } = await api.put(`${base}/order`, { ids: order }))
      }
      onDone?.(data)
    } catch (err) {
      const d = err.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Could not upload your sketch.')
      setSending(false)
    }
  }

  const shownPhoto = photos.find((p) => p.key === shownKey) || photos[photos.length - 1]
  const shown = upload ? imageUrl : shownPhoto?.preview
  const changed = photos.length !== existing.length || photos.some((p, i) => p.key !== existing[i]?.key) || finalKey !== startFinal
  const ready = upload || (photos.length > 0 && changed)
  const finalBlocked = pending && kind === 'final'
  const n = photos.length
  const nNew = photos.filter((p) => p.file).length
  const submitLabel = sending ? 'Saving…'
    : upload ? 'Share and get feedback'
    : !nNew ? (kind === 'final' ? 'Save and get feedback' : 'Save')
    : kind === 'final' ? (nNew === 1 ? 'Add and share the final' : `Add ${nNew} and share the final`)
    : nNew === 1 ? 'Add progress sketch' : `Add ${nNew} progress sketches`

  return (
    <SketchModal title={upload ? 'Make it the final sketch' : 'Upload sketch'} onClose={onClose}>
      <input ref={libraryRef} type="file" accept="image/*,.heic" multiple onChange={pickFiles} className="hidden" />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple onChange={pickFiles} className="hidden" />

      {/* Left: the photo stage, the same strip as Edit Sketch. Before a
          photo is picked, New Sketch's dropzone. key: a new photo remounts
          the strip. */}
      {shown ? (
        <StageStrip key={shown} panels={[{ key: 'sketch', label: 'Your sketch', content: <StripImage src={shown} alt="Your sketch" /> }]} />
      ) : (
        <div className="relative flex min-h-[55vh] flex-1 flex-col bg-sc-modal md:min-h-0">
          <PhotoDropzone
            title="Photograph your sketch"
            text={touch ? 'Flat and in focus. Crop out your hand and the table. Several photos? Pick them all from your library.' : 'Flat and in focus. Choose one photo or several: hold ⌘ (Ctrl on Windows) to pick more than one.'}
            onClick={takePhoto}
          />
        </div>
      )}

      {/* Right: one choice, and for a final sketch, who shapes the feedback. */}
      <div ref={sheet.ref} className={`sc-panel sc-sheet ${sheet.className}`} style={sheet.style}>
        <button
          type="button"
          className="sc-sheet-handle touch-none"
          {...sheet.handleProps}
          aria-label={sheetOpen ? 'Fold the panel down' : 'Open the panel'}
          aria-expanded={sheetOpen}
        >
          <span />
        </button>
        <div className={`flex min-h-0 flex-1 flex-col ${sheetOpen ? '' : 'max-md:hidden'}`}>
        <div className="sc-panel-body gap-3.5">
          {!upload && n === 0 && (
            <p className="text-md text-sc-text2">Add one photo or several: progress shots in order, and the finished sketch if it's done.</p>
          )}
          {!upload && n > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-md text-sc-text2">
                {n === 1 ? 'Your photo.' : `${n} photos, in order.`} {n > 1 ? 'Drag to reorder, or use the arrows. ' : ''}Use Mark as final on the finished sketch to share it and get feedback.
                {existing.length > 0 && ' Photos marked New are not uploaded yet.'}
              </p>
              <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                {photos.map((p, i) => {
                  const isFinal = finalKey === p.key
                  return (
                    <li key={p.key} draggable onDragStart={() => setDragKey(p.key)} onDragOver={(e) => dragOver(e, p.key)} onDragEnd={() => setDragKey(null)}
                      className={`flex items-center gap-2 rounded-md border p-1.5 ${shownKey === p.key || (!shownKey && i === n - 1) ? 'border-white/60' : 'border-white/15'} ${dragKey === p.key ? 'opacity-50' : ''}`}>
                      <span className="w-5 shrink-0 text-center text-sm font-semibold text-sc-text3">{i + 1}</span>
                      <button type="button" onClick={() => setShownKey(p.key)} className="shrink-0" aria-label={`Show photo ${i + 1}`}>
                        <img src={p.preview} alt="" className="h-12 w-12 cursor-grab rounded object-cover" draggable={false} />
                      </button>
                      {p.file && <span className="rounded bg-white/15 px-1.5 py-0.5 text-3xs font-bold uppercase tracking-wider text-white">New</span>}
                      <button type="button" onClick={() => toggleFinal(p.key)} aria-pressed={isFinal}
                        className={`rounded-full border px-2.5 py-1 text-xs font-bold ${isFinal ? 'border-sc-action bg-sc-action text-sc-action-ink' : 'border-white/30 text-white hover:bg-white/10'}`}>
                        {isFinal ? 'Final ✓' : 'Mark as final'}
                      </button>
                      <span className="ml-auto flex shrink-0 items-center">
                        <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(p.key, -1)} className="flex h-8 w-8 items-center justify-center rounded text-white hover:bg-white/10 disabled:opacity-30">↑</button>
                        <button type="button" aria-label="Move down" disabled={i === n - 1} onClick={() => move(p.key, 1)} className="flex h-8 w-8 items-center justify-center rounded text-white hover:bg-white/10 disabled:opacity-30">↓</button>
                        <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => remove(p.key)} className="flex h-8 w-8 items-center justify-center rounded text-white hover:bg-white/10">×</button>
                      </span>
                    </li>
                  )
                })}
              </ol>
              {n < room && (
                <button type="button" onClick={() => libraryRef.current?.click()} className="self-start text-sm font-semibold text-white underline">+ Add more photos</button>
              )}
              {note && <p className="text-sm text-sc-text3">{note}</p>}
              {hasFinal && finalKey && finalKey !== startFinal && <p className="text-sm text-sc-text3">The new final replaces your final sketch and asks for new feedback.</p>}
              {startFinal && !photos.some((p) => p.key === startFinal) && <p className="text-sm text-sc-text3">Removing the final unshares the sketch. Its feedback stays.</p>}
            </div>
          )}
          {upload && <p className="text-md text-sc-text2">This shares the sketch publicly and asks for feedback on it.</p>}

          {kind === 'final' && (
            <div className="flex flex-col gap-2">
              <p className="text-md text-sc-text2">
                Feedback comes from your SketchConnect coach
                {admired.length ? `, with an eye to what you admire in ${admired.map((v) => v.name).join(', ')}.` : '.'}
              </p>
              <button type="button" onClick={() => setEditingAdmired(true)} className="self-start text-sm font-semibold text-white underline">
                {admired.length ? 'Edit admired sketchers' : 'Add admired sketchers'}
              </button>
              <p className="text-sm text-sc-text3">The coach never writes as another artist. Your admired sketchers only tell it what you're reaching for.</p>
              <RightsNote dark />
            </div>
          )}
          {finalBlocked && <p className="text-base text-sc-text3">Feedback on your last final sketch is still on its way. Save these as progress sketches now, or wait a minute.</p>}
          {error && <p className="text-base text-accent">{error}</p>}
        </div>
        <div className="sc-footer">
          {!upload && shown && (
            <Button variant="secondaryOnDark" className="mr-auto" onClick={takePhoto} disabled={sending || n >= room}>{touch ? 'Take another' : 'Add more'}</Button>
          )}
          {!upload && !shown && (
            <Button variant="secondaryOnDark" className="mr-auto" onClick={() => libraryRef.current?.click()}>From library</Button>
          )}
          <Button variant="action" onClick={submit} disabled={!ready || sending || finalBlocked}>{submitLabel}</Button>
        </div>
        </div>
      </div>
      {editingAdmired && (
        <AdmiredPanel list={admired} onClose={() => setEditingAdmired(false)} onChange={setAdmired} />
      )}
    </SketchModal>
  )
}
