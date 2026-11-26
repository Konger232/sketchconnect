import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Button from '../components/common/Button'
import ConfirmDialog from '../components/common/ConfirmDialog'
import SketchModal from '../components/common/SketchModal'
import PhotoDropzone from '../components/common/PhotoDropzone'
import ToolRow from '../components/analysis/ToolRow'
import ImagePanel from '../components/analysis/ImagePanel'
import Fade from '../components/analysis/Fade'
import { DEFAULT_MARK_COLOR, DEFAULT_MARK_SIZE, MarkRail, MarksLayer, useMarkDrawing } from '../components/analysis/Marks'
import { useCropFrame } from '../components/analysis/useCropFrame'
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
 * instead of New Sketch's steps. Everything saves as the sketcher works;
 * Done starts the plan read in the background and opens the sketch, so
 * there is nothing to wait for.
 *
 * Built in slices beside New Sketch and Edit Sketch, which keep working
 * until the switch. Slice 1: Upload, Details, Tips.
 * Slice 2: Crop and Outline. Color and Value come next.
 */

// A photo created this recently counts as just taken with the camera: the
// phone's position goes with it, since iPhone's camera drops the GPS
// (item 52). Older photos are from the library and keep their own.
const JUST_TAKEN_MS = 2 * 60 * 1000
// How often Tips checks whether the plan read is done.
const POLL_MS = 3000

// A tool's instruction, always in the same place: over the photo, at the
// top. The right panel holds only what a tool needs beyond that.
const STAGE_HINTS = {
  upload: 'Tap the camera to use another photo.',
  crop: 'Drag corners to crop. Pinch to zoom.',
  outline: 'Outline the shapes and edges you care about',
}

const TOOLS = [
  { key: 'upload', label: 'Capture the scene', icon: 'camera' },
  { key: 'crop', label: 'Crop', icon: 'expand' },
  { key: 'outline', label: 'Outline', icon: 'pen' },
  { key: 'color', label: 'Color', icon: 'color', soon: true },
  { key: 'value', label: 'Value Study', icon: 'guide-value', soon: true },
  { key: 'tips', label: 'Tips', icon: 'sparkle' },
  // Details and everything else: the title, location, notes, media, sharing.
  { key: 'details', label: 'More' },
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
  // Tools opened so far. The others show a dot, to invite exploring before
  // Done (November 26, 2026).
  const [opened, setOpened] = useState(() => new Set(['upload']))
  useEffect(() => { setOpened((s) => (s.has(tool) ? s : new Set([...s, tool]))) }, [tool])
  const [sketch, setSketch] = useState(null)
  const sketchId = sketch?.id || null
  const details = useSketchDetails({ sketchId, sketch, setSketch, enabled: Boolean(sketchId) })

  // ===== CROP AND OUTLINE =====
  // Both work on the photo already on the device (preview), so they can
  // start while it uploads. Strokes are drawn on the cropped frame.
  const [preview, setPreview] = useState(null)
  const crop = useCropFrame({ active: tool === 'crop', layoutKey: preview })
  const svgRef = useRef(null)
  const [markTool, setMarkTool] = useState('pen')
  const [markSize, setMarkSize] = useState(DEFAULT_MARK_SIZE)
  // One colour for every stroke: picking another redraws them all.
  const [markColor, setMarkColor] = useState(DEFAULT_MARK_COLOR)
  const drawing = useMarkDrawing(svgRef, { enabled: tool === 'outline', tool: markTool, size: markSize, color: markColor })
  const markTools = {
    tool: markTool, onToolChange: setMarkTool,
    size: markSize, onSizeChange: setMarkSize,
    color: markColor, onColorChange: (key) => { setMarkColor(key); drawing.recolor(key) },
    count: drawing.count, canUndo: drawing.canUndo, onUndo: drawing.undo,
  }

  // Changing the crop after strokes are drawn asks first (item 57): the
  // strokes sit on the frame, so they are cleared. The first change asks;
  // after Yes, the crop moves freely until a stroke is drawn again.
  const [confirmingCrop, setConfirmingCrop] = useState(false)
  function guarded(handler) {
    return (...args) => {
      if (drawing.count > 0) {
        args[args.length - 1]?.stopPropagation?.()
        setConfirmingCrop(true)
        return
      }
      handler(...args)
    }
  }
  const cropHandlers = {
    ...crop.stageHandlers,
    onPointerDown: guarded(crop.stageHandlers.onPointerDown),
    onWheel: (e) => (drawing.count > 0 ? (e.preventDefault(), setConfirmingCrop(true)) : crop.stageHandlers.onWheel(e)),
  }
  const cornerHandlers = { ...crop.cornerHandlers, down: guarded(crop.cornerHandlers.down) }

  // ===== UPLOAD =====
  // One button: the phone offers Take Photo or Photo Library, a computer
  // opens its file picker. The photo uploads as soon as it is picked; no
  // Use photo, no Retake (tapping Upload again replaces it).
  const inputRef = useRef(null)
  const pickRef = useRef(0) // the latest pick; a slow earlier one is dropped
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
    savedMarksRef.current = '[]'
    readKeyRef.current = null
    crop.reset()
    drawing.clear()
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

  // The place name comes a few seconds after the upload: while Details is
  // open, check for it every 2 seconds, five times at most.
  const needsPlace = Boolean(tool === 'details' && sketch?.location && !sketch.location.label)
  useEffect(() => {
    if (!needsPlace) return
    let tries = 0
    const t = setInterval(() => {
      if (++tries > 5) return clearInterval(t)
      api.get(`/api/sketches/${sketchId}`).then(({ data }) => {
        if (data.location?.label) setSketch((prev) => ({ ...prev, location: data.location }))
      }).catch(() => {})
    }, 2000)
    return () => clearInterval(t)
  }, [needsPlace, sketchId])

  // ===== DETAILS: WHAT YOU DRAW WITH =====
  // Pre-filled from the last sketch. Sent with the plan read, which keeps them.
  const [media, setMedia] = useState([])
  useEffect(() => {
    api.get('/api/sketch-media/last').then(({ data }) => {
      if (data?.media?.length) setMedia((cur) => (cur.length ? cur : data.media))
    }).catch(() => {})
  }, [])
  function toggleMedia(key) {
    setMedia((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))
  }

  // ===== AUTOSAVE, AND DONE (November 26, 2026) =====
  // Everything saves as the sketcher works: Details as they type, the crop
  // when they leave Crop, the strokes a moment after they stop drawing. The
  // AI read is the one costly step, so it runs once, on Done (or when Tips
  // opens and nothing has been read for this plan yet).

  // The crop: baked and saved once the Crop tool closes (and the photo is
  // uploaded). Strokes are drawn on that frame.
  async function saveCrop() {
    if (!sketchId || !crop.changed()) return
    const f = crop.frame()
    const framed = new FormData()
    framed.append('old_points', '[]')
    framed.append('new_points', '[]')
    framed.append('framed_image', await crop.bake(), 'framed.jpg')
    framed.append('crop_transform', JSON.stringify({
      aspect_ratio: f.aspect_ratio,
      ...(f.aspect_ratio === 'custom' && { ratio: f.ratio }),
      zoom: f.zoom, offset_x: f.offset_x, offset_y: f.offset_y,
    }))
    await api.post(`/api/sketches/${sketchId}/focal-frame`, framed)
    crop.markSaved(f)
  }
  useEffect(() => {
    if (tool !== 'crop') saveCrop().catch(() => setError('Could not save your crop.'))
  }, [tool, sketchId]) // eslint-disable-line react-hooks/exhaustive-deps

  // The strokes: 1.5 seconds after the last change.
  const marksKey = JSON.stringify(drawing.marks)
  const savedMarksRef = useRef('[]')
  async function saveMarks() {
    if (!sketchId || marksKey === savedMarksRef.current) return
    const plan = new FormData()
    plan.append('old_points', '[]')
    plan.append('new_points', '[]')
    plan.append('marks', marksKey)
    await api.post(`/api/sketches/${sketchId}/focal-frame`, plan)
    savedMarksRef.current = marksKey
  }
  useEffect(() => {
    if (!sketchId || marksKey === savedMarksRef.current) return
    const t = setTimeout(() => saveMarks().catch(() => setError('Could not save your strokes.')), 1500)
    return () => clearTimeout(t)
  }, [marksKey, sketchId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Everything waiting is saved now.
  async function flushAll() {
    if (!(await details.flush())) return false
    await saveCrop()
    await saveMarks()
    return true
  }

  // The AI read, for the plan as it is now. A plan read before costs no AI
  // call: the server reuses its cache.
  const [reading, setReading] = useState(false)
  const readKeyRef = useRef(null)
  const planKey = JSON.stringify([marksKey, crop.frame(), media])
  async function readPlan() {
    if (!(await flushAll())) { setTool('details'); return false }
    const form = new FormData()
    form.append('media', media.join(','))
    const { data } = await api.post(`/api/sketches/${sketchId}/read-plan`, form)
    readKeyRef.current = planKey
    setSketch((prev) => ({ ...prev, plan_status: data.plan_status }))
    return true
  }

  // Done: the read starts, and the sketch opens: go sketch.
  async function handleDone() {
    setReading(true)
    setError(null)
    try {
      if (!(await readPlan())) return
      notifySketchesChanged()
      navigate(`/sketches/${sketchId}`, { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save this sketch.')
    } finally {
      setReading(false)
    }
  }

  // Tips opens: read the plan if this plan has not been read yet.
  useEffect(() => {
    if (tool !== 'tips' || !sketchId || uploading || readKeyRef.current === planKey) return
    readPlan().catch(() => setError('Could not start your tips.'))
  }, [tool, sketchId, uploading]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ===== CLOSE AND DELETE =====
  // Closing keeps the sketch, with everything saved; deleting it is a
  // choice of its own, in More.
  function leave() {
    notifySketchesChanged()
    navigate(backgroundLocation || '/')
  }
  async function requestClose() {
    if (!sketchId) return leave()
    try { await flushAll() } catch { /* saved what it could */ }
    notifySketchesChanged()
    navigate(`/sketches/${sketchId}`, { replace: true })
  }
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  async function deleteSketch() {
    setConfirmingDelete(false)
    try { await api.delete(`/api/sketches/${sketchId}`) } catch { /* best effort */ }
    leave()
  }

  // ===== RENDER =====
  // Before a photo, only Upload. Every tool lights up as soon as a photo
  // is picked, while it uploads.
  const tools = TOOLS.map((t) => {
    const disabled = t.key !== 'upload' && !preview
    return { ...t, disabled, dot: !disabled && !opened.has(t.key) }
  })
  const soon = TOOLS.find((t) => t.key === tool)?.soon
  const hint = tool === 'upload' && uploading ? 'Saving your photo…' : STAGE_HINTS[tool]

  let panel = null
  // Upload, Crop and Outline: their instruction is over the photo, and
  // Outline's tools float on it, so the right panel stays empty.
  if (soon) {
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
        extra={<MediaPicker picks={media} onToggle={toggleMedia} />}
      />
    )
  } else if (tool === 'tips') {
    panel = (
      <div className="sc-panel-body">
        {planStatus === 'failed' ? (
          <div className="flex flex-col items-start gap-3">
            <p className="sc-body">The tips could not be made this time.</p>
            <Button variant="secondaryOnDark" onClick={() => readPlan().catch(() => {})}>Try again</Button>
          </div>
        ) : planStatus === 'done' && sketch?.plan_read ? (
          <PlanReadCard planRead={sketch.plan_read} />
        ) : (
          <p className="sc-body animate-pulse">Tips for this scene are coming. Go ahead and sketch.</p>
        )}
      </div>
    )
  }

  return (
    <SketchModal title="Capture" onClose={requestClose}>
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this sketch?"
        message="This deletes the sketch: the photo and everything you set up."
        confirmLabel="Delete"
        cancelLabel="Keep it"
        onConfirm={deleteSketch}
        onCancel={() => setConfirmingDelete(false)}
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
      <ConfirmDialog
        open={confirmingCrop}
        title="Change the crop?"
        message="Changing the crop clears your strokes. Do you want to continue?"
        confirmLabel="Clear strokes"
        cancelLabel="Keep my strokes"
        onConfirm={() => { setConfirmingCrop(false); drawing.clear() }}
        onCancel={() => setConfirmingCrop(false)}
      />
      {/* No capture attribute: the phone offers the camera and the library. */}
      <input ref={inputRef} type="file" accept="image/*,.heic" onChange={handleFile} className="hidden" />

      {/* ===== LEFT: PHOTO STAGE ===== */}
      {/* --frame-ratio: the frame's width / height, for the phone's stage height. */}
      <div className={`relative flex flex-col bg-sc-modal md:min-h-0 md:flex-1 ${preview ? 'flex-none' : 'min-h-[55vh] flex-1'}`}
        style={{ '--frame-ratio': crop.ratio }}>
        {preview ? (
          <ImagePanel
            containerRef={crop.containerRef}
            imgRef={crop.imgRef}
            svgRef={svgRef}
            boxSize={crop.boxSize}
            imageUrl={preview}
            imageClassName={uploading ? 'opacity-80' : ''}
            zoom={crop.zoom}
            offset={crop.offset}
            box={crop.box}
            heightClass="max-md:aspect-[var(--frame-ratio)] max-md:max-h-[75vh] md:min-h-0 md:flex-1"
            padClass="p-0 md:px-0 md:py-[var(--stage-inset)]"
            cropFrame={tool === 'crop'}
            cropRect={crop.cropRect}
            boxShift={crop.boxShift}
            cornerHandlers={tool === 'crop' ? cornerHandlers : undefined}
            {...(tool === 'crop' ? cropHandlers : tool === 'outline' ? drawing.handlers : {})}
            onImageLoad={crop.handleImageLoad}
          >
            <Fade show={tool !== 'crop'}><MarksLayer marks={drawing.marks} live={drawing.live} /></Fade>
          </ImagePanel>
        ) : (
          <PhotoDropzone
            title="Photograph the scene you'll draw"
            text={captureEvent
              ? `Sketching at ${captureEvent.title}. Stand where you'll sketch from. Location and a title come from this photo.`
              : "Stand where you'll sketch from. Location and a title come from this photo."}
            onClick={pickPhoto}
          />
        )}

        {/* The drawing tools float on the photo, on every screen size. */}
        {tool === 'outline' && (
          <div className="absolute bottom-4 right-4">
            <MarkRail {...markTools} disabled={reading} />
          </div>
        )}

        {preview && hint && (
          <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-[10px] border-[1.5px] border-sc-rail-border bg-sc-rail px-3 py-2 text-base font-medium">
            {hint}
          </p>
        )}
      </div>

      {/* ===== RIGHT: TOOLS ===== */}
      <div className="sc-panel sc-panel-pinned">
        <ToolRow tools={tools} active={tool} onPick={(key) => (key === 'upload' ? (setTool('upload'), pickPhoto()) : setTool(key))} />
        {panel}
        {error && <p className="px-[var(--space-panel-x)] pb-2 text-base text-accent">{error}</p>}
        <div className="sc-footer sc-footer-pinned md:mt-auto">
          {/* Everything saves as you go. Delete is a choice of its own, in More. */}
          {tool === 'details' && sketchId && (
            <button type="button" onClick={() => setConfirmingDelete(true)} className="mr-auto text-base font-semibold text-sc-text3 hover:text-white">
              Delete sketch
            </button>
          )}
          <Button variant="action" onClick={handleDone} disabled={!sketchId || uploading || reading}>
            {reading ? 'Saving…' : 'Done'}
          </Button>
        </div>
      </div>
    </SketchModal>
  )
}
