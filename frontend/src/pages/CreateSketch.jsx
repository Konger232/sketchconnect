import { useEffect, useRef, useState, useLayoutEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ImagePanel from '../components/analysis/ImagePanel'
import MarkPanel, { DEFAULT_MARK_COLOR, DEFAULT_MARK_SIZE, MarkRail, MarksLayer, SELECT_HINT, useMarkDrawing } from '../components/analysis/Marks'
import Fade from '../components/analysis/Fade'

import Button from '../components/common/Button'
import ProgressSteps from '../components/common/ProgressSteps'
import ConfirmDialog from '../components/common/ConfirmDialog'
import SketchModal from '../components/common/SketchModal'

import { api } from '../lib/api'
import { runGuideAnalysis, startSceneAnalysis } from '../lib/guideAnalysis'
import { notifySketchesChanged } from '../lib/sketchEvents'
import { previewUrl } from '../lib/previewUrl'
import { useStagedProgress } from '../lib/useStagedProgress'
import { ASPECT_RATIO_ORDER, bakeCrop, computeImageBox, reframeToRect, resolveAspectRatio } from '../lib/cropMath'

import cameraWhite from '../assets/images/ico_camera_w.png'

const MIN_ZOOM = 0.2
const MAX_ZOOM = 8
// Smallest frame a corner drag can leave, as a share of each side.
const MIN_CROP = 0.2

// New Sketch setup, in order (design handoff). 'analyzing' follows the
// steps, then the sketch opens in EditSketch's workspace with the plan read
// (design doc, item 25). Style is picked later, with the final sketch.
const STEPS = [
  { key: 'photo', name: 'Reference photo' },
  { key: 'crop', name: 'Crop and reframe' },
  { key: 'marks', name: 'Plan what to sketch' },
  { key: 'media', name: 'What you draw with' },
]

// The media card (item 25), the same keys as the backend (plan_read.MEDIA).
// Pick any number; the tips may name only these. None: tool-free tips.
const MEDIA = [
  { group: 'Line', items: [['fineliner', 'Waterproof fineliner'], ['fountain_pen', 'Fountain pen'], ['pencil', 'Pencil']] },
  { group: 'Color', items: [['watercolor', 'Watercolor'], ['gouache', 'Gouache'], ['markers', 'Markers'], ['watercolor_pencils', 'Watercolor pencils'], ['pastels', 'Pastels']] },
]

// The frame as the crop step leaves it, to tell whether it changed since
// it was last saved.
function sameFrame(a, b) {
  return !!a && !!b && a.aspect_ratio === b.aspect_ratio && a.ratio === b.ratio &&
    a.zoom === b.zoom && a.offset_x === b.offset_x && a.offset_y === b.offset_y
}
const UNTOUCHED_FRAME = { aspect_ratio: 'original', ratio: null, zoom: 1, offset_x: 0, offset_y: 0 }

// The hint over the photo on the photo steps.
const STAGE_HINTS = {
  crop: 'Drag corners to crop. Pinch to zoom.',
  marks: 'Select shapes or edges you care about',
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

  // 'photo' | 'crop' | 'marks' | 'media' | 'analyzing'
  const [step, setStep] = useState('photo')
  // The media card's picks. Pre-filled from the sketcher's last sketch.
  const [media, setMedia] = useState([])
  const mediaLoadedRef = useRef(false)
  // Skip on the marks step: the plan is sent with no strokes.
  const skipMarksRef = useRef(false)

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
  // The frame last saved on the server (sameFrame). The upload itself is
  // the untouched frame, so Next with no change saves nothing.
  const savedFrameRef = useRef(UNTOUCHED_FRAME)
  // The scene analysis started when the crop was confirmed (a promise of
  // its result, or null). The guide waits for it after the marks.
  const sceneRef = useRef(null)

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
  // One colour for every mark: picking another redraws them all.
  const [markColor, setMarkColor] = useState(DEFAULT_MARK_COLOR)
  const drawing = useMarkDrawing(svgRef, { enabled: step === 'marks', tool: markTool, size: markSize, color: markColor })

  // Back from the plan card (EditSketch, New Sketch): reopen this sketch at
  // the strokes step, with its photo, crop and strokes, so the sketcher can
  // change the plan and have it read again (design doc, item 25).
  const resumeId = routerLocation.state?.resumeSketchId
  useEffect(() => {
    if (!resumeId) return
    let cancelled = false
    api.get(`/api/sketches/${resumeId}`).then(({ data }) => {
      if (cancelled) return
      setSketchId(data.id)
      setOriginalImageUrl(resolveUrl(data.original_image_url || data.reference_image_url))
      setReferenceImageUrl(resolveUrl(data.reference_image_url))
      setUploadedLocation(data.location || null)
      const t = data.crop_transform || {}
      const frame = {
        aspect_ratio: t.aspect_ratio || 'original',
        ratio: t.aspect_ratio === 'custom' ? t.ratio ?? null : null,
        zoom: t.zoom ?? 1,
        offset_x: t.offset_x ?? 0,
        offset_y: t.offset_y ?? 0,
      }
      setAspectRatioKey(frame.aspect_ratio)
      setCustomRatio(frame.ratio)
      resetTransform({ zoom: frame.zoom, offset: { x: frame.offset_x, y: frame.offset_y } })
      savedFrameRef.current = frame
      drawing.setMarks(data.marks || [])
      if (data.media?.length) {
        setMedia(data.media)
        mediaLoadedRef.current = true
      }
      setStep('marks')
    }).catch(() => setError('Could not reopen this sketch.'))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId])

  // The media card opens with the last sketch's picks.
  useEffect(() => {
    if (step !== 'media' || mediaLoadedRef.current) return
    mediaLoadedRef.current = true
    api.get('/api/sketch-media/last').then(({ data }) => {
      if (data?.media?.length) setMedia((cur) => (cur.length ? cur : data.media))
    }).catch(() => {})
  }, [step])

  function toggleMedia(key) {
    setMedia((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))
  }
  function handleMarkColor(key) {
    setMarkColor(key)
    drawing.recolor(key)
  }
  // The Marks tools' props: the right panel (tablet, desktop) and the
  // floating rail on the photo (phone) share them.
  const markTools = {
    tool: markTool,
    onToolChange: setMarkTool,
    size: markSize,
    onSizeChange: setMarkSize,
    color: markColor,
    onColorChange: handleMarkColor,
    count: drawing.count,
    canUndo: drawing.canUndo,
    onUndo: drawing.undo,
  }

  // ===== STATE: ANALYSIS =====
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

  // The sketch only counts as created at Start Sketching (EditSketch,
  // create mode). Until then, closing asks first once a photo is uploaded
  // (confirmingClose), including while the analysis runs: Discard deletes
  // the sketch and everything saved with it. Before the upload there is
  // nothing to lose.
  const [confirmingClose, setConfirmingClose] = useState(false)
  const confirmingCloseRef = useRef(false)
  // The running analysis: its abort, and its result when it finished
  // while the dialog was open (shown once the sketcher keeps editing).
  const analysisAbortRef = useRef(null)
  const discardedRef = useRef(false)
  const finishedAnalysisRef = useRef(null)

  function setConfirming(open) {
    confirmingCloseRef.current = open
    setConfirmingClose(open)
  }

  function requestClose() {
    if (sketchId) setConfirming(true)
    else leave()
  }

  function leave() {
    notifySketchesChanged()
    navigate(backgroundLocation || '/profile')
  }

  // Keep editing: back to the step, or on to the guided questions if the
  // analysis finished meanwhile.
  function keepEditing() {
    setConfirming(false)
    const data = finishedAnalysisRef.current
    if (data) {
      finishedAnalysisRef.current = null
      openGuidedQuestions(data)
    }
  }

  async function discardAndClose() {
    setConfirming(false)
    discardedRef.current = true
    analysisAbortRef.current?.abort()
    try {
      await api.delete(`/api/sketches/${sketchId}`)
    } catch {
      // Best-effort cleanup
    }
    leave()
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
    setAspectRatioKey('original')
    setCustomRatio(null)
    resetTransform()
    savedFrameRef.current = UNTOUCHED_FRAME
    sceneRef.current = null
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

  // ===== CROP CONFIRMED: SAVE THE FRAME, START THE SCENE ANALYSIS =====

  // Next on the crop step. A changed frame is baked and saved first, since
  // the scene analysis reads the saved framed photo. The scene analysis
  // then runs in the background while the sketcher draws marks.
  async function handleConfirmCrop() {
    const frame = {
      aspect_ratio: aspectRatioKey,
      ratio: aspectRatioKey === 'custom' ? customRatio : null,
      zoom: zoomRef.current,
      offset_x: offsetRef.current.x,
      offset_y: offsetRef.current.y,
    }
    if (!sameFrame(frame, savedFrameRef.current)) {
      setSaving(true)
      setError(null)
      try {
        const blob = await bakeCrop({
          imageEl: imgRef.current,
          naturalSize,
          aspectRatioKey,
          customRatio,
          zoom: frame.zoom,
          offset: { x: frame.offset_x, y: frame.offset_y },
        })
        const form = new FormData()
        // Focal points are retired: marks are the one plan (design doc,
        // item 17). The endpoint still takes the two point lists, empty.
        form.append('old_points', '[]')
        form.append('new_points', '[]')
        form.append('framed_image', blob, 'framed.jpg')
        form.append('crop_transform', JSON.stringify({
          aspect_ratio: aspectRatioKey,
          ...(aspectRatioKey === 'custom' && { ratio: customRatio }),
          zoom: frame.zoom,
          offset_x: frame.offset_x,
          offset_y: frame.offset_y,
        }))
        const { data } = await api.post(`/api/sketches/${sketchId}/focal-frame`, form)
        if (data?.reference_image_url) setReferenceImageUrl(resolveUrl(data.reference_image_url))
        savedFrameRef.current = frame
        sceneRef.current = null // that analysis read the old frame
      } catch (err) {
        setError(err.response?.data?.detail || 'Could not save your framing.')
        return
      } finally {
        setSaving(false)
      }
    }
    if (!sceneRef.current) sceneRef.current = startSceneAnalysis(sketchId)
    setStep('marks')
  }

  // ===== STEP 3: MARKS, THEN THE GUIDE =====

  // Back to framing: marks were drawn against the current frame, so
  // they're cleared rather than left misaligned.
  function handleBackToCrop() {
    drawing.clear()
    setStep('crop')
  }

  // Next (or Skip) on the marks step: save the marks, then wait for the
  // scene analysis and run the marks analysis, which writes the guide.
  // Next (or Skip) on the marks step: on to the media card.
  function handleMarksDone(skipMarks = false) {
    skipMarksRef.current = skipMarks
    setStep('media')
  }

  async function handleAnalyze(skipMarks = skipMarksRef.current) {
    setSaving(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('old_points', '[]')
      form.append('new_points', '[]')
      form.append('marks', JSON.stringify(skipMarks ? [] : drawing.marks))
      await api.post(`/api/sketches/${sketchId}/focal-frame`, form)
      // Skipped marks weren't saved, so don't keep showing them.
      if (skipMarks) drawing.clear()
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save your plan.')
      return
    } finally {
      setSaving(false)
    }

    setStep('analyzing')
    try {
      const abort = new AbortController()
      analysisAbortRef.current = abort
      const data = await runGuideAnalysis(sketchId, { scene: sceneRef.current, signal: abort.signal, media })
      if (discardedRef.current) return
      // Finished while "Discard this sketch?" is open: wait for the answer.
      if (confirmingCloseRef.current) finishedAnalysisRef.current = data
      else openGuidedQuestions(data)
    } catch (err) {
      if (discardedRef.current) return
      setError(err.response?.data?.detail || 'Scene analysis failed. Try again.')
      sceneRef.current = null
      setStep('media')
    } finally {
      analysisAbortRef.current = null
    }
  }

  function openGuidedQuestions(data) {
    navigate(`/sketches/${sketchId}`, {
      replace: true,
      state: { backgroundLocation, mode: 'create', analysis: data },
    })
  }

  // ===== RENDER =====

  const stepIndex = step === 'analyzing' ? STEPS.length : STEPS.findIndex((s) => s.key === step)
  const box =
    naturalSize && boxSize.width && boxSize.height
      ? computeImageBox(boxSize.width, boxSize.height, naturalSize.width, naturalSize.height, zoom, offset.x, offset.y)
      : null
  const onPhotoSteps = step === 'crop' || step === 'marks' || step === 'media'
  const stageHandlers =
    step === 'crop'
      ? { onPointerDown: handlePointerDown, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp, onPointerCancel: handlePointerUp, onWheel: handleWheel }
      : step === 'marks'
        ? drawing.handlers
        : {}

  // The sketcher's plan on a 0-1000 frame: their marks.
  const planLayer = () => <MarksLayer marks={drawing.marks} live={drawing.live} />

  // Photo and Plan side by side (scene analysis). The outer SVG keeps the
  // frame's shape; the inner one is the usual 0-1000 overlay space.
  // While the AI reads it: the Plan, full width like every other step,
  // scanning, with its label under it like Edit Sketch's strip.
  const planCard = (label, withPlan) => (
    <figure className="flex w-full min-w-0 flex-col md:min-h-0 md:flex-1">
      <div className={`relative overflow-hidden md:min-h-0 md:flex-1 ${withPlan && step === 'analyzing' ? 'sc-scan' : ''}`}>
        <svg viewBox={`0 0 ${Math.round(1000 * ratio)} 1000`} className="block h-auto max-h-[75vh] w-full md:h-full md:max-h-none">
          <svg x="0" y="0" width={Math.round(1000 * ratio)} height="1000" viewBox="0 0 1000 1000" preserveAspectRatio="none">
            <image href={referenceImageUrl || originalImageUrl} width="1000" height="1000" preserveAspectRatio="none"
              opacity={withPlan ? 0.75 : 1} />
            {withPlan && planLayer()}
          </svg>
        </svg>
      </div>
      <figcaption className="shrink-0 pb-3 pt-2 text-center text-base font-bold text-white">{label}</figcaption>
    </figure>
  )

  return (
    <SketchModal title="New Sketch" onClose={requestClose}>
      <ConfirmDialog
        open={confirmingClose}
        title="Discard this sketch?"
        message="Closing now deletes this sketch: the photo, the framing, your plan and the scene analysis."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={discardAndClose}
        onCancel={keepEditing}
      />
      <ConfirmDialog
        open={!!replaceWith}
        title="Replace this photo?"
        message="A new photo starts this sketch over. Your framing and plan will be deleted."
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
      {/* The photo is shown the same way as in Edit Sketch, on every step:
          the full width of the stage. On a phone the stage is as tall as
          the photo or frame (at most 75vh), so the panel below moves up;
          from 768px it fills the left side, inset top and bottom only.
          --frame-ratio is the frame's width / height. Only the empty photo
          step (the camera button) keeps a fixed height. */}
      <div
        className={`relative flex flex-col bg-sc-modal md:min-h-0 md:flex-1 ${step === 'photo' && !preview ? 'min-h-[55vh] flex-1' : 'flex-none'}`}
        style={{ '--frame-ratio': ratio }}
      >
        {step === 'photo' && !preview && (
          <div className="flex flex-1 p-5 md:p-[var(--stage-inset)]">
            <Button className="w-full h-full flex flex-1 p-0 block reset-button-styles"
              onClick={() => cameraInputRef.current?.click()}>
              <div className="sc-dropzone">
                <img src={cameraWhite} alt="camera" className="h-16 w-16 text-white" />
                <p className="font-heading text-xl font-semibold leading-snug">Photograph the scene you'll draw</p>
                <p className="max-w-[270px] text-base text-sc-text3">
                  Stand where you'll sketch from. Location and a title come from this photo.
                </p>
              </div>
            </Button>
          </div>
        )}

        {step === 'photo' && preview && (
          <div className="relative min-h-0 flex-1">
            <div className="relative md:absolute md:inset-x-0 md:inset-y-[var(--stage-inset)]">
              <img src={preview} alt="Reference photo" className="block h-auto max-h-[75vh] w-full animate-fade-in-scale object-contain md:h-full md:max-h-none" />
            </div>
          </div>
        )}

        {onPhotoSteps && (
          <ImagePanel
            containerRef={containerRef}
            imgRef={imgRef}
            svgRef={svgRef}
            boxSize={boxSize}
            // bakeCrop draws this <img> onto a canvas. Without CORS loading,
            // the backend photo taints the canvas and the export fails.
            crossOrigin="anonymous"
            // Crop and marks work on the original upload through the frame.
            imageUrl={originalImageUrl}
            zoom={zoom}
            offset={offset}
            box={box}
            heightClass="max-md:aspect-[var(--frame-ratio)] max-md:max-h-[75vh] md:min-h-0 md:flex-1"
            padClass="p-0 md:px-0 md:py-[var(--stage-inset)]"
            cropFrame={step === 'crop'}
            cropRect={cropRect}
            cornerHandlers={step === 'crop' ? cornerHandlers : undefined}
            onPointerDown={stageHandlers.onPointerDown}
            onPointerMove={stageHandlers.onPointerMove}
            onPointerUp={stageHandlers.onPointerUp}
            onPointerCancel={stageHandlers.onPointerCancel}
            onWheel={stageHandlers.onWheel}
            onImageLoad={handleImageLoad}
          >
            <Fade show={step !== 'crop'}>{planLayer()}</Fade>
          </ImagePanel>
        )}

        {step === 'analyzing' && (
          <div className="flex flex-col items-center md:min-h-0 md:flex-1 md:justify-center md:py-[var(--stage-inset)]">
            {planCard('Plan', true)}
          </div>
        )}

        {/* Phone: the Marks tools float on the photo. Tablet and desktop
            use the right panel (MarkPanel), which has room for them. */}
        {step === 'marks' && (
          <div className="absolute bottom-4 right-4 md:hidden">
            <MarkRail {...markTools} disabled={saving} />
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
        <div className="sc-step-head">
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
            <>
              <div className="hidden md:block">
                <MarkPanel {...markTools} disabled={saving} />
              </div>
              <div className="flex flex-col gap-1 md:hidden">
                <p className="sc-body">Draw your plan on the photo. Open Tools for the pen, color, eraser and line.</p>
                <p className="text-sm text-sc-text3">{SELECT_HINT}</p>
              </div>
            </>
          )}

          {step === 'media' && (
            <div className="flex flex-col gap-4">
              <p className="sc-body">What will you draw with? Pick all that apply. Your tips will use them.</p>
              {MEDIA.map(({ group, items }) => (
                <div key={group} className="flex flex-col gap-2" role="group" aria-label={group}>
                  <p className="text-base font-semibold text-sc-text3">{group}</p>
                  <div className="flex flex-wrap gap-2">
                    {items.map(([key, name]) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={media.includes(key)}
                        onClick={() => toggleMedia(key)}
                        className={`rounded-full border-[1.5px] px-3.5 py-2 text-md font-semibold transition-colors ${
                          media.includes(key)
                            ? 'border-sc-guide bg-sc-guide text-sc-guide-ink'
                            : 'border-sc-divider text-white hover:border-white/60'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-sm text-sc-text3">None picked: the tips stay tool-free.</p>
            </div>
          )}

          {step === 'analyzing' && (
            <ProgressSteps
              heading="Reading your scene…"
              current={analysisProgress.current}
              seconds={analysisProgress.seconds}
              steps={[
                { label: 'Framing and plan' },
                { label: 'Location', result: uploadedLocation?.label || 'Not in photo' },
                { label: 'Scene title' },
                { label: 'Reading your plan' },
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
                <Button variant="action" onClick={handleConfirmCrop} disabled={!box || saving}>{saving ? 'Saving…' : 'Next'}</Button>
              </>
            )}
            {step === 'marks' && (
              <>
                <Button variant="secondaryOnDark" className="mr-auto" onClick={handleBackToCrop} disabled={saving}>Back</Button>
                <Button variant="quietOnDark" onClick={() => handleMarksDone(true)} disabled={saving}>Skip</Button>
                <Button variant="action" onClick={() => handleMarksDone()} disabled={saving}>Next</Button>
              </>
            )}
            {step === 'media' && (
              <>
                <Button variant="secondaryOnDark" className="mr-auto" onClick={() => setStep('marks')} disabled={saving}>Back</Button>
                <Button variant="action" onClick={() => handleAnalyze()} disabled={saving}>{saving ? 'Saving…' : 'Read my plan'}</Button>
              </>
            )}
          </div>
        )}
      </div>
    </SketchModal>
  )
}
