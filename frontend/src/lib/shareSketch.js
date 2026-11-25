// One-tap sharing (November 16, 2026): what the Facebook and Instagram
// buttons (ShareButtons.jsx) post. Nothing is posted for the sketcher.
//
//   Facebook   copies the caption, then opens Facebook's share page in a
//              new tab (full size, and Facebook stays there after Post);
//              the link's card shows the picture (backend
//              share/router.py), so no image is needed.
//   Instagram  copies the caption, then the images: a phone's share sheet,
//              or on a computer they're saved and instagram.com opens.
//              Instagram feed posts start from pictures and drop text sent
//              with them, so the caption is pasted.
import { readableInk } from './color'
import { canShareFiles, download, paletteSlide, photoSlide, planSlide } from './shareCarousel'

const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

// A sketch's captions. Instagram: hashtags, no link (links in captions can't
// be tapped). Facebook: the link, fewer hashtags.
export function sketchCaptions(sketch, link) {
  // The city as Explore groups it (Pak Kret -> Bangkok), for #usk<city>.
  // Inside the sketcher's home area: no place at all (November 25, 2026).
  const home = Boolean(sketch.location_hidden)
  const city = home ? null : sketch.place || (sketch.location?.label || '').split(',').pop()?.trim()
  const cityTag = city ? `#usk${slug(city)}` : null
  const about = [
    sketch.title || 'New sketch',
    !home && sketch.location?.label ? `📍 ${sketch.location.label}` : null,
    sketch.scene?.summary ? `\n${sketch.scene.summary.trim()}` : null,
  ].filter(Boolean)
  return {
    instagram: [...about, '', ['#urbansketchers', '#usk', cityTag, '#sketchconnect'].filter(Boolean).join(' ')].join('\n'),
    facebook: [...about, '', ['#urbansketchers', cityTag].filter(Boolean).join(' ')].join('\n'),
    link,
  }
}

// The Instagram carousel, up to 10 images (Instagram's limit): the final,
// the progress sketches, the reference, the plan, the palette. Progress
// sketches give way first. Each with the small SketchConnect mark.
export async function sketchCarousel(sketch, images, palette = []) {
  const fixed = [
    images.reference && { key: 'reference', src: images.reference },
    images.reference && sketch.marks?.length > 0 && { key: 'plan', src: images.reference, plan: true },
    palette.length > 0 && { key: 'palette', palette: true },
  ].filter(Boolean)
  const head = images.final ? [{ key: 'final', src: images.final }] : []
  const room = 10 - head.length - fixed.length
  const progress = (images.progress || []).slice(0, Math.max(0, room)).map((src, i) => ({ key: `progress-${i + 1}`, src }))
  const name = slug(sketch.title) || 'sketch'
  const out = []
  for (const [i, s] of [...head, ...progress, ...fixed].entries()) {
    try {
      const blob = s.palette ? await paletteSlide(sketch.title, palette, readableInk, { watermark: true })
        : s.plan ? await planSlide(s.src, sketch.marks, { watermark: true })
        : await photoSlide(s.src, { watermark: true })
      out.push(new File([blob], `${name}-${i + 1}-${s.key}.jpg`, { type: 'image/jpeg' }))
    } catch { /* an image that won't load is left out */ }
  }
  return out
}

const copy = (text) => navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false)

// Facebook: the caption copied, then the share page in a new tab (opened
// inside the click, so the browser allows it).
export function shareToFacebook(link, caption) {
  const copied = copy(caption)
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`, '_blank', 'noopener')
  return copied
}

// A phone or tablet with a share sheet for images.
export const phone = () => window.matchMedia?.('(pointer: coarse)').matches && canShareFiles([new File([''], 'x.jpg', { type: 'image/jpeg' })])

// Instagram: the caption copied, then the images. Returns what happened,
// for the one-line note under the buttons.
export async function shareToInstagram(files, caption, title) {
  const copied = copy(caption)
  if (phone()) {
    try {
      await navigator.share({ files, title: title || 'Sketch' })
      return (await copied) ? 'Caption copied: paste it in your post.' : 'Paste your caption in the post.'
    } catch (err) {
      if (err?.name === 'AbortError') return null
    }
  }
  files.forEach((f) => download(f, f.name))
  window.open('https://www.instagram.com/', '_blank', 'noopener')
  const n = `${files.length} ${files.length === 1 ? 'image' : 'images'}`
  return `${n} saved to your Downloads folder. ${(await copied) ? 'Caption copied: paste it in your post.' : ''}`.trim()
}
