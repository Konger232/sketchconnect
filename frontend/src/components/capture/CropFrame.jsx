import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import RuleOfThirdsGrid from './RuleOfThirdsGrid'
import { bakeCrop, computeImageBox, resolveAspectRatio } from '../../lib/cropMath'

const MIN_ZOOM = 0.2
const MAX_ZOOM = 4

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// The Capture screen's Instagram-style crop surface: a fixed-ratio,
// black-backed frame the sketcher can drag the photo around inside of and
// zoom in (crop tighter, the common case) or out past the photo's own
// edges (shrinking it below the frame, leaving black behind it -- a
// deliberate SketchConnect choice for a sketcher who wants their subject
// small, surrounded by negative space, not something a typical photo
// cropper allows). RuleOfThirdsGrid is drawn fixed to the frame rather
// than the photo, since the frame -- not the original photo underneath --
// is the actual composition once Save bakes it (see CapturePage.jsx and
// cropMath.js's bakeCrop).
//
// One pointer handler owns two gestures on the same surface: a single
// finger/pointer pans the photo, and a second finger touching down
// mid-gesture switches to pinch-zoom. Mouse-wheel is a third, unambiguous
// way to zoom on desktop. (An earlier version also placed a focal-point
// marker on a plain tap here -- removed as not useful in practice; the
// crop/zoom itself is the composition signal now.)
//
// Sizing: the frame's on-screen box is computed in JS (below), not left
// to CSS `aspect-ratio` + a width/height cap. That combination looks like
// it should "letterbox" the way `object-fit: contain` does on an <img>,
// but that fitting behavior is specific to replaced elements -- on a
// plain block/inline-block box it isn't reliably derived by browsers, and
// in practice it collapsed the frame to ~0 size instead of shrinking it
// sensibly. Measuring the available column width and a height budget
// ourselves, then picking whichever dimension is the limiting one, gives
// the same "fit both the column and the viewport" result without relying
// on that CSS edge case.
const CropFrame = forwardRef(function CropFrame(
  { src, naturalSize, onNaturalSize, aspectRatioKey, zoom, onZoomChange, offset, onOffsetChange, maxHeightVh = 50 },
  ref
) {
  const containerRef = useRef(null) // full-width slot this component fills; sets the width budget
  const frameRef = useRef(null) // the actual sized/painted box, once boxSize is known
  const imgRef = useRef(null)
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 })

  const ratio = resolveAspectRatio(aspectRatioKey, naturalSize)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    function recompute() {
      const availableWidth = container.clientWidth
      const availableHeight = window.innerHeight * (maxHeightVh / 100)
      if (!availableWidth || !availableHeight) return
      const heightAtFullWidth = availableWidth / ratio
      if (heightAtFullWidth <= availableHeight) {
        // Width is the limiting dimension (the common case -- a
        // landscape or squarish photo in a narrow column).
        setBoxSize({ width: availableWidth, height: heightAtFullWidth })
      } else {
        // Height is the limiting dimension (a portrait photo that would
        // otherwise run taller than the available viewport height).
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
  }, [ratio, maxHeightVh])

  useImperativeHandle(
    ref,
    () => ({
      bake: () =>
        bakeCrop({
          imageEl: imgRef.current,
          naturalSize,
          aspectRatioKey,
          zoom,
          offset,
        }),
    }),
    [naturalSize, aspectRatioKey, zoom, offset]
  )

  const pointersRef = useRef(new Map()) // pointerId -> { x, y }
  const gestureRef = useRef(null)

  function handlePointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size === 1) {
      gestureRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, startOffset: offset }
    } else if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values())
      gestureRef.current = { mode: 'pinch', startDistance: distance(pts[0], pts[1]), startZoom: zoom }
    }
  }

  function handlePointerMove(e) {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gestureRef.current
    if (!g || !boxSize.width || !boxSize.height) return

    if (g.mode === 'pan') {
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      onOffsetChange({
        x: g.startOffset.x + dx / boxSize.width,
        y: g.startOffset.y + dy / boxSize.height,
      })
    } else if (g.mode === 'pinch') {
      const pts = Array.from(pointersRef.current.values())
      if (pts.length < 2) return
      const ratio = distance(pts[0], pts[1]) / g.startDistance
      onZoomChange(clamp(g.startZoom * ratio, MIN_ZOOM, MAX_ZOOM))
    }
  }

  function handlePointerUp(e) {
    pointersRef.current.delete(e.pointerId)

    if (pointersRef.current.size === 0) {
      gestureRef.current = null
    } else if (pointersRef.current.size === 1) {
      // Dropped from two fingers back to one -- start a fresh pan from
      // here instead of reusing stale pinch state.
      const [[, pt]] = Array.from(pointersRef.current.entries())
      gestureRef.current = { mode: 'pan', startX: pt.x, startY: pt.y, startOffset: offset }
    }
  }

  function handleWheel(e) {
    e.preventDefault()
    onZoomChange(clamp(zoom * (1 - e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM))
  }

  function handleImageLoad(e) {
    onNaturalSize({ width: e.target.naturalWidth, height: e.target.naturalHeight })
  }

  const box =
    naturalSize && boxSize.width && boxSize.height
      ? computeImageBox(boxSize.width, boxSize.height, naturalSize.width, naturalSize.height, zoom, offset.x, offset.y)
      : null

  return (
    <div ref={containerRef} className="w-full">
      <div
        ref={frameRef}
        className="relative mx-auto touch-none select-none overflow-hidden rounded-xl bg-black"
        style={{ width: boxSize.width || '100%', height: boxSize.height || undefined }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          draggable={false}
          onLoad={handleImageLoad}
          className="pointer-events-none absolute"
          style={box ? { left: box.left, top: box.top, width: box.width, height: box.height } : { opacity: 0 }}
        />
        <RuleOfThirdsGrid />
      </div>
    </div>
  )
})

export default CropFrame
