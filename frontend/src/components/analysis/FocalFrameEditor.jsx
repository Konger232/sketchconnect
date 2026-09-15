import { useLayoutEffect, useRef, useState } from 'react'
import Button from '../common/Button'
import RuleOfThirdsGrid from './RuleOfThirdsGrid'
import { bakeCrop, computeImageBox, resolveAspectRatio } from '../../lib/cropMath'
import { pointNearRegion, regionCentroid, toFrameSpace, toOriginalSpace } from '../../lib/focalGeometry'
import { api } from '../../lib/api'
import { WIZARD_PANEL_HEIGHT_CLASS } from '../../lib/wizardLayout'

const OWN_POINT_CAP = 3
const MIN_ZOOM = 0.2
const MAX_ZOOM = 4
const RETICLE_SIZE = 60 // 0-1000 scale -- same proportions as the retired FocalPointOverlay.jsx
const RETICLE_REACH = 16

function pointerDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function Reticle({ x, y }) {
  const half = RETICLE_SIZE / 2
  const outer = half + RETICLE_REACH
  return (
    <g
      stroke="var(--focal-accent-user)"
      strokeWidth="var(--focal-reticle-stroke-width)"
      strokeOpacity="var(--focal-reticle-stroke-opacity)"
      fill="none"
      vectorEffect="non-scaling-stroke"
    >
      <rect x={x - half} y={y - half} width={RETICLE_SIZE} height={RETICLE_SIZE} />
      <line x1={x - outer} y1={y} x2={x + outer} y2={y} />
      <line x1={x} y1={y - outer} x2={x} y2={y + outer} />
      {/* A thin non-scaling stroke alone can read as nearly invisible
          against a busy photo (this is what live testing actually hit --
          marks were being placed correctly in state, just too faint to
          notice) -- a small filled center dot guarantees a visible anchor
          regardless of how the surrounding lines render. */}
      <circle cx={x} cy={y} r={3} stroke="none" fill="var(--focal-accent-user)" fillOpacity="var(--focal-reticle-stroke-opacity)" vectorEffect="non-scaling-stroke" />
    </g>
  )
}

/**
 * Step 3's focal-point marking, folded together with the pan/zoom frame
 * refinement it feeds into -- deliberately ONE component (not a mark
 * component handing off to a separate crop component) because every
 * interaction here depends on shared state: a mark's on-screen position
 * has to track the frame as it's adjusted, and adjusting the frame has to
 * know where every confirmed mark is to warn before cropping one out.
 * Splitting those across files would mean threading that same state
 * through props either way, with none of the cohesion.
 *
 * Two phases, sequential:
 *
 *  1. "mark" -- tap the (already-framed) reference photo to place up to
 *     OWN_POINT_CAP focal points, own color only (design decision: the
 *     cap applies just to freely-placed points; adopting a Gemini
 *     suggestion is never blocked by it -- see parking-lot.md). Gemini's
 *     own focal_regions are never shown as markers up front -- Continue
 *     compares them against what the sketcher already marked
 *     (pointNearRegion, a plain-geometry stand-in for
 *     services/focal_pairing.py's real pairing) and asks about only the
 *     leftover ones, one at a time, by name.
 *
 *  2. "frame" -- the same photo, now with pan/zoom/pinch active (the
 *     old capture-step crop UI's gesture math, inlined here rather than
 *     factored out so this component can layer the rule-of-thirds grid and
 *     every confirmed point's reticle on top of the same gesture state)
 *     plus the confirmed points from step 1, reprojected live as the
 *     frame moves (focalGeometry.js's toOriginalSpace/toFrameSpace round
 *     trip). Panning or zooming a confirmed point out of frame pauses on
 *     a question asking whether that's deliberate, same shape as step 1's
 *     questions: remove it, or revert the gesture that excluded it.
 *
 * Confirming re-bakes a new reference photo from the original (only if
 * the frame actually changed) and POSTs everything to
 * /api/sketches/{id}/focal-frame, which re-pairs the marks server-side
 * (the authoritative geometry) and reprojects them onto whatever frame
 * was just confirmed.
 *
 * "Skip this step" is always available -- the project's own design
 * principle is to stay encouraging, never interrupt the sketcher's
 * process, and marking every scene isn't a requirement to get to the
 * guided prompts.
 *
 * Layout: a two-panel shell on md+ (image/canvas flush left at 70% width,
 * a white controls panel at 30% on the right -- same "media left, white
 * form panel right" pattern as EditSketch.jsx and CreateSketch's own
 * phase A), stacked on mobile via the same breakpoint. Every phase's
 * heading/body copy/buttons live in that white panel rather than
 * overlaid on the photo -- the only thing that ever sits on the black
 * side is the photo itself, the rule-of-thirds grid, and the reticles.
 *
 * Reused (not duplicated) from EditSketch.jsx as a "Focal points" view
 * alongside Photo / Perspective lines / Dominant value shapes -- marking
 * a scene's focal points is as much a part of a sketcher's discovery
 * process as those other analyses, so it shouldn't only be available
 * once, during the original capture wizard. That caller passes
 * `initialOwnPoints` (from the sketch's already-saved `focal_points`)
 * and pre-annotates `focalRegions` with `adopted`/`asked` for whichever
 * Gemini suggestions were already accepted, so reopening this view shows
 * exactly what was confirmed before rather than starting blank -- while
 * anything Gemini suggested but the sketcher never resolved still
 * surfaces again via the normal mark-asking flow, in case they want to
 * reconsider it.
 */
export default function FocalFrameEditor({
  sketchId,
  originalImageUrl,
  initialCropTransform,
  focalRegions = [],
  // Pre-existing confirmed points, for reopening this component on a
  // sketch that's already been through the mark-then-frame flow once
  // (EditSketch.jsx's "Focal points" view) -- same {x, y} shape as what
  // handleMarkTap produces, in the same coordinate frame `focalRegions`
  // and `initialCropTransform` already describe. Empty for a fresh
  // capture, where there's nothing to pre-fill yet.
  initialOwnPoints = [],
  onSaved,
  onSkip,
  // Optional -- when passed, renders a small "Retake photo" link in the
  // white panel, visible across every phase. Needed because photos now
  // upload immediately on pick (no Continue gate in CreateSketch's
  // phase A): by the time this component is mounted there's already a
  // real sketch row + uploaded file on the server, so the caller is
  // expected to actually clean that up (not just reset its own local
  // state) when this fires.
  onRetake,
  maxHeightVh = 55,
  panelHeightPx = null,
}) {
  const aspectRatioKey = initialCropTransform?.aspect_ratio || 'original'
  const initialTransform = {
    zoom: initialCropTransform?.zoom ?? 1,
    offset_x: initialCropTransform?.offset_x ?? 0,
    offset_y: initialCropTransform?.offset_y ?? 0,
  }
  const initialTransformRef = useRef(initialTransform)

  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const svgRef = useRef(null)
  const [naturalSize, setNaturalSize] = useState(null)
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 })

  const [phase, setPhase] = useState('mark-placing')
  // Rule-of-thirds overlay during the frame-adjusting phase -- on by
  // default (most sketchers want the composition guide), toggleable via
  // the button next to the zoom slider below for the few who find it
  // distracting once they've settled on a frame.
  const [showGrid, setShowGrid] = useState(true)
  const [ownPoints, setOwnPoints] = useState(initialOwnPoints) // {x,y}, normalized to the fixed initial frame
  // `focalRegions` entries may already carry `adopted`/`asked` (EditSketch.jsx
  // sets `adopted: true` for whichever regions a previous focal_points
  // save recorded as source: "adopted") -- default only what's actually
  // unset, rather than always resetting to a blank slate, so a
  // previously accepted suggestion still shows as accepted on reopen,
  // while anything never resolved still surfaces via the mark-asking
  // flow same as a fresh capture.
  const [regions, setRegions] = useState(() =>
    focalRegions.map((r) => ({ ...r, asked: r.asked ?? false, adopted: r.adopted ?? false }))
  )
  const [pendingMarkQuestions, setPendingMarkQuestions] = useState([]) // indices into `regions`
  const [markQuestionPos, setMarkQuestionPos] = useState(0)

  // zoom/offset are only interactive during the "frame" phase -- fixed at
  // the sketch's current framing throughout "mark" so marked coordinates
  // stay in the same space focal_regions is already in.
  const [zoom, setZoom] = useState(initialTransform.zoom)
  const [offset, setOffset] = useState({ x: initialTransform.offset_x, y: initialTransform.offset_y })
  // Refs mirroring the two above, kept in sync on every change -- gesture
  // handlers (and the confirm step) read these instead of the state
  // variables so a pointerup right after the last pointermove of a
  // gesture never sees a stale, not-yet-rendered value.
  const zoomRef = useRef(zoom)
  const offsetRef = useRef(offset)

  const confirmedPointsRef = useRef([]) // {x, y, source, region_ref} in the ORIGINAL frame's space, snapshotted on entering "frame"
  const originSpacePointsRef = useRef([]) // same points, reprojected into the original PHOTO's own space -- the fixed reference every candidate frame reprojects from
  const [removedIndices, setRemovedIndices] = useState(new Set()) // indices into the two refs above
  const [frameQuestionQueue, setFrameQuestionQueue] = useState([])
  const [frameQuestionPos, setFrameQuestionPos] = useState(0)
  const gestureSnapshotRef = useRef(null) // transform right before the in-progress gesture, for "keep it in frame"

  const pointersRef = useRef(new Map())
  const gestureRef = useRef(null)
  const wheelTimerRef = useRef(null)
  const phaseRef = useRef(phase) // mirrors `phase` for the wheel debounce's setTimeout callback, which
  phaseRef.current = phase // would otherwise close over whatever `phase` was at the moment the wheel fired

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const ratio = resolveAspectRatio(aspectRatioKey, naturalSize)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    function recompute() {
      const availableWidth = container.clientWidth
      // On md+ the host gives this component's black panel a fixed CSS
      // height (`panelHeightPx`, matching the wizard modal's own
      // `md:h-[520px]`) -- reading that directly is more accurate than a
      // viewport-relative guess now that the modal is a fixed size rather
      // than growing/shrinking with content. Below the `md` breakpoint
      // the panel has no explicit height (mobile stacks instead), so
      // container.clientHeight there would just reflect this same
      // absolutely-positioned content circularly -- fall back to the
      // viewport-fraction estimate in that case, same as before.
      const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768
      const availableHeight = isDesktop && panelHeightPx ? panelHeightPx : window.innerHeight * (maxHeightVh / 100)
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
  }, [ratio, maxHeightVh, panelHeightPx])

  function setZoomTracked(z) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
    zoomRef.current = clamped
    setZoom(clamped)
  }
  function setOffsetTracked(o) {
    offsetRef.current = o
    setOffset(o)
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

  // -- Mark phase --

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

  // -- Frame phase --

  function enterFramePhase() {
    const pts = confirmedPointsFromState()
    confirmedPointsRef.current = pts
    originSpacePointsRef.current = pts.map((p) => toOriginalSpace(p, ratio, initialTransformRef.current, naturalSize))
    setRemovedIndices(new Set())
    setZoomTracked(initialTransformRef.current.zoom)
    setOffsetTracked({ x: initialTransformRef.current.offset_x, y: initialTransformRef.current.offset_y })
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
    // Accepted simplification (documented in the earlier prototype too):
    // if one gesture excluded more than one anchor and they're answered
    // differently, "keep it in frame" reverts the WHOLE gesture rather
    // than computing the minimal adjustment that would satisfy only the
    // anchor currently being asked about -- an anchor already removed
    // earlier in the same batch stays removed regardless.
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

  // -- Frame gestures (pan / pinch / wheel) --

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
    // Wheel zoom has no discrete "gesture end" the way a pointer lifting
    // does -- checking on every tick would interrupt a still-scrolling
    // trackpad, so debounce via a ref-held timer (a plain property on
    // this function would live on a fresh function object every render
    // and never actually get cleared) and re-check `phase` when it fires,
    // since the phase at that later moment may not match what it was
    // when this event handler ran.
    window.clearTimeout(wheelTimerRef.current)
    wheelTimerRef.current = window.setTimeout(() => {
      if (phaseRef.current === 'frame-adjusting') checkFrameExclusions()
    }, 250)
  }

  // The zoom slider is a second, explicit way to reach the same zoom the
  // pinch/wheel gestures already drive (some sketchers on a desktop
  // mouse have neither a trackpad pinch nor an obvious reason to try the
  // wheel) -- it shares zoomRef/checkFrameExclusions with those gestures
  // rather than duplicating them. A plain <input type="range"> fires
  // onChange continuously while dragging (there's no native "commit"
  // event), so gesture bookkeeping is split the same way the pointer
  // handlers split pointerdown/pointermove/pointerup: snapshot on
  // pointerdown (for "keep it in frame" to revert to), track on every
  // change, and only check for newly-excluded points on pointerup.
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
      onSaved?.(data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save your focal points.')
    } finally {
      setSaving(false)
    }
  }

  const box =
    naturalSize && boxSize.width && boxSize.height
      ? computeImageBox(boxSize.width, boxSize.height, naturalSize.width, naturalSize.height, zoom, offset.x, offset.y)
      : null

  const isFramePhase = phase === 'frame-adjusting' || phase === 'frame-asking'
  const reticles = isFramePhase
    ? projectedPoints()
    : confirmedPointsFromState().map((p, i) => ({ i, x: p.x, y: p.y, source: p.source, region_ref: p.region_ref }))

  return (
    // Two-panel shell: image/canvas flush left (70%), white controls
    // panel right (30%) on md+; stacked (image on top, panel below) on
    // mobile via the same `md:` breakpoint EditSketch.jsx and
    // CreateSketch's phase A use. This always renders inside
    // SketchFlowPage's own <main>, so it has no outer max-width of its
    // own -- the grid just fills whatever width it's given.
    <div className="md:grid md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
      <div ref={containerRef} className={`flex w-full items-center justify-center bg-black p-3 md:p-4 ${WIZARD_PANEL_HEIGHT_CLASS}`}>
        <div
          className="relative touch-none select-none overflow-hidden bg-black"
          style={{ width: boxSize.width || '100%', height: boxSize.height || undefined }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
        >
          {/* crossOrigin is required here -- the old capture-step crop UI's
              <img> drew a same-origin blob: URL (the picked file,
              pre-upload) onto its canvas, but this component's photo is
              already server-hosted (originalImageUrl points at the
              backend, a different origin from the Vite dev server) --
              without it, bakeCrop()'s canvas.toBlob() silently taints
              and rejects with no network call ever firing. The backend's
              CORS config (config.py's ALLOWED_ORIGINS/_REGEX) already
              allows the frontend's origin, so this just opts the image
              fetch into that existing allowance. */}
          <img
            ref={imgRef}
            src={originalImageUrl}
            alt=""
            draggable={false}
            crossOrigin="anonymous"
            onLoad={handleImageLoad}
            className="pointer-events-none absolute box-border"
            style={box ? { left: box.left, top: box.top, width: box.width, height: box.height } : { opacity: 0 }}
          />
          {isFramePhase && showGrid && <RuleOfThirdsGrid />}
          <svg
            ref={svgRef}
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            style={{ cursor: phase === 'mark-placing' && ownPoints.length < OWN_POINT_CAP ? 'crosshair' : 'default' }}
            onClick={handleMarkTap}
          >
            {reticles.map(({ i, x, y }) => (
              <g
                key={i}
                style={{ cursor: phase === 'mark-placing' ? 'pointer' : 'default' }}
                onClick={(e) => {
                  if (phase !== 'mark-placing') return
                  e.stopPropagation()
                  if (i < ownPoints.length) {
                    removeOwnPoint(i)
                  } else {
                    // An adopted point tapped back off -- stays `asked`
                    // so Continue never re-offers the same suggestion.
                    const regionIdx = reticles[i]?.region_ref
                    if (regionIdx != null) {
                      setRegions((prev) => prev.map((r, ri) => (ri === regionIdx ? { ...r, adopted: false } : r)))
                    }
                  }
                }}
              >
                <rect x={x - RETICLE_SIZE} y={y - RETICLE_SIZE} width={RETICLE_SIZE * 2} height={RETICLE_SIZE * 2} fill="transparent" />
                <Reticle x={x} y={y} />
              </g>
            ))}
          </svg>
        </div>
      </div>

      {/* White controls panel -- every phase's heading, body copy and
          buttons live here rather than overlaid on the photo. */}
      <div className="flex flex-col justify-center gap-4 bg-white p-5 text-ink md:p-6">
        {onRetake && (
          <button
            type="button"
            onClick={onRetake}
            className="self-end text-xs font-medium text-ink/50 transition-colors hover:text-ink"
          >
            Retake photo
          </button>
        )}

        {phase === 'mark-placing' && (
          <div className="animate-fade-in-up">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">Mark your focal points</h2>
            <p className="mt-2 text-sm text-ink/70">
              Tap the photo for what catches your eye. Gemini will ask about anything you missed once you continue.
            </p>
            <p className="mt-3 text-xs text-ink/50">
              Your own: {ownPoints.length} / {OWN_POINT_CAP}
              {ownPoints.length >= OWN_POINT_CAP && ' — tap a marker to remove it and free up a spot'}
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button onClick={onSkip} className="text-sm font-medium text-ink/50 hover:text-ink">
                Skip this step
              </button>
              <Button size="sm" onClick={handleMarkContinue}>Continue</Button>
            </div>
          </div>
        )}

        {phase === 'mark-asking' && (
          <div className="animate-fade-in-up">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
              Question {markQuestionPos + 1} of {pendingMarkQuestions.length}
            </p>
            <p className="mt-1 text-base font-semibold leading-snug">
              Gemini also noticed {regions[pendingMarkQuestions[markQuestionPos]]?.label} — add it as a focal point?
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => answerMarkQuestion(false)}>
                No thanks
              </Button>
              <Button size="sm" className="flex-1" onClick={() => answerMarkQuestion(true)}>
                Yes, add it
              </Button>
            </div>
          </div>
        )}

        {phase === 'frame-adjusting' && (
          <div className="animate-fade-in-up">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">Fine-tune the frame</h2>
            <p className="mt-2 text-xs text-ink/60">
              Drag the photo to pan, or use the slider to zoom — watch how your points sit against the rule-of-thirds
              grid. Moving one out of frame will ask before letting it go.
            </p>
            <button
              type="button"
              onClick={() => setShowGrid((v) => !v)}
              className={`mt-3 self-start rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                showGrid ? 'bg-ink text-white' : 'bg-ink/10 text-ink/60 hover:bg-ink/20'
              }`}
            >
              Rule of thirds grid: {showGrid ? 'On' : 'Off'}
            </button>
            <div className="mt-4 flex items-center gap-2">
              <span className="text-xs text-ink/40">−</span>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onPointerDown={handleZoomSliderStart}
                onChange={handleZoomSliderChange}
                onPointerUp={handleZoomSliderCommit}
                className="h-1.5 flex-1 accent-ink"
                aria-label="Zoom"
              />
              <span className="text-xs text-ink/40">+</span>
            </div>
            <Button size="sm" className="mt-4 w-full" onClick={handleConfirmFrame} disabled={saving}>
              {saving ? 'Saving…' : 'Confirm framing'}
            </Button>
          </div>
        )}

        {phase === 'frame-asking' && (
          <div className="animate-fade-in-up">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
              Question {frameQuestionPos + 1} of {frameQuestionQueue.length}
            </p>
            <p className="mt-1 text-base font-semibold leading-snug">
              You've moved {anchorLabel(frameQuestionQueue[frameQuestionPos])} out of frame — not interested in that
              area anymore?
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={handleFrameKeep}>
                No, keep it in frame
              </Button>
              <Button size="sm" className="flex-1" onClick={handleFrameRemove}>
                Correct, remove it
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-accent">{error}</p>}
      </div>
    </div>
  )
}
