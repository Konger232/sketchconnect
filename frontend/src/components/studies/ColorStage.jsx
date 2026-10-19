import { useEffect, useRef, useState } from 'react'
import { StripImage } from '../analysis/StageStrip'
import { clampToPolygon, hslToRgb, rgbToHsl, wheelToXY, xyToWheel } from '../../lib/colorWheel'

const MAX_PX = 720 // the photo is worked on at this size, at most

// The reference photo's pixels, loaded once (CORS, as FocalFrameEditor).
function usePhotoPixels(src) {
  const [pixels, setPixels] = useState(null)
  useEffect(() => {
    if (!src) return
    let alive = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
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
      }
    }
    img.src = src
    return () => { alive = false }
  }, [src])
  return pixels
}

/**
 * The reference photo on the Color tab: tap a spot to see its colour on
 * the wheel and the nearest mix in the mask. Laid out as StripImage.
 */
export function SamplePhoto({ src, onSample }) {
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
    const [hh, s] = rgbToHsl(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2])
    onSample({ h: hh, c: s, from: 'photo' })
  }
  return (
    <StripImage src={src} alt="Reference photo: tap a spot to see its mix" grid onClick={tap} className={pixels ? 'cursor-crosshair' : ''} />
  )
}

/**
 * "In your colours": the reference photo with every colour moved to the
 * nearest colour inside the mask, lightness kept. In the browser, no AI
 * call. It previews the photo, not a painting.
 */
export function MaskedPhoto({ src, corners }) {
  const pixels = usePhotoPixels(src)
  const [url, setUrl] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    if (!pixels || corners.length < 3) { setUrl(null); return }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const pts = corners.map((c) => wheelToXY(c, 2))
      const out = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height)
      const d = out.data
      for (let i = 0; i < d.length; i += 4) {
        const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2])
        const p = wheelToXY({ h, c: s }, 2)
        const q = clampToPolygon(p, pts)
        if (q === p) continue
        const w = xyToWheel(q[0], q[1], 2)
        const [r, g, b] = hslToRgb(w.h, Math.min(1, w.c), l)
        d[i] = r; d[i + 1] = g; d[i + 2] = b
      }
      const canvas = document.createElement('canvas')
      canvas.width = out.width; canvas.height = out.height
      canvas.getContext('2d').putImageData(out, 0, 0)
      setUrl(canvas.toDataURL('image/jpeg', 0.9))
    }, 120)
    return () => clearTimeout(timer.current)
  }, [pixels, corners])

  if (url) return <StripImage src={url} alt="The reference photo in your mask's colours" grid />
  return (
    <div className="flex min-h-[40vh] flex-1 items-center justify-center">
      <p className="px-6 py-16 text-center text-md text-sc-text3">
        {corners.length < 3 ? 'Make a mask of three or more paints to see the photo in its colours.' : 'Working…'}
      </p>
    </div>
  )
}
