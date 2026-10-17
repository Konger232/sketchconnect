// The Share carousel (design doc, item 29): 1080 x 1350 images, Instagram's
// portrait size, drawn on a canvas in the browser. Nothing is posted for
// the sketcher; they share or download the files themselves.

export const SLIDE_W = 1080
export const SLIDE_H = 1350

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // the API serves uploads with CORS headers
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Could not load ${src}`))
    img.src = src
  })
}

function canvas() {
  const c = document.createElement('canvas')
  c.width = SLIDE_W
  c.height = SLIDE_H
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H)
  return [c, ctx]
}

// The image fitted inside the slide with a margin, on white; returns the box.
function drawFitted(ctx, img, margin = 60) {
  const w = SLIDE_W - margin * 2
  const h = SLIDE_H - margin * 2
  const s = Math.min(w / img.width, h / img.height)
  const dw = img.width * s
  const dh = img.height * s
  const x = (SLIDE_W - dw) / 2
  const y = (SLIDE_H - dh) / 2
  ctx.drawImage(img, x, y, dw, dh)
  return { x, y, w: dw, h: dh }
}

function mark(ctx) {
  ctx.font = '600 26px Inter, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(17,17,17,0.55)'
  ctx.textAlign = 'right'
  ctx.fillText('SketchConnect', SLIDE_W - 48, SLIDE_H - 30)
}

const toBlob = (c) => new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.92))

export async function photoSlide(src, { watermark } = {}) {
  const img = await loadImage(src)
  const [c, ctx] = canvas()
  drawFitted(ctx, img)
  if (watermark) mark(ctx)
  return toBlob(c)
}

// The plan: the cropped photo with the sketcher's strokes (0-1000 frame
// units, Marks.jsx), at the stroke widths they drew.
export async function planSlide(src, marks, { watermark } = {}) {
  const img = await loadImage(src)
  const [c, ctx] = canvas()
  const box = drawFitted(ctx, img)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const m of marks || []) {
    if (!m.points?.length || m.erased) continue
    ctx.strokeStyle = m.color || '#fde68a'
    ctx.lineWidth = Math.max(2, (m.width || 4) * (box.w / 1000))
    ctx.beginPath()
    m.points.forEach(([x, y], i) => {
      const px = box.x + (x / 1000) * box.w
      const py = box.y + (y / 1000) * box.h
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    if (m.points.length === 1) ctx.lineTo(box.x + (m.points[0][0] / 1000) * box.w + 0.5, box.y + (m.points[0][1] / 1000) * box.h)
    ctx.stroke()
  }
  if (watermark) mark(ctx)
  return toBlob(c)
}

// The palette card: one bar per paint, with its code and name.
export async function paletteSlide(title, paints, inkFor, { watermark } = {}) {
  const [c, ctx] = canvas()
  ctx.fillStyle = '#111111'
  ctx.textAlign = 'left'
  ctx.font = '600 30px Inter, system-ui, sans-serif'
  ctx.fillText('PALETTE', 80, 140)
  ctx.font = '700 54px Roboto, system-ui, sans-serif'
  ctx.fillText(title || 'Untitled sketch', 80, 215, SLIDE_W - 160)
  const top = 290
  const barH = Math.min(150, (SLIDE_H - top - 120) / Math.max(paints.length, 1))
  paints.forEach((p, i) => {
    const y = top + i * barH
    ctx.fillStyle = p.hex
    ctx.fillRect(80, y, SLIDE_W - 160, barH)
    ctx.fillStyle = inkFor(p.hex)
    ctx.font = '700 26px Inter, system-ui, sans-serif'
    ctx.fillText(p.code, 110, y + barH / 2 - 6)
    ctx.font = '500 34px Inter, system-ui, sans-serif'
    ctx.fillText(p.name, 110, y + barH / 2 + 34)
  })
  if (watermark) mark(ctx)
  return toBlob(c)
}

export function canShareFiles(files) {
  return typeof navigator !== 'undefined' && navigator.canShare?.({ files })
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
