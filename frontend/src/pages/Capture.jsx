import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Button from '../components/common/Button'
import ConfirmDialog from '../components/common/ConfirmDialog'
import SketchModal from '../components/common/SketchModal'
import PhotoDropzone from '../components/common/PhotoDropzone'
import ToolRow from '../components/analysis/ToolRow'
import MediaPicker from '../components/analysis/MediaPicker'
import PlanReadCard from '../components/analysis/PlanReadCard'
import SketchDetailsForm from '../components/analysis/SketchDetailsForm'
import { useSketchDetails } from '../components/analysis/useSketchDetails'
import { api } from '../lib/api'
import { notifySketchesChanged } from '../lib/sketchEvents'
import { shrinkPhoto } from '../lib/shrinkPhoto'
import { previewUrl } from '../lib/previewUrl'

/**
 * Capture (design doc, items 56 and 57): every tool at once, in a row,
 * instead of New Sketch's steps. Save stores the sketch and starts the
 * plan read in the background, so there is nothing to wait for.
 *
 * Built in slices beside New Sketch and Edit Sketch, which keep working
 * until the switch. Slice 1: Upload, Details (with "What you draw with"),
 * Tips, Save and Cancel. Crop, Outline, Color and Value come next.
 */

// A photo created this recently counts as just taken with the camera: the
// phone's position goes with it, since iPhone's camera drops the GPS
// (item 52). Older photos are from the library and keep their own.
const JUST_TAKEN_MS = 2 * 60 * 1000
// How often Tips checks whether the plan read is done.
const POLL_MS = 3000

const TOOLS = [
  { key: 'upload', label: 'Upload', icon: 'camera' },
  { key: 'crop', label: 'Crop', icon: 'expand', soon: true },
  { key: 'outline', label: 'Outline', icon: 'pen', soon: true },
  { key: 'color', label: 'Color', icon: 'color', soon: true },
  { key: 'value', label: 'Value', icon: 'guide-value', soon: true },
  { key: 'tips', label: 'Tips', icon: 'star' },
  { key: 'details', label: 'Details' },
]

// The phone's position now, or null when it can't be had within 10 seconds.
function devicePosition() {
  if (!navigator.geolocation) return Promise.resolve(null)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  })
}

export default function Capture() {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const backgroundLocation = routerLocation.state?.backgroundLocation
  // Capture from an event page (item 49): sent with the photo.
  const captureEvent = routerLocation.state?.event || null

  const [tool, setTool] = useState('upload')
  const [sketch, setSketch] = useState(null)
  const sketchId = sketch?.id || null
  const details = useSketchDetails({ sketchId, sketch, setSketch, enabled: Boolean(sketchId) })

  // ===== UPLOAD =====
  // One button: the phone offers Take Photo or Photo Library, a computer
  // opens its file picker. The photo uploads as soon as it is picked; no
  // Use photo, no Retake (tapping Upload again replaces it).
  const inputRef = useRef(null)
  const pickRef = useRef(0) // the latest pick; a slow earlier one is dropped
  const [preview, setPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingReplace, setConfirmingReplace] = useState(false)

  function pickPhoto() {
    if (sketchId) setConfirmingReplace(true)
    else inputRef.current?.click()
  }

  // The picker opens at once, inside the tap (a browser opens it only
  // then); the old sketch is deleted in the background.
  function replacePhoto() {
    setConfirmingReplace(false)
    inputRef.current?.click()
    const old = sketchId
    setSketch(null)
    setSaved(false)
    api.delete(`/api/sketches/${old}`).catch(() => { /* best effort */ })
  }

  async function handleFile(e) {
    const picked = e.target.files?.[0]
    e.target.value = '' // the same file can be picked again
    if (!picked) return
    const pick = ++pickRef.current
    setError(null)
    const justTaken = Date.now() - picked.lastModified < JUST_TAKEN_MS
    // Asked now, while the photo is prepared. Library photos never ask.
    const position = justTaken ? devicePosition() : null
    try {
      // A photo just taken goes up at 2400 px (November 19, 2026). Library
      // photos go as they are: their location is read from the file.
      const f = justTaken ? await shrinkPhoto(picked) : picked
      if (pick !== pickRef.current) return
      const url = await previewUrl(f)
      if (pick !== pickRef.current) return URL.revokeObjectURL(url)
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return url })
      setUploading(true)
      const form = new FormData()
      form.append('image', f)
      if (captureEvent?.id) form.append('event_id', captureEvent.id)
      if (justTaken) {
        form.append('camera', 'true')
        const pos = await Promise.race([position, new Promise((r) => setTimeout(() => r(null), 4000))])
        if (pos) {
          form.append('device_lat', String(pos.lat))
          form.append('device_lon', String(pos.lon))
        }
      }
      const { data } = await api.post('/api/sketches', form)
      if (pick !== pickRef.current) return
      setSketch({ ...data, is_owner: true })
    } catch (err) {
      if (pick === pickRef.current) setError(err.response?.data?.detail || 'Could not save this photo.')
    } finally {
      if (pick === pickRef.current) setUploading(false)
    }
  }

  // ===== DETAILS: WHAT YOU DRAW WITH =====
  // Pre-filled from the last sketch. Sent with Save; the plan read keeps them.
  const [media, setMedia] = useState([])
  useEffect(() => {
    api.get('/api/sketch-media/last').then(({ data }) => {
      if (data?.media?.length) setMedia((cur) => (cur.length ? cur : data.media))
    }).catch(() => {})
  }, [])
  function toggleMedia(key) {
    setMedia((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))
  }

  // ===== SAVE: READ THE PLAN IN THE BACKGROUND =====
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      if (!(await details.flush())) { setTool('details'); return }
      const form = new FormData()
      form.append('media', media.join(','))
      const { data } = await api.post(`/api/sketches/${sketchId}/read-plan`, form)
      setSketch((prev) => ({ ...prev, plan_status: data.plan_status }))
      setSaved(true)
      setTool('tips')
      notifySketchesChanged()
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save this sketch.')
    } finally {
      setSaving(false)
    }
  }

  // Tips: check back while the plan is being read.
  const planStatus = sketch?.plan_status
  useEffect(() => {
    if (!sketchId || planStatus !== 'pending') return
    const t = setInterval(() => {
      api.get(`/api/sketches/${sketchId}`).then(({ data }) => {
        if (data.plan_status !== 'pending') setSketch((prev) => ({ ...prev, ...data }))
      }).catch(() => {})
    }, POLL_MS)
    return () => clearInterval(t)
  }, [sketchId, planStatus])

  // ===== CANCEL =====
  // A new sketch that was never saved is deleted, after asking. A saved
  // one just closes.
  const [confirmingClose, setConfirmingClose] = useState(false)
  function leave() {
    notifySketchesChanged()
    navigate(backgroundLocation || '/')
  }
  function requestClose() {
    if (sketchId && !saved) setConfirmingClose(true)
    else if (saved) navigate(`/sketches/${sketchId}`, { replace: true })
    else leave()
  }
  async function discardAndClose() {
    setConfirmingClose(false)
    try { await api.delete(`/api/sketches/${sketchId}`) } catch { /* best effort */ }
    leave()
  }

  // ===== RENDER =====
  // Before a photo, only Upload. Every tool lights up as soon as a photo
  // is picked, while it uploads.
  const tools = TOOLS.map((t) => ({ ...t, disabled: t.key !== 'upload' && !preview }))
  const soon = TOOLS.find((t) => t.key === tool)?.soon

  let panel = null
  if (tool === 'upload') {
    panel = (
      <div className="sc-panel-body">
        <p className="sc-body">
          {uploading ? 'Saving your photo…' : sketchId ? 'Tap the camera to use another photo.' : 'Photograph the scene, or pick a photo.'}
        </p>
      </div>
    )
  } else if (soon) {
    panel = (
      <div className="sc-panel-body">
        <p className="sc-body">This tool comes in the next build.</p>
      </div>
    )
  } else if (tool === 'details' && !sketch) {
    panel = (
      <div className="sc-panel-body">
        <p className="sc-body animate-pulse">Saving your photo. Details open in a moment.</p>
      </div>
    )
  } else if (tool === 'details' && sketch) {
    panel = (
      <SketchDetailsForm d={details} sketch={sketch} footer={false}
        locationUnchanged={Boolean(details.location && sketch.location && details.location.lat === sketch.location.lat && details.location.lon === sketch.location.lon)}
        extra={(
          <div className="flex flex-col gap-2">
            <span className="sc-field-label">What you draw with</span>
            <MediaPicker picks={media} onToggle={toggleMedia} />
          </div>
        )}
      />
    )
  } else if (tool === 'tips') {
    panel = (
      <div className="sc-panel-body">
        {!saved && planStatus !== 'done' ? (
          <p className="sc-body">Save, and tips for this scene come while you sketch.</p>
        ) : planStatus === 'pending' ? (
          <p className="sc-body animate-pulse">Tips for this scene are coming. Go ahead and sketch.</p>
        ) : planStatus === 'failed' ? (
          <div className="flex flex-col items-start gap-3">
            <p className="sc-body">The tips could not be made this time.</p>
            <Button variant="secondaryOnDark" onClick={handleSave} disabled={saving}>Try again</Button>
          </div>
        ) : (
          <PlanReadCard planRead={sketch?.plan_read} />
        )}
      </div>
    )
  }

  return (
    <SketchModal title="Capture" onClose={requestClose}>
      <ConfirmDialog
        open={confirmingClose}
        title="Discard this sketch?"
        message="Closing now deletes this sketch: the photo and everything you set up."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={discardAndClose}
        onCancel={() => setConfirmingClose(false)}
      />
      <ConfirmDialog
        open={confirmingReplace}
        title="Replace this photo?"
        message="A new photo starts this sketch over."
        confirmLabel="Replace photo"
        cancelLabel="Keep this one"
        onConfirm={replacePhoto}
        onCancel={() => setConfirmingReplace(false)}
      />
      {/* No capture attribute: the phone offers the camera and the library. */}
      <input ref={inputRef} type="file" accept="image/*,.heic" onChange={handleFile} className="hidden" />

      {/* ===== LEFT: PHOTO STAGE ===== */}
      <div className={`relative flex flex-col bg-sc-modal md:min-h-0 md:flex-1 ${preview ? 'flex-none' : 'min-h-[55vh] flex-1'}`}>
        {preview ? (
          <div className="relative min-h-0 flex-1">
            <div className="relative md:absolute md:inset-x-0 md:inset-y-[var(--stage-inset)]">
              <img src={preview} alt="Reference photo" className={`block h-auto max-h-[75vh] w-full object-contain md:h-full md:max-h-none ${uploading ? 'opacity-60' : ''}`} />
            </div>
          </div>
        ) : (
          <PhotoDropzone
            title="Photograph the scene you'll draw"
            text={captureEvent
              ? `Sketching at ${captureEvent.title}. Stand where you'll sketch from. Location and a title come from this photo.`
              : "Stand where you'll sketch from. Location and a title come from this photo."}
            onClick={pickPhoto}
          />
        )}
      </div>

      {/* ===== RIGHT: TOOLS ===== */}
      <div className="sc-panel sc-panel-pinned">
        <ToolRow tools={tools} active={tool} onPick={(key) => (key === 'upload' ? (setTool('upload'), pickPhoto()) : setTool(key))} />
        {panel}
        {error && <p className="px-[var(--space-panel-x)] pb-2 text-base text-accent">{error}</p>}
        <div className="sc-footer sc-footer-pinned md:mt-auto">
          <Button variant="secondaryOnDark" className="mr-auto" onClick={requestClose}>{saved ? 'Close' : 'Cancel'}</Button>
          <Button variant="action" onClick={handleSave} disabled={!sketchId || uploading || saving || saved}>
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </Button>
        </div>
      </div>
    </SketchModal>
  )
}
