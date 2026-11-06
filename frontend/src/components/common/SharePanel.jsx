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
 * First: Instagram or Facebook (November 6, 2026), since they differ.
 *   Instagram  the images; a caption with hashtags and no link (links in
 *              Instagram captions can't be tapped)
 *   Facebook   the images, or just a link to the sketch's page; a caption
 *              with the link and fewer hashtags
 * A phone opens its share sheet (Web Share API) with the images; a computer
 * downloads them. The caption always goes to the clipboard: both apps drop
 * text that comes with shared images. Nothing is ever posted for the
 * sketcher.
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
  const about = [
    sketch.title || 'New sketch',
    sketch.location?.label ? `📍 ${sketch.location.label}` : null,
    tools.length ? `With ${tools.join(', ').toLowerCase()}.` : null,
  ].filter(Boolean)
  const cityTag = city ? `#usk${slug(city)}` : null
  const captionFor = (to) => (to === 'instagram'
    ? [...about, '', ['#urbansketchers', '#usk', cityTag, '#sketchconnect'].filter(Boolean).join(' ')]
    : [...about, '', `See how it was made on SketchConnect: ${pageUrl}`, '', ['#urbansketchers', cityTag].filter(Boolean).join(' ')]
  ).join('\n')

  const [included, setIncluded] = useState(() => new Set(slides.map((s) => s.key)))
  const [to, setTo] = useState(null) // 'instagram' | 'facebook', asked first
  const [fbMode, setFbMode] = useState('photos') // Facebook: 'photos' | 'link'
  const [caption, setCaption] = useState('')
  function choose(next) {
    setTo(next)
    setCaption(captionFor(next))
    setNote(null)
  }
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
      await saveAndOpen()
    }
  }

  // A computer: one click copies the caption, saves the images and opens
  // the app in a new tab. Everything starts inside the click, so the
  // browser allows the new tab and the clipboard.
  async function saveAndOpen() {
    if (!files?.length) return
    setBusy('download')
    const copied = copyQuietly()
    files.forEach((f) => download(f, f.name))
    window.open(site, '_blank', 'noopener')
    const n = `${files.length} ${files.length === 1 ? 'image' : 'images'}`
    setNote(`${n} saved to Downloads. ${(await copied) ? 'Caption copied: paste it into your post.' : 'Copy the caption below.'}`)
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
  const name = to === 'instagram' ? 'Instagram' : 'Facebook'
  const site = to === 'instagram' ? 'https://www.instagram.com/' : 'https://www.facebook.com/'
  const photos = to === 'instagram' || fbMode === 'photos'

  // Facebook's link share: copy the caption first (Facebook drops text sent
  // with a link), then its own share window.
  async function shareLink() {
    const copied = await copyQuietly()
    window.open(facebook, '_blank', 'noopener,width=640,height=560')
    setNote(copied ? 'Caption copied: paste it above the link.' : 'Copy the caption below.')
  }

  const footer = !to ? null : (
    <div className="flex w-full flex-wrap items-center justify-end gap-2">
      {(note || failed) && <span className="mr-auto text-sm text-ink/70">{note || `Could not prepare ${failed}; it is left out.`}</span>}
      {!photos ? (
        <Button variant="editorialSolid" size="sm" onClick={shareLink}><Icon name="share" size={14} /> Copy caption and open Facebook</Button>
      ) : (
        <Button variant="editorialSolid" size="sm" onClick={sheet ? shareSheet : saveAndOpen} disabled={!count || !ready || busy}>
          <Icon name="share" size={14} /> {!ready ? 'Preparing…' : sheet ? `Share to ${name}` : `Save ${files.length} ${files.length === 1 ? 'image' : 'images'} and open ${name}`}
        </Button>
      )}
    </div>
  )

  return (
    <FloatPanel placement="modal" title={to ? `Share to ${name}` : 'Share'} onClose={onClose} footer={footer}>
      {/* ---- First: where to ---- */}
      {!to && (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm text-ink/70">Where do you want to share it?</p>
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ['instagram', 'Instagram', 'A carousel of up to 10 images: the final sketch, your progress, the reference, the plan and the palette. A caption with hashtags.'],
              ['facebook', 'Facebook', 'The same images, or just a link to this sketch on SketchConnect. A caption with the link.'],
            ].map(([key, title, text]) => (
              <button key={key} type="button" onClick={() => choose(key)}
                className="flex flex-col gap-1.5 rounded-lg border-[1.5px] border-ink/20 p-4 text-left hover:border-ink">
                <span className="font-heading text-lg font-semibold">{title}</span>
                <span className="text-sm text-ink/70">{text}</span>
              </button>
            ))}
          </div>
          <p className="m-0 text-xs text-ink/55">Nothing is posted for you. SketchConnect gets the images and the caption ready; you post them.</p>
        </div>
      )}

      {to && (
        <>
          <button type="button" className="self-start text-xs font-semibold underline" onClick={() => { setTo(null); setNote(null) }}>
            ← Instagram or Facebook
          </button>

          {to === 'facebook' && (
            <div className="flex gap-2" role="radiogroup" aria-label="What to share">
              {[['photos', 'Post the images'], ['link', 'Share a link']].map(([key, label]) => (
                <button key={key} type="button" role="radio" aria-checked={fbMode === key} onClick={() => { setFbMode(key); setNote(null) }}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${fbMode === key ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white text-ink hover:border-ink'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {photos && (
            <>
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
            </>
          )}
          {!photos && (
            <p className="m-0 text-sm text-ink/70">
              Facebook shows a link to this sketch's page. The preview picture and title appear once SketchConnect is online at a public address.
            </p>
          )}

          <label className="block">
            <span className="flex items-baseline justify-between">
              <span>Caption</span>
              <button type="button" className="text-xs font-bold underline" onClick={copyCaption}>Copy</button>
            </span>
            <textarea className="field-input mt-1.5 min-h-[140px]" value={caption} onChange={(e) => setCaption(e.target.value)} />
          </label>
          <p className="-mt-2 m-0 text-xs text-ink/55">
            {photos
              ? sheet ? `Pick ${name} in your phone's share list, then paste the caption: it is copied for you.` : `The button copies the caption, saves the images and opens ${name}. Start a new post there with the saved images and paste the caption.`
              : 'The button copies the caption and opens Facebook. Paste the caption above the link.'}
          </p>
          {photos && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} /> Add a small SketchConnect mark
            </label>
          )}
        </>
      )}
    </FloatPanel>
  )
}
