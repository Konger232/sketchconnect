import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ImagePanel from '../components/analysis/ImagePanel'
import MarkPanel, { DEFAULT_MARK_COLOR, DEFAULT_MARK_SIZE, MarkRail, MarksLayer, SELECT_HINT, useMarkDrawing } from '../components/analysis/Marks'
import Fade from '../components/analysis/Fade'

import Button from '../components/common/Button'
import ProgressSteps from '../components/common/ProgressSteps'
import ConfirmDialog from '../components/common/ConfirmDialog'
import SketchModal from '../components/common/SketchModal'
import PhotoDropzone from '../components/common/PhotoDropzone'

import { api } from '../lib/api'
import { runGuideAnalysis, startSceneAnalysis } from '../lib/guideAnalysis'
import { notifySketchesChanged } from '../lib/sketchEvents'
import { shrinkPhoto } from '../lib/shrinkPhoto'
import { previewUrl } from '../lib/previewUrl'
import { useStagedProgress } from '../lib/useStagedProgress'
import { useCropFrame } from '../components/analysis/useCropFrame'
import MediaPicker from '../components/analysis/MediaPicker'


// New Sketch setup, in order (design handoff). 'analyzing' follows the
// steps, then the sketch opens in EditSketch's workspace with the plan read
// (design doc, item 25). Style is picked later, with the final sketch.
const STEPS = [
  { key: 'photo', name: 'Reference photo' },
  { key: 'crop', name: 'Crop and reframe' },
  { key: 'marks', name: 'Plan what to sketch' },
  { key: 'media', name: 'What you draw with' },
]


// The hint over the photo on the photo steps.
const STAGE_HINTS = {
  crop: 'Drag corners to crop. Pinch to zoom.',
  marks: 'Select shapes or edges you care about',
}

function resolveUrl(url) {
  if (!url) return url
  return url.startsWith('http') ? url : `${api.defaults.baseURL}${url}`
}

export default function CreateSketch() {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const backgroundLocation = routerLocation.state?.backgroundLocation
  // Capture from an event page (item 49): { id, title }. Sent with the photo, so the sketch is linked from the start.
  const captureEvent = routerLocation.state?.event || null

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
  // Take photo: the phone's position, asked for in the same tap. iPhone's
  // browser camera hands over photos without their GPS (November 18, 2026).
  const devicePosRef = useRef(null) // a promise of { lat, lon, accuracy } or null
  const fromCameraRef = useRef(false)
  // Where the photo on screen came from, so the panel offers the same
  // way again: Retake for the camera, Choose another for the library.
  const [photoSource, setPhotoSource] = useState(null) // 'camera' | 'library'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [replaceWith, setReplaceWith] = useState(null) // 'camera' | 'library', waiting on ConfirmDialog

  // ===== STATE: SKETCH ON THE SERVER =====
  const [sketchId, setSketchId] = useState(null)
  const [originalImageUrl, setOriginalImageUrl] = useState(null)
  const [referenceImageUrl, setReferenceImageUrl] = useState(null)
  const [uploadedLocation, setUploadedLocation] = useState(null)

  // ===== STATE: CROP (shared with Capture: useCropFrame) =====
  const crop = useCropFrame({ active: step === 'crop', layoutKey: `${step}:${preview}` })
  // The scene analysis started when the crop was confirmed (a promise of
  // its result, or null). The guide waits for it after the marks.
  const sceneRef = useRef(null)
  const svgRef = useRef(null)

  // ===== STATE: FOCAL POINTS AND MARKS =====
  const [markTool, setMarkTool] = useState('pen')
  const [markSize, setMarkSize] = useState(DEFAULT_MARK_SIZE)
  // One colour for every mark: picking another redraws them all.
  const [markColor, setMarkColor] = useState(DEFAULT_MARK_COLOR)
  const drawing = useMarkDrawing(svgRef, { enabled: step === 'marks', tool: markTool, size: markSize, color: markColor })

  // Fetch the framed photo early, while the sketcher draws. The server makes
  // its screen copy on the first request (about 2 seconds), and the scene
  // analysis screen shows it under the plan.
  useEffect(() => {
    if (!referenceImageUrl || referenceImageUrl === originalImageUrl) return
    const img = new Image()
    img.src = referenceImageUrl
  }, [referenceImageUrl, originalImageUrl])

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

  const ratio = crop.ratio

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
    navigate(backgroundLocation || '/')
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
    if (source === 'camera') takePhoto()
    else libraryInputRef.current?.click()
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
    crop.reset()
    sceneRef.current = null
  }

  // The phone's position for a photo taken now. null when it can't be had
  // (no permission, no signal) within 10 seconds.
  function devicePosition() {
    if (!navigator.geolocation) return Promise.resolve(null)
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      )
    })
  }
  function takePhoto() {
    devicePosRef.current = devicePosition() // asked now, inside the tap, so the browser allows it
    cameraInputRef.current?.click()
  }

  // HEIC photos need converting before they can be previewed (previewUrl).
  // pickRef drops a slow conversion if another photo was picked meanwhile.
  function handleCamera(e) { fromCameraRef.current = true; setPhotoSource('camera'); return handleFile(e) }
  function handleLibrary(e) { fromCameraRef.current = false; setPhotoSource('library'); devicePosRef.current = null; return handleFile(e) }
  async function handleFile(e) {
    const picked = e.target.files?.[0]
    e.target.value = '' // the same file can be picked again
    if (!picked) return
    const pick = ++pickRef.current
    setError(null)
    try {
      // A photo just taken goes up at 2400 px on the long side (November 19,
      // 2026): a full-size phone photo held in memory and uploaded over a
      // mobile network was slow, and the phone's browser could reload the
      // page while it worked. Nothing is lost: the browser camera's photo has
      // no GPS, and the server dates it. Library photos go as they are, since
      // their location is read from the file.
      const f = fromCameraRef.current ? await shrinkPhoto(picked) : picked
      if (pick !== pickRef.current) return
      const url = await previewUrl(f)
      if (pick !== pickRef.current) return URL.revokeObjectURL(url)
      if (preview) URL.revokeObjectURL(preview)
      setFile(f)
      setPreview(url)
    } catch {
      if (pick === pickRef.current) setError('Could not open this photo. Try a JPEG or PNG.')
    }
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
      if (captureEvent?.id) form.append('event_id', captureEvent.id)
      // A photo just taken: where the phone is now, for when the photo
      // itself carries no location. The backend prefers the photo's own.
      if (fromCameraRef.current) {
        form.append('camera', 'true')
        const pos = await Promise.race([devicePosRef.current || Promise.resolve(null), new Promise((r) => setTimeout(() => r(null), 4000))])
        if (pos) {
          form.append('device_lat', String(pos.lat))
          form.append('device_lon', String(pos.lon))
        }
      }
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

  // ===== CROP CONFIRMED: SAVE THE FRAME, START THE SCENE ANALYSIS =====

  // Next on the crop step. A changed frame is baked and saved first, since
  // the scene analysis reads the saved framed photo. The scene analysis
  // then runs in the background while the sketcher draws marks.
  async function handleConfirmCrop() {
    if (crop.changed()) {
      const frame = crop.frame()
      setSaving(true)
      setError(null)
      try {
        const form = new FormData()
        // Focal points are retired: marks are the one plan (design doc,
        // item 17). The endpoint still takes the two point lists, empty.
        form.append('old_points', '[]')
        form.append('new_points', '[]')
        form.append('framed_image', await crop.bake(), 'framed.jpg')
        form.append('crop_transform', JSON.stringify({
          aspect_ratio: frame.aspect_ratio,
          ...(frame.aspect_ratio === 'custom' && { ratio: frame.ratio }),
          zoom: frame.zoom,
          offset_x: frame.offset_x,
          offset_y: frame.offset_y,
        }))
        const { data } = await api.post(`/api/sketches/${sketchId}/focal-frame`, form)
        if (data?.reference_image_url) setReferenceImageUrl(resolveUrl(data.reference_image_url))
        crop.markSaved(frame)
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
    navigate(`/sketches/${sketchId}/edit`, {
      replace: true,
      state: { backgroundLocation, mode: 'create', analysis: data },
    })
  }

  // ===== RENDER =====

  const stepIndex = step === 'analyzing' ? STEPS.length : STEPS.findIndex((s) => s.key === step)
  const onPhotoSteps = step === 'crop' || step === 'marks' || step === 'media'
  const stageHandlers =
    step === 'crop'
      ? crop.stageHandlers
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
          if (source === 'camera') takePhoto()
          else libraryInputRef.current?.click()
        }}
        onCancel={() => setReplaceWith(null)}
      />
      <input ref={libraryInputRef} type="file" accept="image/*,.heic" onChange={handleLibrary} className="hidden" />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleCamera} className="hidden" />

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
          <PhotoDropzone
            title="Photograph the scene you'll draw"
            text={captureEvent
              ? `Sketching at ${captureEvent.title}. Stand where you'll sketch from. Location and a title come from this photo.`
              : "Stand where you'll sketch from. Location and a title come from this photo."}
            onClick={takePhoto}
          />
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
            containerRef={crop.containerRef}
            imgRef={crop.imgRef}
            svgRef={svgRef}
            boxSize={crop.boxSize}
            // bakeCrop draws this <img> onto a canvas. Without CORS loading,
            // the backend photo taints the canvas and the export fails.
            crossOrigin="anonymous"
            // Crop and marks work on the original upload through the frame.
            imageUrl={originalImageUrl}
            zoom={crop.zoom}
            offset={crop.offset}
            box={crop.box}
            heightClass="max-md:aspect-[var(--frame-ratio)] max-md:max-h-[75vh] md:min-h-0 md:flex-1"
            padClass="p-0 md:px-0 md:py-[var(--stage-inset)]"
            cropFrame={step === 'crop'}
            cropRect={crop.cropRect}
            boxShift={crop.boxShift}
            cornerHandlers={step === 'crop' ? crop.cornerHandlers : undefined}
            onPointerDown={stageHandlers.onPointerDown}
            onPointerMove={stageHandlers.onPointerMove}
            onPointerUp={stageHandlers.onPointerUp}
            onPointerCancel={stageHandlers.onPointerCancel}
            onWheel={stageHandlers.onWheel}
            onImageLoad={crop.handleImageLoad}
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
      <div className="sc-panel sc-panel-pinned">
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

        {/* The photo and crop steps have nothing here: their words are on
            the stage and their buttons in the footer. */}
        {((step !== 'photo' && step !== 'crop') || error) && <div className="sc-panel-body">

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

          {step === 'media' && <MediaPicker picks={media} onToggle={toggleMedia} />}

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
        </div>}

        {/* ===== FOOTER: Back · Skip · Next ===== */}
        {/* md:mt-auto keeps the footer at the bottom of the panel on the
            steps with no panel body (photo, crop). */}
        {step !== 'analyzing' && (
          <div className="sc-footer sc-footer-pinned md:mt-auto">
            {step === 'photo' && !preview && (
              <>
                <Button variant="secondaryOnDark" onClick={() => libraryInputRef.current?.click()}>From library</Button>
                <Button variant="action" onClick={takePhoto}>Take photo</Button>
              </>
            )}
            {step === 'photo' && preview && (
              <>
                {photoSource === 'library'
                  ? <Button variant="secondaryOnDark" onClick={() => pickPhoto('library')} disabled={saving}>Choose another</Button>
                  : <Button variant="secondaryOnDark" onClick={() => pickPhoto('camera')} disabled={saving}>Retake</Button>}
                <Button variant="action" onClick={handleUsePhoto} disabled={saving}>{saving ? 'Saving…' : 'Use photo'}</Button>
              </>
            )}
            {step === 'crop' && (
              <>
                <Button variant="secondaryOnDark" className="mr-auto" onClick={() => setStep('photo')}>Back</Button>
                <Button variant="action" onClick={handleConfirmCrop} disabled={!crop.box || saving}>{saving ? 'Saving…' : 'Next'}</Button>
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
