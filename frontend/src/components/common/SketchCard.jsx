import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Icon from './Icon'
import { useAuth } from './AuthContext'
import { relativeTime } from '../../lib/relativeTime'
import { getSketchStatus } from '../../lib/sketchStatus'
import { api } from '../../lib/api'

// Baked image
const resolveImageUrl = (url) => (url?.startsWith('http') ? url : `${api.defaults.baseURL}${url}`)

// details: the Explore map's pin card. The final sketch, the sketcher's
// name, the description (field notes), the place and the date.
export default function SketchCard({ sketch, details = false }) {
  const images = details && sketch.final_sketch_url
    ? [resolveImageUrl(sketch.final_sketch_url)]
    : sketch.images?.length
    ? sketch.images.map(resolveImageUrl)
    : sketch.reference_image_url ? [resolveImageUrl(sketch.reference_image_url)] : []
  const [index, setIndex] = useState(0)
  const [like, setLike] = useState({ liked: Boolean(sketch.liked), count: sketch.like_count || 0 })
  useEffect(() => { setLike({ liked: Boolean(sketch.liked), count: sketch.like_count || 0 }) }, [sketch.id, sketch.liked, sketch.like_count])
  const { user } = useAuth()
  const navigate = useNavigate()
  const activeImage = images[index % Math.max(images.length, 1)]
  const status = getSketchStatus(sketch)
  const location = useLocation()
  
  // Every sketch opens its SketchDetail page, finished or not (design doc,
  // item 38). Only shared sketches take likes.
  const shared = Boolean(sketch.final_sketch_url)
  const isOwner = Boolean(sketch.is_owner)

  // The heart is a real like (design doc, item 33). Only shared sketches
  // take likes. The owner sees the count. A visitor goes to the login page.
  async function toggleLike(e) {
    e.preventDefault()
    e.stopPropagation()
    if (isOwner) return
    if (!user) return navigate('/login', { state: { from: location.pathname } })
    const before = like
    const next = { liked: !like.liked, count: like.count + (like.liked ? -1 : 1) }
    setLike(next)
    try {
      const { data } = before.liked
        ? await api.delete(`/api/sketches/${sketch.id}/like`)
        : await api.post(`/api/sketches/${sketch.id}/like`)
      setLike({ liked: data.liked, count: data.like_count })
    } catch {
      setLike(before)
    }
  }
  return (
    <Link to={`/sketches/${sketch.id}`} className="flex flex-col text-left">
      <div className="photo-placeholder relative aspect-[4/3] overflow-hidden rounded-[4px]">
        {activeImage && <img src={activeImage} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        {shared && (
          <button
            type="button"
            onClick={toggleLike}
            aria-pressed={like.liked}
            aria-label={isOwner ? `${like.count} likes` : like.liked ? 'Unlike' : 'Like'}
            className={`absolute right-2.5 top-2.5 flex h-[30px] items-center gap-1 rounded-full bg-white/85 px-2 text-xs font-semibold text-ink ${isOwner ? 'cursor-default' : ''}`}
          >
            <Icon name={like.liked ? 'heart-filled' : 'heart'} size={15} className={like.liked ? 'text-[var(--tab-active)]' : ''} />
            {like.count > 0 && <span>{like.count}</span>}
          </button>
        )}
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
      {details && (sketch.owner?.display_name || sketch.owner?.handle) && (
        <div className="pl-2.5 text-xs font-semibold text-ink/80">{sketch.owner.display_name || sketch.owner.handle}</div>
      )}
      {details && sketch.field_notes && <p className="m-0 line-clamp-3 pl-2.5 pt-1 text-xs text-ink/70">{sketch.field_notes}</p>}
      {details && sketch.location?.label && <div className="pl-2.5 pt-1 text-3xs text-ink/60">{sketch.location.label}</div>}
      <div className="pl-2.5 text-3xs text-ink/50">{relativeTime(sketch.created_at)}</div>
    </Link>
  )
}
