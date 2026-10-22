import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Icon from './Icon'
import { useAuth } from './AuthContext'
import { relativeTime } from '../../lib/relativeTime'
import { getSketchStatus } from '../../lib/sketchStatus'
import { imageUrl } from '../../lib/media'
import { api } from '../../lib/api'

export const RATIOS = { square: '1 / 1', portrait: '4 / 5' }

/**
 * A sketch card, in the SketchListMapView style (design handoff): a 4:5
 * image with the status (top left) and the like (top right) over it, a
 * caption, and the title. Used by SketchListMapView's grid, Home, and the
 * Explore map's pin popup.
 *
 *   sketch     the sketch, as the API returns it
 *   meta       the caption; default: the sketcher's name and the place
 *   href, linkState   where the card goes (default: its SketchDetail page)
 *   image      the picture; default: the final sketch, else the reference
 *   multi      more than one image (a stack icon)
 *   ratio      'square' | 'portrait' (4:5), the image shape
 *   details    the Explore popup: also the sketcher, the field notes, the
 *              place and the date
 */
export default function SketchCard({ sketch, meta, href, linkState, image, multi = false, details = false, ratio = 'square' }) {
  const [like, setLike] = useState({ liked: Boolean(sketch.liked), count: sketch.like_count || 0 })
  useEffect(() => { setLike({ liked: Boolean(sketch.liked), count: sketch.like_count || 0 }) }, [sketch.id, sketch.liked, sketch.like_count])
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const src = image || imageUrl(sketch.final_sketch_url || sketch.reference_image_url)
  const owner = sketch.owner?.display_name || sketch.owner?.username
  const caption = meta ?? (details ? null : [owner, sketch.location?.label].filter(Boolean).join(' · '))
  // Only shared sketches take likes (design doc, item 33). The owner sees
  // the count; a visitor goes to the login page.
  const shared = Boolean(sketch.final_sketch_url)
  const isOwner = Boolean(sketch.is_owner)

  async function toggleLike(e) {
    e.preventDefault()
    e.stopPropagation()
    if (isOwner) return
    if (!user) return navigate('/login', { state: { from: location.pathname } })
    const before = like
    setLike({ liked: !like.liked, count: like.count + (like.liked ? -1 : 1) })
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
    <Link to={href || `/sketches/${sketch.id}`} state={linkState} className="group flex flex-col gap-2 text-ink no-underline">
      <span className="ed-slide" style={{ aspectRatio: RATIOS[ratio] || RATIOS.square }}>
        {src && <img src={src} alt="" loading="lazy" />}
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-3xs font-medium text-white">
          {getSketchStatus(sketch)}
        </span>
        {shared && (
          <button type="button" onClick={toggleLike} aria-pressed={like.liked}
            aria-label={isOwner ? `${like.count} likes` : like.liked ? 'Unlike' : 'Like'}
            className={`absolute right-2 top-2 flex h-7 items-center gap-1 rounded-full bg-white/85 px-2 text-xs font-semibold text-ink ${isOwner ? 'cursor-default' : ''}`}>
            <Icon name={like.liked ? 'heart-filled' : 'heart'} size={14} className={like.liked ? 'text-[var(--tab-active)]' : ''} />
            {like.count > 0 && <span>{like.count}</span>}
          </button>
        )}
        {/* Glazed by the sketcher, and who can see it when not everyone. */}
        {(sketch.glazed || (shared && sketch.visibility && sketch.visibility !== 'members')) && (
          <span className="absolute bottom-2 left-2 flex gap-1">
            {sketch.glazed && <span className="rounded-full bg-black/60 px-2 py-0.5 text-3xs font-medium text-white">Glazed</span>}
            {shared && sketch.visibility === 'followers' && <span className="rounded-full bg-black/60 px-2 py-0.5 text-3xs font-medium text-white">Followers</span>}
            {shared && sketch.visibility === 'private' && <span className="rounded-full bg-black/60 px-2 py-0.5 text-3xs font-medium text-white">Only me</span>}
          </span>
        )}
        {multi && (
          <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-ink" aria-label="More than one image">
            <Icon name="stack" size={15} />
          </span>
        )}
      </span>
      {caption && <span className="ed-caption">{caption}</span>}
      <span className="-mt-1 font-heading text-lg font-medium leading-snug group-hover:text-ink/70">{sketch.title || 'Untitled sketch'}</span>
      {details && (
        <span className="-mt-1 flex flex-col gap-1">
          {owner && <span className="text-sm font-semibold text-ink/80">{owner}</span>}
          {sketch.field_notes && <span className="line-clamp-3 text-sm text-ink/70">{sketch.field_notes}</span>}
          <span className="text-xs text-ink/60">{[sketch.location?.label, relativeTime(sketch.created_at)].filter(Boolean).join(' · ')}</span>
        </span>
      )}
    </Link>
  )
}
