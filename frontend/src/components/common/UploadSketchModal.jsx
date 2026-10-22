import { useEffect, useRef, useState } from 'react'
import Button from './Button'
import SketchModal from './SketchModal'
import StageStrip, { StripImage } from '../analysis/StageStrip'
import PhotoDropzone from './PhotoDropzone'
import AdmiredPanel from './AdmiredPanel'
import { api } from '../../lib/api'
import { previewUrl } from '../../lib/previewUrl'
import { useSheetDrag } from '../../lib/useSheetDrag'
import RightsNote from './RightsNote'

/**
 * Upload sketch (design doc, item 38): the black modal from New Sketch,
 * with only the upload. Opened from the SketchDetail page by the owner.
 *
 *   Progress sketch  added to the sketch's uploads. No feedback.
 *   Final sketch     shares the sketch and asks the SketchConnect coach for
 *                    feedback, shaped by the sketchers you admire (one
 *                    voice, design doc item 39).
 *
 * With `upload` (an existing progress sketch), it only makes that upload
 * the final: the photo is fixed.
 *
 * Submit closes the modal right away. The SketchDetail page shows
 * "Feedback on its way…" until the critique lands.
 */
export default function UploadSketchModal({ sketch, upload = null, imageUrl, onClose, onDone }) {
  const hasFinal = Boolean(sketch.final_sketch_url)
  const pending = sketch.critique_status === 'pending'
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [kind, setKind] = useState(upload ? 'final' : hasFinal || pending ? 'progress' : 'final')
  const [admired, setAdmired] = useState([]) // the sketchers you admire: they shape the coach's feedback
  const [sending, setSending] = useState(false)
  const [editingAdmired, setEditingAdmired] = useState(false) // the white Admired sketchers panel, over this modal
  const [error, setError] = useState(null)
  // Phone: the panel is a bottom sheet over the photo, as in Edit Sketch.
  const [sheetOpen, setSheetOpen] = useState(true)
  const sheet = useSheetDrag(sheetOpen, setSheetOpen)
  const libraryRef = useRef(null)
  const cameraRef = useRef(null)
  const pickRef = useRef(0)

  useEffect(() => {
    api.get('/api/admired').then(({ data }) => setAdmired(data)).catch(() => setAdmired([]))
  }, [])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  // HEIC photos are converted for the preview only; the original uploads.
  async function pickFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const pick = ++pickRef.current
    setError(null)
    try {
      const url = await previewUrl(f)
      if (pick !== pickRef.current) return URL.revokeObjectURL(url)
      setFile(f)
      setPreview(url)
    } catch {
      if (pick === pickRef.current) setError('Could not open this photo. Try a JPEG or PNG.')
    }
  }

  async function submit() {
    setSending(true)
    setError(null)
    try {
      let data
      if (upload) {
        ;({ data } = await api.post(`/api/sketches/${sketch.id}/uploads/${upload.id}/final`, {}))
      } else {
        const form = new FormData()
        form.append('image', file)
        form.append('final', kind === 'final' ? 'true' : 'false')
        ;({ data } = await api.post(`/api/sketches/${sketch.id}/uploads`, form))
      }
      onDone?.(data)
    } catch (err) {
      const d = err.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Could not upload your sketch.')
      setSending(false)
    }
  }

  const shown = upload ? imageUrl : preview
  const ready = upload || file
  const finalBlocked = pending && kind === 'final'
  const submitLabel = sending ? 'Uploading…' : kind === 'final' ? 'Share and get feedback' : 'Add progress sketch'

  return (
    <SketchModal title={upload ? 'Make it the final sketch' : 'Upload sketch'} onClose={onClose}>
      <input ref={libraryRef} type="file" accept="image/*,.heic" onChange={pickFile} className="hidden" />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={pickFile} className="hidden" />

      {/* Left: the photo stage, the same strip as Edit Sketch. Before a
          photo is picked, New Sketch's dropzone. key: a new photo remounts
          the strip. */}
      {shown ? (
        <StageStrip key={shown} panels={[{ key: 'sketch', label: 'Your sketch', content: <StripImage src={shown} alt="Your sketch" /> }]} />
      ) : (
        <div className="relative flex min-h-[55vh] flex-1 flex-col bg-sc-modal md:min-h-0">
          <PhotoDropzone
            title="Photograph your sketch"
            text="Flat and in focus. Crop out your hand and the table."
            onClick={() => cameraRef.current?.click()}
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
          {!upload && (
            <>
              <p className="text-md text-sc-text2">What is this photo?</p>
              <Button variant="choice" selected={kind === 'progress'} onClick={() => setKind('progress')}>
                Progress sketch
                <span className={`mt-0.5 block text-sm font-normal ${kind === 'progress' ? 'text-white/85' : 'text-sc-text3'}`}>Keeps a record of how the sketch grows. Only you see it until you share the final.</span>
              </Button>
              <Button variant="choice" selected={kind === 'final'} onClick={() => setKind('final')}>
                Final sketch
                <span className={`mt-0.5 block text-sm font-normal ${kind === 'final' ? 'text-white/85' : 'text-sc-text3'}`}>
                  {hasFinal ? 'Replaces your final sketch, shares it and asks for new feedback.' : 'Shares the sketch publicly and asks for feedback.'}
                </span>
              </Button>
            </>
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
          {finalBlocked && <p className="text-base text-sc-text3">Feedback on your last final sketch is still on its way. Add a progress sketch now, or wait a minute.</p>}
          {error && <p className="text-base text-accent">{error}</p>}
        </div>
        <div className="sc-footer">
          {!upload && shown && (
            <Button variant="secondaryOnDark" className="mr-auto" onClick={() => libraryRef.current?.click()} disabled={sending}>Choose another</Button>
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
