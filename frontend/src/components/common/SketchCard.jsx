import { useState } from 'react'
import { Link } from 'react-router-dom'
import { relativeTime } from '../../lib/relativeTime'
import { api } from '../../lib/api'

// Same pattern already used on SketchFlowPage.jsx and SketchDetailPage.jsx:
// reference_image_url is a relative "/uploads/..." path from FastAPI, not
// the Vite dev server, so it needs the API's own origin prefixed -- without
// this it resolves against the frontend's origin instead and 404s.
const resolveImageUrl = (url) => (url?.startsWith('http') ? url : `${api.defaults.baseURL}${url}`)

/**
 * Merged replacement for the old SpotCard.jsx + SketchCard.jsx split --
 * both existed only because SpotCard's compact grid-tile layout (the one
 * actually used on both Home feeds) never got wired to real API data or a
 * click-through, while SketchCard's data-wiring/dot-carousel logic lived
 * in a fuller row layout nothing currently used. This keeps SpotCard's
 * simple tile (photo, heart-save, title, location/time beneath) and
 * SketchCard's real-data plumbing: resolving reference_image_url/images[]
 * against the API's own origin, and now a real Link to the detail page
 * instead of the dead onClick both cards used to take.
 *
 * The heart/save toggle is local UI state only -- there's no favorites
 * endpoint yet, so it doesn't persist across a reload. Left in since it
 * was part of the original Claude Design import; flag if that's confusing
 * rather than decorative.
 */
export default function SketchCard({ sketch }) {
  const images = sketch.images?.length
    ? sketch.images.map(resolveImageUrl)
    : sketch.reference_image_url ? [resolveImageUrl(sketch.reference_image_url)] : []
  const [index, setIndex] = useState(0)
  const [liked, setLiked] = useState(false)
  const activeImage = images[index % Math.max(images.length, 1)]

  return (
    <Link to={`/sketches/${sketch.id}`} className="flex flex-col text-left">
      <div className="photo-placeholder relative aspect-[4/3] overflow-hidden rounded-[4px]">
        {activeImage && <img src={activeImage} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLiked((f) => !f) }}
          aria-label="Save"
          className="absolute right-2.5 top-2.5 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white/85 text-[15px]"
        >
          {liked ? '♥' : '♡'}
        </span>
        {images.length > 1 && (
          <div className="photo-dots">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIndex(i) }}
                aria-label="Show image"
                className="photo-dot"
                style={{ background: i === index ? '#111111' : '#ccc' }}
              />
            ))}
          </div>
        )}
      </div>
      <div className="mt-2.5 pl-2.5 font-heading text-[17px] font-bold text-ink">
        {sketch.title || 'Untitled sketch'}
      </div>
      <div className="pl-2.5 text-sm text-ink/50">{relativeTime(sketch.created_at)}</div>
    </Link>
  )
}
