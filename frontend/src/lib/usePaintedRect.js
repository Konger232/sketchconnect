import { useCallback, useEffect, useState } from 'react'

/**
 * Where an object-fit: contain <img> actually paints its picture, as
 * { left, top, width, height } in px relative to the image's offset parent.
 *
 * An <img> box can be larger than the picture inside it: object-contain
 * letterboxes the picture, and when the panel height changes (for example
 * a line of text appears below it), browsers can shrink the picture while
 * keeping the box at its old width. Overlays sized to the box (inset-0)
 * then drift off the photo. Overlays placed in this rect stay on it.
 *
 * Usage: const [imgRef, rect] = usePaintedRect()
 *        <img ref={imgRef} ... />
 *        <div className="absolute" style={rect}>…overlays with inset-0…</div>
 */
export function usePaintedRect() {
  const [img, setImg] = useState(null)
  const [rect, setRect] = useState(null)

  const imgRef = useCallback((node) => setImg(node), [])

  useEffect(() => {
    if (!img) return
    const measure = () => {
      const bw = img.clientWidth
      const bh = img.clientHeight
      const nw = img.naturalWidth
      const nh = img.naturalHeight
      if (!bw || !bh || !nw || !nh) return
      const scale = Math.min(bw / nw, bh / nh)
      const width = nw * scale
      const height = nh * scale
      setRect({
        left: img.offsetLeft + (bw - width) / 2,
        top: img.offsetTop + (bh - height) / 2,
        width,
        height,
      })
    }
    measure()
    img.addEventListener('load', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(img)
    if (img.parentElement) observer.observe(img.parentElement)
    return () => {
      img.removeEventListener('load', measure)
      observer.disconnect()
    }
  }, [img])

  return [imgRef, rect]
}
