import { useEffect, useRef, useState, useLayoutEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ImagePanel from '../components/analysis/ImagePanel'
import MarkPanel, { DEFAULT_MARK_SIZE, MarksLayer, useMarkDrawing } from '../components/analysis/Marks'
import StylePicker from '../components/analysis/StylePicker'
import Fade from '../components/analysis/Fade'

import Button from '../components/common/Button'
import ProgressSteps from '../components/common/ProgressSteps'
import ConfirmDialog from '../components/common/ConfirmDialog'
import SketchModal from '../components/common/SketchModal'

import { api } from '../lib/api'
import { notifySketchesChanged } from '../lib/sketchEvents'
import { previewUrl } from '../lib/previewUrl'
import { useStagedProgress } from '../lib/useStagedProgress'
import { ASPECT_RATIO_ORDER, bakeCrop, computeImageBox, reframeToRect, resolveAspectRatio } from '../lib/cropMath'
import { STYLES } from '../data/styles'

import cameraWhite from '../assets/images/ico_camera_w.png'

const MIN_ZOOM = 0.2
const MAX_ZOOM = 8
// Smallest frame a corner drag can leave, as a share of each side.
const MIN_CROP = 0.2

// New Sketch setup, in order (design handoff). 'analyzing' follows the
// four steps, then the sketch opens in EditSketch's workspace.
const STEPS = [
  { key: 'photo', name: 'Reference photo' },
  { key: 'crop', name: 'Crop and reframe' },
  { key: 'marks', name: 'Marks' },
  { key: 'style', name: 'Style' },
]

// The hint over the photo on the photo steps.
const STAGE_HINTS = {
  crop: 'Drag corners to crop. Pinch to zoom.',
  marks: 'Mark shapes or edges you care about',
}

const RATIO_LABELS = { original: 'Original' }

function resolveUrl(url) {
  if (!url) return url
  return url.startsWith('http') ? url : `${api.defaults.baseURL}${url}`
}

function pointerDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export default function CreateSketch() {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const backgroundLocation = routerLocation.state?.backgroundLocation

  // 'photo' | 'crop' | 'marks' | 'style' | 'analyzing'
  const [step, setStep] = useState('photo')

  // ===== STATE: PHOTO =====
  // The chosen file is only uploaded on "Use photo", so Retake and Choose
  // another cost nothing until then.
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [uploadedFile, setUploadedFile] = useState(null)
  const libraryInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const pickRef = useRef(0) // latest photo pick, see handleFile
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [replaceWith, setReplaceWith] = useState(null) // 'camera' | 'library', waiting on ConfirmDialog

  // ===== STATE: SKETCH ON THE SERVER =====
  const [sketchId, setSketchId] = useState(null)
  const [originalImageUrl, setOriginalImageUrl] = useState(null)
  const [referenceImageUrl, setReferenceImageUrl] = useState(null)
  const [uploadedLocation, setUploadedLocation] = useState(null)

  // ===== STATE: CROP (pan / pinch / wheel zoom inside the frame) =====
  const [aspectRatioKey, setAspectRatioKey] = useState('original')
  const [customRatio, setCustomRatio] = useState(null) // after a free corner crop
  const [cropRect, setCropRect] = useState(null) // the frame while a corner is dragged
  const cornerRef = useRef(null)
  const initialTransformRef = useRef({ zoom: 1, offset_x: 0, offset_y: 0 })
  // The transform last saved, so Back from Style reopens the same frame.
  const savedTransformRef = useRef(null)

  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const svgRef = useRef(null)
  const [naturalSize, setNaturalSize] = useState(null)
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 })

  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const zoomRef = useRef(zoom)
  const offsetRef = useRef(offset)
  const pointersRef = useRef(new Map())
  const gestureRef = useRef(null)

  // ===== STATE: FOCAL POINTS AND MARKS =====
  const [markTool, setMarkTool] = useState('pen')
  const [markSize, setMarkSize] = useState(DEFAULT_MARK_SIZE)
  // B&W photo while marking. View only: nothing is saved.
  const [markBlackAndWhite, setMarkBlackAndWhite] = useState(false)
  const drawing = useMarkDrawing(svgRef, { enabled: step === 'marks', tool: markTool, size: markSize })

  // ===== STATE: STYLE AND SCENE ANALYSIS =====
  const [style, setStyle] = useState(null)
  // Framing and location are already done; the wait starts on the title.
  const analysisProgress = useStagedProgress({ count: 4, start: 2, stepMs: 7000, active: step === 'analyzing' })

  const ratio = resolveAspectRatio(aspectRatioKey, naturalSize, customRatio)

  // Fit the crop frame into the stage at the chosen ratio.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    function recompute() {
      const styles = getComputedStyle(container)
      const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight)
      const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom)
      const availableWidth = container.clientWidth - padX
      const availableHeight = container.clientHeight - padY
      if (availableWidth <= 0 || availableHeight <= 0) return
      const heightAtFullWidth = availableWidth / ratio
      if (heightAtFullWidth <= availableHeight) {
        setBoxSize({ width: availableWidth, height: heightAtFullWidth })
      } else {
        setBoxSize({ width: availableHeight * ratio, height: availableHeight })
      }
    }
    recompute()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recompute) : null
    ro?.observe(container)
    window.addEventListener('resize', recompute)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', recompute)
    }
  }, [ratio, step, preview])

  // ===== CLOSE =====

  // Leaving during setup discards the half-made sketch, so the close
  // button asks first once a photo is uploaded (confirmingClose). Before
  // that there is nothing to lose. While the analysis runs, the sketch is
  // kept, so it closes without asking.
  const [confirmingClose, setConfirmingClose] = useState(false)

  function requestClose() {
    if (sketchId && step !== 'analyzing') setConfirmingClose(true)
    else closeWizard()
  }

  async function closeWizard() {
    setConfirmingClose(false)
    if (sketchId && step !== 'analyzing') {
      try {
        await api.delete(`/api/sketches/${sketchId}`)
      } catch {
        // Best-effort cleanup
      }
    }
    notifySketchesChanged()
    navigate(backgroundLocation || '/profile')
  }

  // ===== STEP 1: REFERENCE PHOTO =====

  // Retake / Choose another. Once the photo is uploaded, replacing it
  // deletes the sketch, so ask first.
  function pickPhoto(source) {
    if (sketchId) {
      setReplaceWith(source)
      return
    }
    ;(source === 'camera' ? cameraInputRef : libraryInputRef).current?.click()
  }

  async function discardSketch() {
    try {
      await api.delete(`/api/sketches/${sketchId}`)
    } catch {
      // Best effort
    }
    setSketchId(null)
    setOriginalImageUrl(null)
    setReferenceImageUrl(null)
    setUploadedFile(null)
    setUploadedLocation(null)
    drawing.clear()
    setStyle(null)
    setAspectRatioKey('original')
    setCustomRatio(null)
    resetTransform()
    savedTransformRef.current = null
  }

  // HEIC photos need converting before they can be previewed (previewUrl).
  // pickRef drops a slow conversion if another photo was picked meanwhile.
  async function handleFile(e) {
    const f = e.target.files?.[0]
    e.target.value = '' // the same file can be picked again
    if (!f) return
    const pick = ++pickRef.current
    setError(null)
    try {
      const url = await previewUrl(f)
      if (pick !== pickRef.current) return URL.revokeObjectURL(url)
      if (preview) URL.revokeObjectURL(preview)
      setFile(f)
      setPreview(url)
    } catch {
      if (pick === pickRef.current) setError('Could not open this photo. Try a JPEG or PNG.')
    }
  }

  function clearPhoto() {
    pickRef.current++
    if (preview) URL.revokeObjectURL(preview)
    setFile(null)
    setPreview(null)
  }

  async function handleUsePhoto() {
    if (uploadedFile === file && sketchId) {
      setStep('crop')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('image', file)
      const { data } = await api.post('/api/sketches', form)
      setSketchId(data.id)
      setUploadedFile(file)
      setOriginalImageUrl(resolveUrl(data.original_image_url || data.reference_image_url))
      setReferenceImageUrl(resolveUrl(data.reference_image_url))
      setUploadedLocation(data.location || null)
      setStep('crop')
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save this photo.')
    } finally {
      setSaving(false)
    }
  }

  // ===== STEP 2: CROP AND REFRAME =====

  function setZoomTracked(z) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
    zoomRef.current = clamped
    setZoom(clamped)
  }

  function setOffsetTracked(o) {
    offsetRef.current = o
    setOffset(o)
  }

  function resetTransform(next = { zoom: 1, offset: { x: 0, y: 0 } }) {
    setZoomTracked(next.zoom)
    setOffsetTracked(next.offset)
  }

  function handleRatio(key) {
    setAspectRatioKey(key)
    setCustomRatio(null)
    resetTransform()
  }

  function handlePointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointersRef.current.size === 1) {
      gestureRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, startOffset: offsetRef.current }
    } else if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values())
      gestureRef.current = { mode: 'pinch', startDistance: pointerDistance(pts[0], pts[1]), startZoom: zoomRef.current }
    }
  }

  function handlePointerMove(e) {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gestureRef.current
    if (!g || !boxSize.width || !boxSize.height) return
    if (g.mode === 'pan') {
      setOffsetTracked({
        x: g.startOffset.x + (e.clientX - g.startX) / boxSize.width,
        y: g.startOffset.y + (e.clientY - g.startY) / boxSize.height,
      })
    } else if (g.mode === 'pinch') {
      const pts = Array.from(pointersRef.current.values())
      if (pts.length < 2) return
      setZoomTracked(g.startZoom * (pointerDistance(pts[0], pts[1]) / g.startDistance))
    }
  }

  function handlePointerUp(e) {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size === 0) {
      gestureRef.current = null
    } else if (pointersRef.current.size === 1) {
      const [[, pt]] = Array.from(pointersRef.current.entries())
      gestureRef.current = { mode: 'pan', startX: pt.x, startY: pt.y, startOffset: offsetRef.current }
    }
  }

  function handleWheel(e) {
    e.preventDefault()
    setZoomTracked(zoomRef.current * (1 - e.deltaY * 0.0015))
  }

  // Corner crop. A corner drag shrinks the frame from that corner while the
  // opposite corner stays put. Original (and a custom crop) is free; 3:4,
  // 1:1 and 4:3 keep their shape. On release the frame refits the stage
  // and the photo zooms so the dragged area fills it (reframeToRect).
  const cornerHandlers = {
    down(corner, e) {
      e.stopPropagation() // not a pan
      if (!box) return
      e.currentTarget.setPointerCapture(e.pointerId)
      const { width: W, height: H } = boxSize
      // Corners stay on the photo. Zoomed out, the frame's own corners sit
      // in the black margin, so the crop starts from the photo's edges.
      const bounds = {
        x0: Math.max(0, box.left),
        x1: Math.min(W, box.left + box.width),
        y0: Math.max(0, box.top),
        y1: Math.min(H, box.top + box.height),
      }
      const locked = aspectRatioKey !== 'original' && aspectRatioKey !== 'custom'
      cornerRef.current = {
        corner,
        bounds,
        startX: e.clientX,
        startY: e.clientY,
        // The corner that doesn't move.
        anchorX: corner.includes('l') ? bounds.x1 : bounds.x0,
        anchorY: corner.includes('t') ? bounds.y1 : bounds.y0,
        lockRatio: locked ? W / H : null,
      }
    },
    move(e) {
      const c = cornerRef.current
      if (!c) return
      e.stopPropagation()
      const { x0, x1, y0, y1 } = c.bounds
      const { width: W, height: H } = boxSize
      // Where the dragged corner is now, kept on the photo.
      const cornerX = Math.min(x1, Math.max(x0, (c.corner.includes('l') ? 0 : W) + (e.clientX - c.startX)))
      const cornerY = Math.min(y1, Math.max(y0, (c.corner.includes('t') ? 0 : H) + (e.clientY - c.startY)))
      let w = Math.min(x1 - x0, Math.max(W * MIN_CROP, Math.abs(c.anchorX - cornerX)))
      let h = Math.min(y1 - y0, Math.max(H * MIN_CROP, Math.abs(c.anchorY - cornerY)))
      if (c.lockRatio) {
        if (w / h > c.lockRatio) w = h * c.lockRatio
        else h = w / c.lockRatio
      }
      setCropRect({
        x: c.anchorX === x0 ? x0 : x1 - w,
        y: c.anchorY === y0 ? y0 : y1 - h,
        width: w,
        height: h,
      })
    },
    up(e) {
      const c = cornerRef.current
      cornerRef.current = null
      if (!c) return
      e.stopPropagation()
      const rect = cropRect
      setCropRect(null)
      if (!rect || !box || (rect.width >= boxSize.width - 1 && rect.height >= boxSize.height - 1)) return
      const next = reframeToRect(rect, box, naturalSize.width, naturalSize.height)
      if (!c.lockRatio) {
        setAspectRatioKey('custom')
        setCustomRatio(rect.width / rect.height)
      }
      resetTransform(next)
    },
  }

  function handleImageLoad(e) {
    setNaturalSize({ width: e.target.naturalWidth, height: e.target.naturalHeight })
  }

  // ===== STEP 3: MARKS (saves crop and marks together) =====

  // Back to framing: marks were drawn against the current frame, so
  // they're cleared rather than left misaligned.
  function handleBackToCrop() {
    drawing.clear()
    setStep('crop')
  }

  async function handleConfirmFrame(skipMarks = false) {
    setSaving(true)
    setError(null)
    try {
      const finalTransform = { zoom: zoomRef.current, offset_x: offsetRef.current.x, offset_y: offsetRef.current.y }
      // Focal points are retired: marks are the one plan (design doc,
      // item 17). The endpoint still takes the two point lists, empty.
      const form = new FormData()
      form.append('old_points', '[]')
      form.append('new_points', '[]')
      form.append('marks', JSON.stringify(skipMarks ? [] : drawing.marks))

      const transformChanged =
        aspectRatioKey !== 'original' ||
        finalTransform.zoom !== initialTransformRef.current.zoom ||
        finalTransform.offset_x !== initialTransformRef.current.offset_x ||
        finalTransform.offset_y !== initialTransformRef.current.offset_y

      if (transformChanged) {
        const blob = await bakeCrop({
          imageEl: imgRef.current,
          naturalSize,
          aspectRatioKey,
          customRatio,
          zoom: finalTransform.zoom,
          offset: { x: finalTransform.offset_x, y: finalTransform.offset_y },
        })
        form.append('framed_image', blob, 'framed.jpg')
        form.append('crop_transform', JSON.stringify({
          aspect_ratio: aspectRatioKey,
          ...(aspectRatioKey === 'custom' && { ratio: customRatio }),
          ...finalTransform,
        }))
      }

      const { data } = await api.post(`/api/sketches/${sketchId}/focal-frame`, form)
      if (data?.reference_image_url) setReferenceImageUrl(resolveUrl(data.reference_image_url))
      // Skipped marks weren't saved, so don't keep showing them.
      if (skipMarks) drawing.clear()
      savedTransformRef.current = { zoom: finalTransform.zoom, offset: { x: finalTransform.offset_x, y: finalTransform.offset_y } }
      setStep('style')
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save your framing and marks.')
    } finally {
      setSaving(false)
    }
  }

  function handleBackToMarks() {
    if (savedTransformRef.current) resetTransform(savedTransformRef.current)
    setStep('marks')
  }

  // ===== STEP 5: STYLE, THEN SCENE ANALYSIS =====

  // Picking a card saves the style straight away, so the sketch keeps it
  // even if the sketcher leaves before "Analyze scene". Not awaited:
  // handleAnalyze saves it again anyway.
  function handleStylePick(value) {
    setStyle(value)
    api.put(`/api/sketches/${sketchId}`, { style: value }).catch((err) => console.warn('Could not save style', err))
  }

  // Runs the scene analysis, then opens the sketch in the workspace
  // (EditSketch, create mode) on the Guide tab with this analysis.
  async function handleAnalyze() {
    if (!style) return
    setStep('analyzing')
    setError(null)
    try {
      await api.put(`/api/sketches/${sketchId}`, { style })
      // No image upload: the backend reads the saved reference photo, and
      // the marks saved with it, from the sketch itself.
      const form = new FormData()
      form.append('sketch_id', sketchId)
      form.append('style', style)
      const { data } = await api.post('/api/scene-analysis', form)
      navigate(`/sketches/${sketchId}`, {
        replace: true,
        state: { backgroundLocation, mode: 'create', analysis: data },
      })
    } catch (err) {
      setError(err.response?.data?.detail || 'Scene analysis failed. Try again.')
      setStep('style')
    }
  }

  // ===== RENDER =====

  const stepIndex = step === 'analyzing' ? STEPS.length : STEPS.findIndex((s) => s.key === step)
  const box =
    naturalSize && boxSize.width && boxSize.height
      ? computeImageBox(boxSize.width, boxSize.height, naturalSize.width, naturalSize.height, zoom, offset.x, offset.y)
      : null
  const onPhotoSteps = step === 'crop' || step === 'marks'
  const stageHandlers =
    step === 'crop'
      ? { onPointerDown: handlePointerDown, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp, onPointerCancel: handlePointerUp, onWheel: handleWheel }
      : step === 'marks'
        ? drawing.handlers
        : {}
  const styleLabel = STYLES.find((s) => s.value === style)?.label

  // The sketcher's plan on a 0-1000 frame: their marks.
  const planLayer = () => <MarksLayer marks={drawing.marks} live={drawing.live} />

  // Photo and Plan side by side (scene analysis). The outer SVG keeps the
  // frame's shape; the inner one is the usual 0-1000 overlay space.
  const planCard = (label, withPlan) => (
    <figure className="flex min-w-0 flex-1 flex-col gap-1.5">
      {/* The plan card scans while the AI reads it. */}
      <div className={`relative overflow-hidden rounded-xl ${withPlan && step === 'analyzing' ? 'sc-scan' : ''}`}>
        <svg viewBox={`0 0 ${Math.round(1000 * ratio)} 1000`} className="block h-auto max-h-[60vh] w-full">
          <svg x="0" y="0" width={Math.round(1000 * ratio)} height="1000" viewBox="0 0 1000 1000" preserveAspectRatio="none">
            <image href={referenceImageUrl || originalImageUrl} width="1000" height="1000" preserveAspectRatio="none"
              opacity={withPlan ? 0.75 : 1} />
            {withPlan && planLayer()}
          </svg>
        </svg>
      </div>
      <figcaption className="text-base font-bold text-sc-text2">{label}</figcaption>
    </figure>
  )

  return (
    <SketchModal title="New Sketch" onClose={requestClose}>
      <ConfirmDialog
        open={confirmingClose}
        title="Discard this sketch?"
        message="Closing now deletes this sketch: the photo, the framing and any marks."
        confirmLabel="Discard sketch"
        cancelLabel="Keep working"
        onConfirm={closeWizard}
        onCancel={() => setConfirmingClose(false)}
      />
      <ConfirmDialog
        open={!!replaceWith}
        title="Replace this photo?"
        message="A new photo starts this sketch over. Your framing and marks will be deleted."
        confirmLabel="Replace photo"
        cancelLabel="Keep this one"
        onConfirm={async () => {
          const source = replaceWith
          setReplaceWith(null)
          await discardSketch()
          ;(source === 'camera' ? cameraInputRef : libraryInputRef).current?.click()
        }}
        onCancel={() => setReplaceWith(null)}
      />
      <input ref={libraryInputRef} type="file" accept="image/*,.heic" onChange={handleFile} className="hidden" />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />

      {/* ===== LEFT: PHOTO STAGE ===== */}
      <div className="relative flex min-h-[55vh] flex-1 flex-col bg-sc-modal md:min-h-0">
        {step === 'photo' && !preview && (
          <div className="flex flex-1 p-5 md:p-[var(--stage-inset)]">
            <div className="sc-dropzone">
               <img src={cameraWhite} alt="camera" className="h-16 w-16 text-white" />
              <p className="font-heading text-xl font-semibold leading-snug">Photograph the scene you'll draw</p>
              <p className="max-w-[270px] text-base text-sc-text3">
                Stand where you'll sketch from. Location and a title come from this photo.
              </p>
            </div>
          </div>
        )}

        {step === 'photo' && preview && (
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-3 md:inset-[var(--stage-inset)]">
              <img src={preview} alt="Reference photo" className="h-full w-full animate-fade-in-scale object-contain" />
            </div>
          </div>
        )}

        {(onPhotoSteps || step === 'style') && (
          <ImagePanel
            containerRef={containerRef}
            imgRef={imgRef}
            svgRef={svgRef}
            boxSize={boxSize}
            // bakeCrop draws this <img> onto a canvas. Without CORS loading,
            // the backend photo taints the canvas and the export fails.
            crossOrigin="anonymous"
            imageClassName={step === 'marks' && markBlackAndWhite ? 'photo-bw' : ''}
            // Crop and marks work on the original upload through the
            // frame. From Style on, the photo is the saved framed image.
            imageUrl={onPhotoSteps ? originalImageUrl : referenceImageUrl || originalImageUrl}
            zoom={zoom}
            offset={offset}
            box={
              step === 'style' && box
                ? { width: boxSize.width, height: boxSize.height, left: 0, top: 0 }
                : box
            }
            heightClass="min-h-0 flex-1"
            cropFrame={step === 'crop'}
            cropRect={cropRect}
            cornerHandlers={step === 'crop' ? cornerHandlers : undefined}
            onPointerDown={stageHandlers.onPointerDown}
            onPointerMove={stageHandlers.onPointerMove}
            onPointerUp={stageHandlers.onPointerUp}
            onPointerCancel={stageHandlers.onPointerCancel}
            onWheel={stageHandlers.onWheel}
            onImageLoad={onPhotoSteps ? handleImageLoad : undefined}
          >
            <Fade show={step !== 'crop'}>{planLayer()}</Fade>
          </ImagePanel>
        )}

        {step === 'analyzing' && (
          <div className="flex min-h-0 flex-1 items-center gap-3 p-5 md:p-[var(--stage-inset)]">
            {planCard('Photo', false)}
            {planCard(`Plan · ${styleLabel || ''}`, true)}
          </div>
        )}

        {STAGE_HINTS[step] && (
          <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-[10px] border-[1.5px] border-sc-rail-border bg-sc-rail px-3 py-2 text-base font-medium">
            {STAGE_HINTS[step]}
          </p>
        )}
      </div>

      {/* ===== RIGHT: STEP PANEL ===== */}
      <div className="sc-panel">
        <div className="flex shrink-0 flex-col gap-2 border-b border-sc-divider px-4 pb-3 pt-4">
          <div className="sc-progress" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span key={s.key} data-state={i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo'} />
            ))}
          </div>
          <div className="flex items-baseline justify-between">
            <span className="whitespace-nowrap text-md font-semibold text-white">
              {step === 'analyzing' ? 'Scene analysis' : STEPS[stepIndex].name}
            </span>
            <span className="whitespace-nowrap text-sm font-semibold text-sc-text3">
              {step === 'analyzing' ? 'Almost done' : `${stepIndex + 1} of ${STEPS.length}`}
            </span>
          </div>
        </div>

        <div className="sc-panel-body">
          {step === 'photo' && !preview && (
            <p className="sc-body">Take the photo from where you'll sit or stand, or pick one you took there.</p>
          )}
          {step === 'photo' && preview && (
            <>
              <p className="text-base text-sc-text2">Is the subject in focus and fully in frame?</p>
              <div className="flex gap-2">
                <Button variant="choice" className="flex-1 text-center" onClick={() => pickPhoto('camera')} disabled={saving}>
                  Retake
                </Button>
                <Button variant="choice" className="flex-1 text-center" onClick={() => pickPhoto('library')} disabled={saving}>
                  Choose another
                </Button>
              </div>
            </>
          )}

          {step === 'crop' && (
            <div className="flex gap-1" role="group" aria-label="Frame shape">
              {ASPECT_RATIO_ORDER.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={aspectRatioKey === key}
                  onClick={() => handleRatio(key)}
                  className={`h-11 flex-1 whitespace-nowrap rounded-[10px] text-base font-semibold ${
                    aspectRatioKey === key ? 'bg-sc-border text-white' : 'text-sc-text2 hover:text-white'
                  } ${key === 'original' ? 'flex-[1.3]' : ''}`}
                >
                  {RATIO_LABELS[key] || key}
                </button>
              ))}
            </div>
          )}

          {step === 'marks' && (
            <MarkPanel
              tool={markTool}
              onToolChange={setMarkTool}
              size={markSize}
              onSizeChange={setMarkSize}
              blackAndWhite={markBlackAndWhite}
              onBlackAndWhiteChange={setMarkBlackAndWhite}
              count={drawing.count}
              canUndo={drawing.canUndo}
              onUndo={drawing.undo}
              disabled={saving}
            />
          )}

          {step === 'style' && (
            <>
              <p className="sc-body">Guide questions are tuned to the style you pick.</p>
              <StylePicker style={style} onSelectStyle={handleStylePick} />
            </>
          )}

          {step === 'analyzing' && (
            <ProgressSteps
              heading="Reading your scene…"
              current={analysisProgress.current}
              seconds={analysisProgress.seconds}
              steps={[
                { label: 'Framing and marks' },
                { label: 'Location', result: uploadedLocation?.label || 'Not in photo' },
                { label: 'Scene title' },
                { label: 'Guide questions' },
              ]}
            />
          )}

          {error && <p className="text-base text-accent">{error}</p>}
        </div>

        {/* ===== FOOTER: Back · Skip · Next ===== */}
        {step !== 'analyzing' && (
          <div className="sc-footer">
            {step === 'photo' && !preview && (
              <>
                <Button variant="secondaryOnDark" onClick={() => libraryInputRef.current?.click()}>From library</Button>
                <Button variant="action" onClick={() => cameraInputRef.current?.click()}>Take photo</Button>
              </>
            )}
            {step === 'photo' && preview && (
              <>
                <Button variant="secondaryOnDark" className="mr-auto" onClick={clearPhoto} disabled={saving || !!sketchId}>Back</Button>
                <Button variant="action" onClick={handleUsePhoto} disabled={saving}>{saving ? 'Saving…' : 'Use photo'}</Button>
              </>
            )}
            {step === 'crop' && (
              <>
                <Button variant="secondaryOnDark" className="mr-auto" onClick={() => setStep('photo')}>Back</Button>
                <Button variant="action" onClick={() => setStep('marks')} disabled={!box}>Next</Button>
              </>
            )}
            {step === 'marks' && (
              <>
                <Button variant="secondaryOnDark" className="mr-auto" onClick={handleBackToCrop} disabled={saving}>Back</Button>
                <Button variant="quietOnDark" onClick={() => handleConfirmFrame(true)} disabled={saving}>Skip</Button>
                <Button variant="action" onClick={() => handleConfirmFrame()} disabled={saving}>{saving ? 'Saving…' : 'Next'}</Button>
              </>
            )}
            {step === 'style' && (
              <>
                <Button variant="secondaryOnDark" className="mr-auto" onClick={handleBackToMarks}>Back</Button>
                <Button variant="action" onClick={handleAnalyze} disabled={!style}>Analyze scene</Button>
              </>
            )}
          </div>
        )}
      </div>
    </SketchModal>
  )
}
