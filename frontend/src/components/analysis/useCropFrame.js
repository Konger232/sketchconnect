import { useLayoutEffect, useRef, useState } from 'react'
import { bakeCrop, computeImageBox, reframeToRect, resolveAspectRatio } from '../../lib/cropMath'

/**
 * The crop frame (design doc, item 57): pan, pinch and wheel zoom inside
 * the frame, corner drags to crop, and the frame fitted to the stage.
 * Moved from New Sketch's crop step; Capture's Crop tool uses it. Draw
 * ImagePanel with containerRef, imgRef, boxSize, box, zoom, offset,
 * cropRect, cornerHandlers and the stage handlers from here.
 *
 * active: the Crop tool is open (the frame lays out for it).
 * layoutKey: anything that changes the stage's size, such as the photo.
 */

const MIN_ZOOM = 0.2
const MAX_ZOOM = 8
// Smallest frame a corner drag can leave, as a share of each side.
const MIN_CROP = 0.2

export const UNTOUCHED_FRAME = { aspect_ratio: 'original', ratio: null, zoom: 1, offset_x: 0, offset_y: 0 }

export function sameFrame(a, b) {
  return !!a && !!b && a.aspect_ratio === b.aspect_ratio && a.ratio === b.ratio &&
    a.zoom === b.zoom && a.offset_x === b.offset_x && a.offset_y === b.offset_y
}

function pointerDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function useCropFrame({ active, layoutKey }) {
  const [aspectRatioKey, setAspectRatioKey] = useState('original')
  const [customRatio, setCustomRatio] = useState(null) // after a free corner crop
  const [cropRect, setCropRect] = useState(null) // the frame while a corner is dragged
  const cornerRef = useRef(null)
  // The frame last saved on the server. The upload itself is the untouched
  // frame, so Save with no change saves nothing.
  const savedFrameRef = useRef(UNTOUCHED_FRAME)

  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const [naturalSize, setNaturalSize] = useState(null)
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 })

  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const zoomRef = useRef(zoom)
  const offsetRef = useRef(offset)
  const pointersRef = useRef(new Map())
  const gestureRef = useRef(null)

  const ratio = resolveAspectRatio(aspectRatioKey, naturalSize, customRatio)

  // Fit the frame into the stage at the chosen ratio.
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
  }, [ratio, active, layoutKey])

  const box =
    naturalSize && boxSize.width && boxSize.height
      ? computeImageBox(boxSize.width, boxSize.height, naturalSize.width, naturalSize.height, zoom, offset.x, offset.y)
      : null

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

  // A new photo: the whole frame again, nothing saved.
  function reset() {
    setAspectRatioKey('original')
    setCustomRatio(null)
    setCropRect(null)
    setNaturalSize(null)
    resetTransform()
    savedFrameRef.current = UNTOUCHED_FRAME
  }

  // Pan with one finger or the mouse, pinch with two, wheel to zoom.
  const stageHandlers = {
    onPointerDown(e) {
      e.currentTarget.setPointerCapture(e.pointerId)
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointersRef.current.size === 1) {
        gestureRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, startOffset: offsetRef.current }
      } else if (pointersRef.current.size === 2) {
        const pts = Array.from(pointersRef.current.values())
        gestureRef.current = { mode: 'pinch', startDistance: pointerDistance(pts[0], pts[1]), startZoom: zoomRef.current }
      }
    },
    onPointerMove(e) {
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
    },
    onPointerUp(e) {
      pointersRef.current.delete(e.pointerId)
      if (pointersRef.current.size === 0) {
        gestureRef.current = null
      } else if (pointersRef.current.size === 1) {
        const [[, pt]] = Array.from(pointersRef.current.entries())
        gestureRef.current = { mode: 'pan', startX: pt.x, startY: pt.y, startOffset: offsetRef.current }
      }
    },
    onWheel(e) {
      e.preventDefault()
      setZoomTracked(zoomRef.current * (1 - e.deltaY * 0.0015))
    },
  }
  stageHandlers.onPointerCancel = stageHandlers.onPointerUp

  // Corner crop. A corner drag shrinks the frame from that corner while the
  // opposite corner stays put. On release the frame refits the stage and
  // the photo zooms so the dragged area fills it (reframeToRect).
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

  // The frame as it is now, in the shape the server stores (crop_transform).
  function frame() {
    return {
      aspect_ratio: aspectRatioKey,
      ratio: aspectRatioKey === 'custom' ? customRatio : null,
      zoom: zoomRef.current,
      offset_x: offsetRef.current.x,
      offset_y: offsetRef.current.y,
    }
  }
  const changed = () => !sameFrame(frame(), savedFrameRef.current)

  // The framed photo as a JPEG blob, from the <img> on the stage.
  function bake() {
    const f = frame()
    return bakeCrop({
      imageEl: imgRef.current, naturalSize, aspectRatioKey, customRatio,
      zoom: f.zoom, offset: { x: f.offset_x, y: f.offset_y },
    })
  }
  function markSaved(f = frame()) { savedFrameRef.current = f }

  return {
    containerRef, imgRef, naturalSize, boxSize, box, zoom, offset, ratio, cropRect,
    stageHandlers, cornerHandlers, handleImageLoad, frame, changed, bake, markSaved, reset,
  }
}
