import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { relativeTime } from '../../lib/relativeTime'
import { getSketchStatus } from '../../lib/sketchStatus'
import { api } from '../../lib/api'

// Baked image
const resolveImageUrl = (url) => (url?.startsWith('http') ? url : `${api.defaults.baseURL}${url}`)

export default function SketchCard({ sketch }) {
  const images = sketch.images?.length
    ? sketch.images.map(resolveImageUrl)
    : sketch.reference_image_url ? [resolveImageUrl(sketch.reference_image_url)] : []
  const [index, setIndex] = useState(0)
  const [liked, setLiked] = useState(false)
  const activeImage = images[index % Math.max(images.length, 1)]
  const status = getSketchStatus(sketch)
  const location = useLocation()
  
  const sketchLinkState = { backgroundLocation: location }

  return (
    <Link to={`/sketches/${sketch.id}`} state={sketchLinkState} className="flex flex-col text-left">
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
        <span className="absolute left-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-3xs font-medium text-white">
          {status}
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
      <div className="mt-2.5 pl-2.5 font-heading text-base font-bold text-ink">
        {sketch.title || 'Untitled sketch'}
      </div>
      <div className="pl-2.5 text-3xs text-ink/50">{relativeTime(sketch.created_at)}</div>
    </Link>
  )
}
