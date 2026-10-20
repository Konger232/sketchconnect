import { useEffect, useRef, useState } from 'react'
import { StripImage } from './StageStrip'
import { hslToRgb, rgbToHsl, xyToWheel } from '../../lib/colorWheel'
import { squeezeIntoMask, toUnit } from '../../lib/gamutMask'

const MAX_PX = 720 // the photo is worked on at this size, at most

// The reference photo's pixels, loaded once (CORS, as FocalFrameEditor).
// The photo's pixels, or `false` when they can't be read. The request gets
// its own URL: the page may already have this photo cached from a plain
// <img> (no CORS header), and the browser would reuse that copy and block
// the read.
function usePhotoPixels(src) {
  const [pixels, setPixels] = useState(null)
  useEffect(() => {
    if (!src) return
    let alive = true
    setPixels(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onerror = () => { if (alive) setPixels(false) }
    img.onload = () => {
      const scale = Math.min(1, MAX_PX / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      try {
        if (alive) setPixels(ctx.getImageData(0, 0, w, h))
      } catch {
        // A photo without CORS: sampling and the recolour are not available.
        if (alive) setPixels(false)
      }
    }
    img.src = src.startsWith('blob:') || src.startsWith('data:') ? src : `${src}${src.includes('?') ? '&' : '?'}px=1`
    return () => { alive = false }
  }, [src])
  return pixels
}

/**
 * The reference photo on the Color tab: tap a spot to see its colour on
 * the wheel and the nearest mix in the mask. Laid out as StripImage.
 */
export function SamplePhoto({ src, onSample, overlay }) {
  const pixels = usePhotoPixels(src)
  function tap(e) {
    if (!pixels) return
    const r = e.currentTarget.getBoundingClientRect()
    // object-contain: find the drawn photo inside the img box.
    const ratio = pixels.width / pixels.height
    let w = r.width, h = r.width / ratio
    if (h > r.height) { h = r.height; w = h * ratio }
    const x = (e.clientX - r.left - (r.width - w) / 2) / w
    const y = (e.clientY - r.top - (r.height - h) / 2) / h
    if (x < 0 || y < 0 || x > 1 || y > 1) return
    const i = (Math.floor(y * (pixels.height - 1)) * pixels.width + Math.floor(x * (pixels.width - 1))) * 4
    const [pr, pg, pb] = [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]]
    const [hh, s] = rgbToHsl(pr, pg, pb)
    const hex = `#${[pr, pg, pb].map((v) => v.toString(16).padStart(2, '0')).join('')}`
    onSample({ h: hh, c: s, hex, from: 'photo' })
  }
  return (
    <StripImage src={src} alt="Reference photo: tap a spot to see its mix" grid onClick={tap} overlay={overlay} className={pixels ? 'cursor-crosshair' : ''} />
  )
}

/**
 * "In your mask": the reference photo in the mask's key (Gurney). The
 * whole wheel is squeezed into the mask, so every colour moves into it and
 * keeps its place relative to the others; lightness is kept. In the
 * browser, so it follows the mask as it is dragged; no AI call. It
 * previews the photo, not a painting.
 */
export function MaskedPhoto({ src, shapes, overlay }) {
  const { url, pixels } = useMaskedPhoto(src, shapes)
  if (url) return <StripImage src={url} alt="The reference photo in your mask's colours" grid overlay={overlay} />
  // No mask, or the photo can't be read: the photo as it is.
  if (!shapes.length || pixels === false) return <StripImage src={src} alt="Reference photo" grid overlay={overlay} />
  return (
    <div className="flex min-h-[40vh] flex-1 items-center justify-center">
      <p className="animate-pulse px-6 py-16 text-center text-md text-sc-text3">
        {'Working…'}
      </p>
    </div>
  )
}

// The recolour itself, for MaskedPhoto and SketchDetail: { url, pixels },
// url null until ready (or with no mask), pixels false if unreadable.
export function useMaskedPhoto(src, shapes) {
  const pixels = usePhotoPixels(src)
  const [url, setUrl] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    if (!pixels || !shapes.length) { setUrl(null); return }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const squeeze = squeezeIntoMask(shapes)
      const out = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height)
      const d = out.data
      for (let i = 0; i < d.length; i += 4) {
        const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2])
        const q = squeeze(toUnit({ h, c: s }))
        const w = xyToWheel(q[0] + 1, q[1] + 1, 2)
        const [r, g, b] = hslToRgb(w.h, Math.min(1, w.c), l)
        d[i] = r; d[i + 1] = g; d[i + 2] = b
      }
      const canvas = document.createElement('canvas')
      canvas.width = out.width; canvas.height = out.height
      canvas.getContext('2d').putImageData(out, 0, 0)
      setUrl(canvas.toDataURL('image/jpeg', 0.9))
    }, 120)
    return () => clearTimeout(timer.current)
  }, [pixels, shapes])
  return { url, pixels }
}
