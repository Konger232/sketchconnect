import { useMemo, useState } from 'react'
import Button from '../common/Button'
import FloatPanel from '../common/FloatPanel'
import Icon from '../common/Icon'
import { readableInk } from '../../lib/color'
import { mediaLabel } from '../../data/media'
import { canShareFiles, download, paletteSlide, photoSlide, planSlide } from '../../lib/shareCarousel'

const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Share (design doc, item 29; design handoff, Sketch Detail). A carousel of
 * 1080 x 1350 images in this order: final sketch, in-progress shots (with
 * item 35), reference photo, plan, palette. Tap an image to leave it out.
 * The caption is drafted and editable; the place is left out when the
 * sketch has no location. An optional SketchConnect mark.
 *
 * A phone with the share sheet (Web Share API) gets "Share". Otherwise:
 * download the images, copy the caption, or share the page's link on
 * Facebook. Nothing is ever posted for the sketcher.
 */
export default function SharePanel({ sketch, images, palette, pageUrl, onClose }) {
  const slides = useMemo(() => [
    images.final && { key: 'final', label: 'Final sketch', src: images.final },
    images.reference && { key: 'reference', label: 'Reference', src: images.reference },
    images.reference && sketch.marks?.length > 0 && { key: 'plan', label: 'Plan', src: images.reference, plan: true },
    palette.length > 0 && { key: 'palette', label: 'Palette', palette: true },
  ].filter(Boolean), [images, sketch.marks, palette])

  const city = (sketch.location?.label || '').split(',').pop()?.trim()
  const tools = (sketch.media || []).map(mediaLabel)
  const draft = [
    sketch.title || 'New sketch',
    sketch.location?.label ? `📍 ${sketch.location.label}` : null,
    tools.length ? `With ${tools.join(', ').toLowerCase()}.` : null,
    '',
    ['#urbansketchers', '#sketchconnect', city ? `#usk${slug(city)}` : null].filter(Boolean).join(' '),
    pageUrl,
  ].filter((l) => l !== null).join('\n')

  const [included, setIncluded] = useState(() => new Set(slides.map((s) => s.key)))
  const [caption, setCaption] = useState(draft)
  const [watermark, setWatermark] = useState(true)
  const [busy, setBusy] = useState(null)
  const [note, setNote] = useState(null)

  const toggle = (key) => setIncluded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })

  async function build() {
    const files = []
    const name = slug(sketch.title) || 'sketch'
    for (const [i, s] of slides.filter((x) => included.has(x.key)).entries()) {
      let blob
      if (s.palette) blob = await paletteSlide(sketch.title, palette, readableInk, { watermark })
      else if (s.plan) blob = await planSlide(s.src, sketch.marks, { watermark })
      else blob = await photoSlide(s.src, { watermark })
      files.push(new File([blob], `${name}-${i + 1}-${s.key}.jpg`, { type: 'image/jpeg' }))
    }
    return files
  }

  async function shareSheet() {
    setBusy('share'); setNote(null)
    try {
      const files = await build()
      await navigator.share({ files, text: caption, title: sketch.title || 'Sketch' })
    } catch (err) {
      if (err?.name !== 'AbortError') setNote('Could not open the share sheet. Download the images instead.')
    } finally { setBusy(null) }
  }

  async function downloadAll() {
    setBusy('download'); setNote(null)
    try {
      const files = await build()
      files.forEach((f) => download(f, f.name))
      setNote(`${files.length} images downloaded.`)
    } catch {
      setNote('Could not make the images.')
    } finally { setBusy(null) }
  }

  async function copyCaption() {
    try { await navigator.clipboard.writeText(caption); setNote('Caption copied.') } catch { setNote('Could not copy. Select the caption and copy it.') }
  }

  const facebook = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`
  const sheet = canShareFiles([new File([''], 'x.jpg', { type: 'image/jpeg' })])
  const count = slides.filter((s) => included.has(s.key)).length

  return (
    <FloatPanel placement="modal" title="Share" onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {note && <span className="mr-auto text-sm text-ink/70">{note}</span>}
          {sheet ? (
            <Button variant="editorialSolid" onClick={shareSheet} disabled={!count || busy}>
              <Icon name="share" size={15} /> {busy === 'share' ? 'Preparing…' : 'Share'}
            </Button>
          ) : (
            <>
              <a href={facebook} target="_blank" rel="noopener noreferrer" className="text-sm font-bold underline">Share link on Facebook</a>
              <Button variant="editorial" size="sm" onClick={copyCaption}>Copy caption</Button>
              <Button variant="editorialSolid" size="sm" onClick={downloadAll} disabled={!count || busy}>
                {busy === 'download' ? 'Preparing…' : `Download ${count} images`}
              </Button>
            </>
          )}
        </div>
      }>
      <span className="ed-caption">Carousel · tap to leave an image out</span>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {slides.map((s, i) => {
          const on = included.has(s.key)
          return (
            <button key={s.key} type="button" onClick={() => toggle(s.key)} aria-pressed={on}
              className={`relative w-[104px] shrink-0 text-left ${on ? '' : 'opacity-40'}`}>
              <span className="ed-slide block border border-ink/10">
                {s.src && <img src={s.src} alt="" />}
                {s.palette && (
                  <span className="absolute inset-2 flex flex-col">
                    {palette.map((p) => <span key={p.id} className="flex-1" style={{ background: p.hex }} />)}
                  </span>
                )}
              </span>
              <span className="mt-1 block text-xs font-semibold">{on ? `${i + 1}. ` : ''}{s.label}</span>
            </button>
          )
        })}
      </div>
      <label className="block">
        <span>Caption</span>
        <textarea className="field-input mt-1.5 min-h-[140px]" value={caption} onChange={(e) => setCaption(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} /> Add a small SketchConnect mark
      </label>
    </FloatPanel>
  )
}
