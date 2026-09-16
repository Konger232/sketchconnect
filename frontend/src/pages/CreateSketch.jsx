import { useEffect, useRef, useState, useLayoutEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ImagePanel from '../components/analysis/ImagePanel'
import FocalSpotPicker, { Reticle } from '../components/analysis/FocalSpotPicker'
import StylePicker from '../components/analysis/StylePicker'

import Button from '../components/common/Button'
import AIPromptModal from '../components/analysis/AIPromptModal'
import ColorPalettePicker from '../components/analysis/ColorPalettePicker'
import ShapeOutlineOverlay from '../components/analysis/ShapeOutlineOverlay'
import PerspectiveLinesOverlay from '../components/analysis/PerspectiveLinesOverlay'
import ConfirmDialog from '../components/common/ConfirmDialog'

import { STYLES } from '../data/styles'
import { api } from '../lib/api'
import { WIZARD_IMAGE_MAX_WIDTH_CLASS, WIZARD_PANEL_HEIGHT_CLASS, WIZARD_PANEL_HEIGHT_PX } from '../lib/wizardLayout'
import { bakeCrop, computeImageBox, resolveAspectRatio } from '../lib/cropMath'
import { pointNearRegion, regionCentroid, toFrameSpace, toOriginalSpace } from '../lib/focalGeometry'
import { AI_PROMPT_SIZES as S } from '../lib/aiPromptSizing'
import { useOverlayToggle } from '../lib/useOverlayToggle'

const OWN_POINT_CAP = 3
const MIN_ZOOM = 0.2
const MAX_ZOOM = 4

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

  async function closeWizard() {
    if (sketchId && step !== 'summary') {
      try {
        await api.delete(`/api/sketches/${sketchId}`)
      } catch {
        // Best-effort cleanup
      }
    }
    navigate(backgroundLocation || '/profile')
  }

  const [step, setStep] = useState('capture') // 'capture' | 'style' | 'summary'

  // Upload photo state
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)

  // Server state & focal editing state
  const [sketchId, setSketchId] = useState(null)
  const [originalImageUrl, setOriginalImageUrl] = useState(null)
  const [referenceImageUrl, setReferenceImageUrl] = useState(null)
  const [cropTransform, setCropTransform] = useState(null)

  // Focal-point and framing logic state
  const aspectRatioKey = cropTransform?.aspect_ratio || 'original'
  const initialTransform = {
    zoom: cropTransform?.zoom ?? 1,
    offset_x: cropTransform?.offset_x ?? 0,
    offset_y: cropTransform?.offset_y ?? 0,
  }
  const initialTransformRef = useRef(initialTransform)

  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const svgRef = useRef(null)
  const [naturalSize, setNaturalSize] = useState(null)
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 })

  const [phase, setPhase] = useState('mark-placing')
  const [showGrid, setShowGrid] = useState(true)
  const [ownPoints, setOwnPoints] = useState([])
  const [regions, setRegions] = useState([])
  const [pendingMarkQuestions, setPendingMarkQuestions] = useState([])
  const [markQuestionPos, setMarkQuestionPos] = useState(0)

  const [zoom, setZoom] = useState(initialTransform.zoom)
  const [offset, setOffset] = useState({ x: initialTransform.offset_x, y: initialTransform.offset_y })
  const zoomRef = useRef(zoom)
  const offsetRef = useRef(offset)

  const confirmedPointsRef = useRef([])
  const originSpacePointsRef = useRef([])
  const [removedIndices, setRemovedIndices] = useState(new Set())
  const [frameQuestionQueue, setFrameQuestionQueue] = useState([])
  const [frameQuestionPos, setFrameQuestionPos] = useState(0)
  const gestureSnapshotRef = useRef(null)

  const pointersRef = useRef(new Map())
  const gestureRef = useRef(null)
  const wheelTimerRef = useRef(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // StylePicker State
  const [style, setStyle] = useState(null)

  // analysis returns by various visual analaysis components
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState(null) 

  const [error, setError] = useState(null)

  const perspectiveLines = useOverlayToggle(analysis)
  const focalAreas = useOverlayToggle(analysis)

  const [promptIndex, setPromptIndex] = useState(0)
  const [sessionChoices, setSessionChoices] = useState([])
  const [helpQuestLog, setHelpQuestLog] = useState([])
  const [helpQuestOpen, setHelpQuestOpen] = useState(false)
  const [helpQuestQuestion, setHelpQuestQuestion] = useState('')
  const [helpQuestAnswer, setHelpQuestAnswer] = useState(null)
  const [showPalette, setShowPalette] = useState(false)
  const [showRetakeConfirm, setShowRetakeConfirm] = useState(false)

  useEffect(() => {
    setPromptIndex(0)
    setSessionChoices([])
    setShowPalette(false)
    setHelpQuestOpen(false)
    setHelpQuestAnswer(null)
  }, [analysis])

  const ratio = resolveAspectRatio(aspectRatioKey, naturalSize)



  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    function recompute() {
      const availableWidth = container.clientWidth
      const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768
      const availableHeight = isDesktop && WIZARD_PANEL_HEIGHT_PX ? WIZARD_PANEL_HEIGHT_PX : window.innerHeight * 0.55
      if (!availableWidth || !availableHeight) return
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
  }, [ratio, WIZARD_PANEL_HEIGHT_PX])

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

  function confirmedPointsFromState() {
    const own = ownPoints.map((p) => ({ x: p.x, y: p.y, source: 'own', region_ref: null }))
    const adopted = regions
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.adopted)
      .map(({ r, i }) => {
        const c = regionCentroid(r)
        return { x: c.x, y: c.y, source: 'adopted', region_ref: i }
      })
    return [...own, ...adopted]
  }

  function handleMarkTap(e) {
    if (phase !== 'mark-placing' || ownPoints.length >= OWN_POINT_CAP) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 1000
    const y = ((e.clientY - rect.top) / rect.height) * 1000
    setOwnPoints((prev) => [...prev, { x, y }])
  }

  function removeOwnPoint(i) {
    setOwnPoints((prev) => prev.filter((_, idx) => idx !== i))
  }

  function regionsNeedingQuestions() {
    return regions
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => !r.asked && !ownPoints.some((p) => pointNearRegion(p.x, p.y, r)))
      .map(({ i }) => i)
  }

  function handleMarkContinue() {
    const pending = regionsNeedingQuestions()
    if (pending.length === 0) {
      enterFramePhase()
      return
    }
    setPendingMarkQuestions(pending)
    setMarkQuestionPos(0)
    setPhase('mark-asking')
  }

  function answerMarkQuestion(accept) {
    const idx = pendingMarkQuestions[markQuestionPos]
    setRegions((prev) => prev.map((r, i) => (i === idx ? { ...r, asked: true, adopted: accept || r.adopted } : r)))
    const next = markQuestionPos + 1
    if (next < pendingMarkQuestions.length) {
      setMarkQuestionPos(next)
    } else {
      setPendingMarkQuestions([])
      setMarkQuestionPos(0)
      setPhase('mark-placing')
    }
  }

  function enterFramePhase() {
    const pts = confirmedPointsFromState()
    confirmedPointsRef.current = pts
    originSpacePointsRef.current = pts.map((p) => toOriginalSpace(p, ratio, initialTransformRef.current, naturalSize))
    setRemovedIndices(new Set())
    resetTransform({
      zoom: initialTransformRef.current.zoom,
      offset: { x: initialTransformRef.current.offset_x, y: initialTransformRef.current.offset_y },
    })
    setPhase('frame-adjusting')
  }

  function projectedPoints() {
    const transform = { zoom: zoomRef.current, offset_x: offsetRef.current.x, offset_y: offsetRef.current.y }
    return originSpacePointsRef.current
      .map((op, i) => ({ i, ...toFrameSpace(op, ratio, transform, naturalSize) }))
      .filter(({ i }) => !removedIndices.has(i))
  }

  function checkFrameExclusions() {
    const transform = { zoom: zoomRef.current, offset_x: offsetRef.current.x, offset_y: offsetRef.current.y }
    const excluded = []
    originSpacePointsRef.current.forEach((op, i) => {
      if (removedIndices.has(i)) return
      const proj = toFrameSpace(op, ratio, transform, naturalSize)
      if (!proj.inFrame) excluded.push(i)
    })
    if (excluded.length === 0) return
    setFrameQuestionQueue(excluded)
    setFrameQuestionPos(0)
    setPhase('frame-asking')
  }

  function anchorLabel(i) {
    const point = confirmedPointsRef.current[i]
    if (!point) return 'one of your marked spots'
    return point.source === 'own' ? 'one of your marked spots' : regions[point.region_ref]?.label || 'that spot'
  }

  function finishFrameQuestions() {
    setFrameQuestionQueue([])
    setFrameQuestionPos(0)
    setPhase('frame-adjusting')
  }

  function handleFrameKeep() {
    if (gestureSnapshotRef.current) {
      setZoomTracked(gestureSnapshotRef.current.zoom)
      setOffsetTracked({ x: gestureSnapshotRef.current.offset_x, y: gestureSnapshotRef.current.offset_y })
    }
    finishFrameQuestions()
  }

  function handleFrameRemove() {
    const idx = frameQuestionQueue[frameQuestionPos]
    setRemovedIndices((prev) => new Set(prev).add(idx))
    const next = frameQuestionPos + 1
    if (next < frameQuestionQueue.length) {
      setFrameQuestionPos(next)
    } else {
      finishFrameQuestions()
    }
  }

  function handlePointerDown(e) {
    if (phase !== 'frame-adjusting') return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size === 1) {
      gestureSnapshotRef.current = { zoom: zoomRef.current, offset_x: offsetRef.current.x, offset_y: offsetRef.current.y }
      gestureRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, startOffset: offsetRef.current }
    } else if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values())
      gestureRef.current = { mode: 'pinch', startDistance: pointerDistance(pts[0], pts[1]), startZoom: zoomRef.current }
    }
  }

  function handlePointerMove(e) {
    if (phase !== 'frame-adjusting' || !pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gestureRef.current
    if (!g || !boxSize.width || !boxSize.height) return

    if (g.mode === 'pan') {
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      setOffsetTracked({
        x: g.startOffset.x + dx / boxSize.width,
        y: g.startOffset.y + dy / boxSize.height,
      })
    } else if (g.mode === 'pinch') {
      const pts = Array.from(pointersRef.current.values())
      if (pts.length < 2) return
      const scale = pointerDistance(pts[0], pts[1]) / g.startDistance
      setZoomTracked(g.startZoom * scale)
    }
  }

  function handlePointerUp(e) {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size === 0) {
      gestureRef.current = null
      checkFrameExclusions()
    } else if (pointersRef.current.size === 1) {
      const [[, pt]] = Array.from(pointersRef.current.entries())
      gestureRef.current = { mode: 'pan', startX: pt.x, startY: pt.y, startOffset: offsetRef.current }
    }
  }

  function handleWheel(e) {
    if (phase !== 'frame-adjusting') return
    e.preventDefault()
    setZoomTracked(zoomRef.current * (1 - e.deltaY * 0.0015))
    window.clearTimeout(wheelTimerRef.current)
    wheelTimerRef.current = window.setTimeout(() => {
      if (phaseRef.current === 'frame-adjusting') checkFrameExclusions()
    }, 250)
  }

  function handleZoomSliderStart() {
    if (phase !== 'frame-adjusting') return
    gestureSnapshotRef.current = { zoom: zoomRef.current, offset_x: offsetRef.current.x, offset_y: offsetRef.current.y }
  }
  function handleZoomSliderChange(e) {
    setZoomTracked(parseFloat(e.target.value))
  }
  function handleZoomSliderCommit() {
    if (phase === 'frame-adjusting') checkFrameExclusions()
  }

  function handleImageLoad(e) {
    setNaturalSize({ width: e.target.naturalWidth, height: e.target.naturalHeight })
  }

  async function handleConfirmFrame() {
    setSaving(true)
    setError(null)
    try {
      const finalTransform = { zoom: zoomRef.current, offset_x: offsetRef.current.x, offset_y: offsetRef.current.y }
      const survivors = confirmedPointsRef.current.map((p, i) => ({ p, i })).filter(({ i }) => !removedIndices.has(i))

      const oldPoints = survivors.map(({ p }) => ({
        x: Math.round(p.x),
        y: Math.round(p.y),
        source: p.source,
        region_ref: p.region_ref,
      }))
      const newPoints = survivors.map(({ i }) => {
        const proj = toFrameSpace(originSpacePointsRef.current[i], ratio, finalTransform, naturalSize)
        return { x: Math.round(proj.x), y: Math.round(proj.y) }
      })

      const form = new FormData()
      form.append('old_points', JSON.stringify(oldPoints))
      form.append('new_points', JSON.stringify(newPoints))

      const transformChanged =
        finalTransform.zoom !== initialTransformRef.current.zoom ||
        finalTransform.offset_x !== initialTransformRef.current.offset_x ||
        finalTransform.offset_y !== initialTransformRef.current.offset_y

      if (transformChanged) {
        const blob = await bakeCrop({
          imageEl: imgRef.current,
          naturalSize,
          aspectRatioKey,
          zoom: finalTransform.zoom,
          offset: { x: finalTransform.offset_x, y: finalTransform.offset_y },
        })
        form.append('framed_image', blob, 'framed.jpg')
        form.append(
          'crop_transform',
          JSON.stringify({
            aspect_ratio: aspectRatioKey,
            zoom: finalTransform.zoom,
            offset_x: finalTransform.offset_x,
            offset_y: finalTransform.offset_y,
          })
        )
      }

      const { data } = await api.post(`/api/sketches/${sketchId}/focal-frame`, form)
      if (data?.reference_image_url) {
        setReferenceImageUrl(resolveUrl(data.reference_image_url))
      }
      resetTransform()
      setStep('style')
    } catch (err) {
      console.log('DEBUG confirmFrame', err)
      setError(err.response?.data?.detail || 'Could not save your focal points.')
    } finally {
      setSaving(false)
    }
  }

  function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setPreview(URL.createObjectURL(f))
    uploadPhoto(f)
  }

  async function uploadPhoto(f) {
    setSaving(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('image', f)
      const { data } = await api.post('/api/sketches', form)
      setSketchId(data.id)
      setOriginalImageUrl(resolveUrl(data.original_image_url || data.reference_image_url))
      setReferenceImageUrl(resolveUrl(data.reference_image_url))
      setCropTransform(data.crop_transform || null)
      if (data.focal_regions) {
        setRegions(data.focal_regions.map((r) => ({ ...r, asked: false, adopted: false })))
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save this sketch.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRetake() {
    if (sketchId) {
      try {
        await api.delete(`/api/sketches/${sketchId}`)
      } catch {
        // Best effort
      }
    }
    if (preview) URL.revokeObjectURL(preview)
    setSketchId(null)
    setOriginalImageUrl(null)
    setReferenceImageUrl(null)
    setCropTransform(null)
    setPreview(null)
    setStyle(null)
    setAnalysis(null)
    setError(null)
    setOwnPoints([])
    resetTransform()
    setPhase('mark-placing')
    setStep('capture')
  }

  async function handleStyleSelect(value) {
    if (analyzing) return
    setStyle(value)
    setAnalyzing(true)
    setError(null)
    try {
      await api.put(`/api/sketches/${sketchId}`, { style: value })
      const res = await fetch(referenceImageUrl || originalImageUrl)
      const blob = await res.blob()
      const form = new FormData()
      form.append('sketch_id', sketchId)
      form.append('style', value)
      form.append('image', blob, 'reference.jpg')
      const { data } = await api.post('/api/scene-analysis', form)
      setAnalysis(data)
      setStep('summary')
    } catch (err) {
      setError(err.response?.data?.detail || 'Scene analysis failed.')
    } finally {
      setAnalyzing(false)
    }
  }

  function handleFinishWizard() {
    navigate('/profile')
  }

  function currentPrompt() {
    return analysis?.prepared_prompts?.[promptIndex] || null
  }

  function handlePromptSelect(option) {
    const prompt = currentPrompt()
    setSessionChoices((prev) => [...prev, { prompt: prompt.question, response: option }])
    advancePrompt()
  }

  function advancePrompt() {
    const next = promptIndex + 1
    if (analysis && next < analysis.prepared_prompts.length) {
      setPromptIndex(next)
    } else if (!showPalette) {
      setShowPalette(true)
    } else {
      handleFinishWizard()
    }
  }

  function handlePaletteDone() {
    setShowPalette(false)
    handleFinishWizard()
  }

  function handleFinishNow() {
    setShowPalette(false)
    handleFinishWizard()
  }

  async function fetchReferenceImageBlob() {
    const res = await fetch(referenceImageUrl || originalImageUrl)
    return res.blob()
  }

  async function handleHelpQuestSend() {
    if (!helpQuestQuestion.trim()) return
    try {
      const blob = await fetchReferenceImageBlob()
      const form = new FormData()
      form.append('sketch_id', sketchId)
      form.append('question', helpQuestQuestion)
      form.append('style', style)
      form.append('scene_type', analysis.scene_type)
      form.append('step_id', `prompt-${promptIndex}`)
      form.append('image', blob, 'reference.jpg')
      const { data } = await api.post('/api/help-quest', form)
      setHelpQuestAnswer(data.answer)
      setHelpQuestLog((prev) => [...prev, {
        step_id: `prompt-${promptIndex}`,
        question: helpQuestQuestion,
        answer: data.answer,
        principle_reference: data.principle_reference,
      }])
    } catch {
      setHelpQuestAnswer('Could not reach Help Quest right now.')
    }
  }

  const box =
    naturalSize && boxSize.width && boxSize.height
      ? computeImageBox(boxSize.width, boxSize.height, naturalSize.width, naturalSize.height, zoom, offset.x, offset.y)
      : null
  
  const summaryBox =
  naturalSize && boxSize.width && boxSize.height
    ? computeImageBox(boxSize.width, boxSize.height, naturalSize.width, naturalSize.height, 1, 0, 0)
    : null    

  const isFramePhase = phase === 'frame-adjusting' || phase === 'frame-asking'
  const reticles = isFramePhase
    ? projectedPoints()
    : confirmedPointsFromState().map((p, i) => ({ i, x: p.x, y: p.y, source: p.source, region_ref: p.region_ref }))

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/60 md:p-6">
      <ConfirmDialog
        open={showRetakeConfirm}
        title="Retake photo?"
        message="Retaking now will delete this sketch and everything you've done so far, style, focal points, and any AI guidance. This can't be undone."
        confirmLabel="Discard and retake"
        cancelLabel="Keep working"
        onConfirm={() => {
          setShowRetakeConfirm(false)
          handleRetake()
        }}
        onCancel={() => setShowRetakeConfirm(false)}
      />
      
      <div className="relative flex h-full w-full flex-col bg-black text-white md:h-[640px] md:w-[960px] md:max-h-[90vh] md:max-w-[95vw] md:overflow-hidden md:rounded-2xl">
        
        {/* Modal Window top row */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <button type="button" onClick={closeWizard} className="text-sm font-medium text-white/70 hover:text-white">
            Cancel
          </button>
          <span className="w-40 text-right text-xs font-medium text-white/40">New Sketch {preview}</span>
          {preview && (
              <button
                type="button"
                onClick={() => setShowRetakeConfirm(true)}
                disabled={saving}
                className="self-start rounded-full bg-ink/10 px-3 py-1.5 text-xs font-medium text-white/70 disabled:opacity-50"
              >
                Retake
              </button>
            )}
        </div>{/* END Modal Window top row */}
        
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 pt-3 md:px-8">
        {step === 'summary' ? (
          <div className="animate-fade-in-up md:grid md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
            <div className="flex flex-col gap-3">
              <ImagePanel
                containerRef={containerRef}
                boxSize={boxSize}
                imageUrl={referenceImageUrl || originalImageUrl}
                box={summaryBox}
                zoom={1}
                offset={{ x: 0, y: 0 }}
                heightClass={WIZARD_PANEL_HEIGHT_CLASS}
                onImageLoad={handleImageLoad}
                overlayChildren={
                  <>
                    <ShapeOutlineOverlay focalRegions={focalAreas.mode !== 'none' ? analysis?.focal_regions || [] : []} />
                    <PerspectiveLinesOverlay lines={perspectiveLines.mode !== 'none' ? analysis?.perspective_lines || [] : []} />
                  </>
                }
              />
              <div className="flex gap-2 px-3 md:px-4">
                <Button
                  variant={perspectiveLines.mode !== 'none' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={perspectiveLines.toggle}
                  disabled={!analysis?.perspective_lines?.length}
                >
                  Perspective lines
                </Button>
                <Button
                  variant={focalAreas.mode !== 'none' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={focalAreas.toggle}
                  disabled={!analysis?.focal_regions?.length}
                >
                  Focal shapes
                </Button>
              </div>
            </div>

            <div className="flex flex-col justify-center gap-4 overflow-y-auto bg-paper p-5 text-ink md:p-6">
              {currentPrompt() && !helpQuestOpen && !showPalette && (
                <AIPromptModal
                  question={currentPrompt().question}
                  options={currentPrompt().options}
                  onSelect={handlePromptSelect}
                  onAskMe={() => setHelpQuestOpen(true)}
                />
              )}

              {showPalette && (
                <ColorPalettePicker onSelect={handlePaletteDone} onSkip={handlePaletteDone} />
              )}

              {!helpQuestOpen && (currentPrompt() || showPalette) && (
                <Button variant="outline" size="sm" className="w-full" onClick={handleFinishNow}>
                  Start Sketching Now
                </Button>
              )}

              {helpQuestOpen && (
                <div className="animate-fade-in-up">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className={`font-semibold ${S.helpHeadingText} ${S.helpHeadingTextMd}`}>Ask me anything about this scene</p>
                    <button
                      onClick={() => { setHelpQuestOpen(false); setHelpQuestAnswer(null) }}
                      className={`${S.closeIcon} ${S.closeIconMd} text-ink/50 transition-colors hover:text-ink`}
                    >
                      ×
                    </button>
                  </div>
                  {helpQuestAnswer ? (
                    <>
                      <p className={`animate-fade-in-up rounded-lg bg-black/5 p-3 ${S.helpInputText} ${S.helpInputTextMd}`}>{helpQuestAnswer}</p>
                      <Button
                        size="sm"
                        className="mt-3 w-full"
                        onClick={() => { setHelpQuestOpen(false); setHelpQuestAnswer(null); setHelpQuestQuestion('') }}
                      >
                        Back to prompts
                      </Button>
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        value={helpQuestQuestion}
                        onChange={(e) => setHelpQuestQuestion(e.target.value)}
                        placeholder="e.g. Should I start with the wine bottles?"
                        className={`flex-1 rounded-lg border border-black/15 text-ink transition-colors focus:border-ink/40 ${S.helpInputPadding} ${S.helpInputPaddingMd} ${S.helpInputText} ${S.helpInputTextMd}`}
                      />
                      <Button size="sm" onClick={handleHelpQuestSend}>Send</Button>
                    </div>
                  )}
                </div>
              )}

              {analysis?.debug_raw_gemini_response && (
                <details className="rounded-lg border border-black/10 bg-black/5 p-3 text-xs">
                  <summary className="cursor-pointer font-medium text-ink/60">Debug: raw Gemini response</summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-ink/70">
                    {analysis.debug_raw_gemini_response}
                  </pre>
                </details>
              )}
            </div>
          </div>
        ) : (
           
          <div className="animate-fade-in-up md:grid md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
          
            {/* Universal Left Panel */}
            <ImagePanel
              key={step}
              containerRef={containerRef}
              imgRef={imgRef}
              svgRef={svgRef}
              boxSize={boxSize}
              imageUrl={
                step === 'capture'
                  ? originalImageUrl || preview
                  : step === 'style'
                  ? referenceImageUrl || originalImageUrl
                  : originalImageUrl
              }
              zoom={zoom}
              offset={offset}
              box={box}
              heightClass={WIZARD_PANEL_HEIGHT_CLASS}
              fileInputRef={fileInputRef}
              onFileChange={handleFile}
              saving={saving}
              onPointerDown={step === 'capture' && sketchId && isFramePhase ? handlePointerDown : undefined}
              onPointerMove={step === 'capture' && sketchId && isFramePhase ? handlePointerMove : undefined}
              onPointerUp={step === 'capture' && sketchId && isFramePhase ? handlePointerUp : undefined}
              onWheel={step === 'capture' && sketchId && isFramePhase ? handleWheel : undefined}
              onImageLoad={handleImageLoad}
              onClick={step === 'capture' && sketchId && phase === 'mark-placing' ? handleMarkTap : undefined}
            >
              {/* Grid and Reticle SVG overlays */}
              {showGrid && (
                <g className="pointer-events-none opacity-30">
                  <line x1="333.33" y1="0" x2="333.33" y2="1000" stroke="white" strokeWidth="2" />
                  <line x1="666.66" y1="0" x2="666.66" y2="1000" stroke="white" strokeWidth="2" />
                  <line x1="0" y1="333.33" x2="1000" y2="333.33" stroke="white" strokeWidth="2" />
                  <line x1="0" y1="666.66" x2="1000" y2="666.66" stroke="white" strokeWidth="2" />
                </g>
              )}
              {/* Focal Point Picker */}
              {step === 'capture' && (
                <g className="pointer-events-none">
                  {reticles.map((r) => (
                    <Reticle key={r.i} x={r.x} y={r.y} />
                  ))}
                </g>
              )}
            </ImagePanel>

            {/* Right Control Panel Slot */}
            {step === 'capture' && !sketchId ? (
              <div className="flex flex-col gap-4 bg-white p-5 text-ink md:p-6">
                <div>
                  <p className="text-xs text-ink/60">
                    Add a photo and tell us what caught your attention.
                  </p>
                </div>
            
                {preview && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving}
                    className="self-start rounded-full bg-ink/10 px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50"
                  >
                    Retake
                  </button>
                )}
                {error && <p className="text-sm text-accent">{error}</p>}
              </div>
            ) : step === 'capture' && sketchId ? (
              <FocalSpotPicker
                phase={phase}
                onRetake={handleRetake}
                ownPoints={ownPoints}
                ownPointCap={OWN_POINT_CAP}
                onSkip={() => setStep('style')}
                onMarkContinue={handleMarkContinue}
                pendingMarkQuestions={pendingMarkQuestions}
                markQuestionPos={markQuestionPos}
                regions={regions}
                answerMarkQuestion={answerMarkQuestion}
                showGrid={showGrid}
                setShowGrid={setShowGrid}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                zoom={zoom}
                handleZoomSliderStart={handleZoomSliderStart}
                handleZoomSliderChange={handleZoomSliderChange}
                handleZoomSliderCommit={handleZoomSliderCommit}
                handleConfirmFrame={handleConfirmFrame}
                saving={saving}
                frameQuestionPos={frameQuestionPos}
                frameQuestionQueue={frameQuestionQueue}
                anchorLabel={anchorLabel}
                handleFrameKeep={handleFrameKeep}
                handleFrameRemove={handleFrameRemove}
                error={error}
              />
            ) : (

              <StylePicker
                style={style}
                analyzing={analyzing}
                error={error}
                onSelectStyle={handleStyleSelect}
              />

            )}

          </div>


          )}
        </div>
      </div>
    </div>
  )
}