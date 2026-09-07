import { useState } from 'react'
import { Link } from 'react-router-dom'
import { sceneTypeLabel, STYLES } from '../../data/styles'
import { relativeTime } from '../../lib/relativeTime'
import { api } from '../../lib/api'

// Same pattern already used on SketchFlowPage.jsx and SketchDetailPage.jsx:
// reference_image_url is a relative "/uploads/..." path from FastAPI, not
// the Vite dev server, so it needs the API's own origin prefixed -- without
// this it resolves against the frontend's origin instead and 404s.
const resolveImageUrl = (url) => (url?.startsWith('http') ? url : `${api.defaults.baseURL}${url}`)

const styleLabel = (value) => STYLES.find((s) => s.value === value)?.label || value

/**
 * Ported directly from SketchConnect_ClaudeDesign/SketchCard.dc.html:
 * photo tile (with a multi-photo dot indicator), CSS-drawn pin marker next
 * to the location, a 500-word read-more/show-less toggle on the
 * description, and pill-style tags — all using the shared base.css
 * classes (.sc-pin, .sc-tag, .sc-photo-placeholder, .sc-dots/.sc-dot)
 * rather than one-off Tailwind approximations.
 *
 * The backend's Sketch model only stores one reference_image_url today
 * (no images[] array), so the dot carousel simply never appears for real
 * data — it activates automatically once a sketch has more than one photo.
 */
export default function SketchCard({ sketch }) {
  const images = sketch.images?.length
    ? sketch.images.map(resolveImageUrl)
    : sketch.reference_image_url ? [resolveImageUrl(sketch.reference_image_url)] : []
  const [index, setIndex] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const activeImage = images[index % Math.max(images.length, 1)]

  const description = sketch.critique || ''
  const words = description.trim().split(/\s+/).filter(Boolean)
  const isTruncated = !expanded && words.length > 500
  const showLess = expanded && words.length > 500
  const descriptionShown = isTruncated ? words.slice(0, 500).join(' ') + '…' : description

  const tags = [sketch.style && styleLabel(sketch.style), sketch.scene_type && sceneTypeLabel[sketch.scene_type]].filter(Boolean)

  return (
    <div className="flex flex-wrap gap-4 border-b pb-6 sm:flex-nowrap sm:gap-6" style={{ borderColor: 'var(--sc-border-card)' }}>
      <Link
        to={`/sketches/${sketch.id}`}
        className="sc-photo-placeholder relative aspect-square w-full shrink-0 overflow-hidden rounded-[14px] sm:w-[260px]"
      >
        {activeImage && (
          <img src={activeImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        {images.length > 1 && (
          <div className="sc-dots">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => { e.preventDefault(); setIndex(i) }}
                aria-label="Show image"
                className="sc-dot"
                style={{ background: i === index ? 'var(--sc-ink)' : '#ccc' }}
              />
            ))}
          </div>
        )}
      </Link>

      <div className="flex min-w-[200px] flex-1 flex-col">
        <h3 className="mb-1 font-heading text-[19px] font-bold text-ink sm:text-[21px]">
          {sketch.title || 'Untitled sketch'}
        </h3>
        {sketch.location && (
          <div className="mb-0.5 flex items-center gap-1.5 text-sm" style={{ color: 'var(--sc-text-muted)' }}>
            <span className="sc-pin" aria-hidden="true" />
            {/* No reverse-geocoding yet (design doc gap, flagged separately) —
                showing the coordinates themselves rather than a fabricated place name. */}
            {sketch.location.lat.toFixed(4)}, {sketch.location.lon.toFixed(4)}
          </div>
        )}
        <div className="mb-3 ml-[5px] text-[13px]" style={{ color: 'var(--sc-text-faint-3)' }}>
          {relativeTime(sketch.created_at)}
        </div>
        {description && (
          <p className="mb-4 font-sans text-base leading-relaxed" style={{ color: 'var(--sc-text-muted)' }}>
            {descriptionShown}
            {isTruncated && (
              <a href="#" onClick={(e) => { e.preventDefault(); setExpanded(true) }} className="ml-1.5 whitespace-nowrap">
                Read more...
              </a>
            )}
            {showLess && (
              <>
                {' '}
                <a href="#" onClick={(e) => { e.preventDefault(); setExpanded(false) }} className="whitespace-nowrap">
                  Show less
                </a>
              </>
            )}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2.5">
          {tags.map((tag) => (
            <span key={tag} className="sc-tag">{tag}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
