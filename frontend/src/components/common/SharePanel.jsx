import { useEffect, useMemo, useState } from 'react'
import Button from './Button'
import FloatPanel from './FloatPanel'
import Icon from './Icon'
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
  // Final, the progress shots in order, reference, plan, palette: up to 10,
  // Instagram's limit for one post (progress shots give way first).
  const slides = useMemo(() => {
    const fixed = [
      images.reference && { key: 'reference', label: 'Reference', src: images.reference },
      images.reference && sketch.marks?.length > 0 && { key: 'plan', label: 'Plan', src: images.reference, plan: true },
      palette.length > 0 && { key: 'palette', label: 'Palette', palette: true },
    ].filter(Boolean)
    const head = images.final ? [{ key: 'final', label: 'Final sketch', src: images.final }] : []
    const room = 10 - head.length - fixed.length
    const progress = (images.progress || []).slice(0, Math.max(0, room))
      .map((src, i) => ({ key: `progress-${i}`, label: `In progress ${i + 1}`, src }))
    return [...head, ...progress, ...fixed]
  }, [images, sketch.marks, palette])

  // The city as Explore groups it (Pak Kret -> Bangkok), for #usk<city>.
  const city = sketch.place || (sketch.location?.label || '').split(',').pop()?.trim()
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
  // The images, made as soon as the panel opens (and again when the set
  // changes): a phone opens its share sheet only straight after a tap, too
  // soon to draw them then.
  const [files, setFiles] = useState(null) // null while making them
  const [failed, setFailed] = useState(null)

  const toggle = (key) => setIncluded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })

  useEffect(() => {
    let live = true
    setFiles(null)
    setFailed(null)
    const timer = setTimeout(async () => {
      const out = []
      const name = slug(sketch.title) || 'sketch'
      for (const [i, s] of slides.filter((x) => included.has(x.key)).entries()) {
        try {
          let blob
          if (s.palette) blob = await paletteSlide(sketch.title, palette, readableInk, { watermark })
          else if (s.plan) blob = await planSlide(s.src, sketch.marks, { watermark })
          else blob = await photoSlide(s.src, { watermark })
          out.push(new File([blob], `${name}-${i + 1}-${s.key}.jpg`, { type: 'image/jpeg' }))
        } catch {
          if (live) setFailed(s.label)
        }
      }
      if (live) setFiles(out)
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [slides, included, watermark]) // eslint-disable-line react-hooks/exhaustive-deps

  // The caption goes to the clipboard: Instagram and Facebook drop text
  // that comes with shared images, so the sketcher pastes it there.
  function copyQuietly() {
    return navigator.clipboard?.writeText(caption).then(() => true, () => false) ?? Promise.resolve(false)
  }

  // Phone (and browsers with a share sheet): one tap copies the caption and
  // opens the sheet with the images. Where that fails, download instead.
  async function shareSheet() {
    if (!files?.length) return
    setNote(null)
    const copied = copyQuietly() // started in the tap, not awaited first
    try {
      await navigator.share({ files, title: sketch.title || 'Sketch' })
      setNote((await copied) ? 'Caption copied: paste it into your post.' : 'Copy the caption below into your post.')
    } catch (err) {
      if (err?.name === 'AbortError') return
      await downloadAndCopy()
    }
  }

  // A computer: one click downloads the images and copies the caption.
  async function downloadAndCopy() {
    if (!files?.length) return
    setBusy('download')
    files.forEach((f) => download(f, f.name))
    const copied = await copyQuietly()
    setNote(`${files.length} ${files.length === 1 ? 'image' : 'images'} downloaded. ${copied ? 'Caption copied: paste it into your post.' : 'Copy the caption below.'}`)
    setBusy(null)
  }

  async function copyCaption() {
    try { await navigator.clipboard.writeText(caption); setNote('Caption copied.') } catch { setNote('Could not copy. Select the caption and copy it.') }
  }

  const facebook = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`
  // The share sheet only on a phone or tablet; a computer downloads.
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  const sheet = touch && canShareFiles([new File([''], 'x.jpg', { type: 'image/jpeg' })])
  const count = slides.filter((s) => included.has(s.key)).length
  const ready = Boolean(files?.length)

  return (
    <FloatPanel placement="modal" title="Share" onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {(note || failed) && <span className="mr-auto text-sm text-ink/70">{note || `Could not prepare ${failed}; it is left out.`}</span>}
          <a href={facebook} target="_blank" rel="noopener noreferrer" className="text-sm font-bold underline">Share link on Facebook</a>
          <Button variant="editorial" size="sm" onClick={copyCaption}>Copy caption</Button>
          {sheet ? (
            <Button variant="editorialSolid" onClick={shareSheet} disabled={!count || !ready}>
              <Icon name="share" size={15} /> {ready ? 'Share' : 'Preparing…'}
            </Button>
          ) : (
            <Button variant="editorialSolid" size="sm" onClick={downloadAndCopy} disabled={!count || !ready || busy}>
              {!ready ? 'Preparing…' : `Download ${files.length} ${files.length === 1 ? 'image' : 'images'} and copy caption`}
            </Button>
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
