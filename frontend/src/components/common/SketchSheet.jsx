import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Avatar from './Avatar'
import Icon from './Icon'
import SketchCard from './SketchCard'
import { useAuth } from './AuthContext'
import { api } from '../../lib/api'
import { imageUrl } from '../../lib/media'
import { relativeTime } from '../../lib/relativeTime'
import { sketchDate } from '../../lib/sketchDate'
import { useSheetDrag } from '../../lib/useSheetDrag'

/**
 * A sketch in a phone's bottom sheet, opened from a map pin (November 14,
 * 2026). Laid out like an Instagram post viewer: the picture fills the
 * sheet; the sketcher's avatar, name and the sketch's title sit over its
 * top; the like and the comments stand on the right; the place and the
 * date at the bottom. A tap on the picture opens the sketch; the comment
 * button opens its comments. The same draggable sheet as Edit Sketch's
 * (.sc-sheet, useSheetDrag): dragged or tapped down, it folds to the
 * compact row. Phones only: on a computer a pin keeps its popup.
 *
 *   sketch   the sketch, as the API returns it
 *   onClose  the close button, or a tap on the map
 */
export default function SketchSheet({ sketch, onClose }) {
  const [open, setOpen] = useState(true)
  const sheet = useSheetDrag(open, setOpen, '.sketch-sheet-head')
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [like, setLike] = useState({ liked: Boolean(sketch.liked), count: sketch.like_count || 0 })
  useEffect(() => { setLike({ liked: Boolean(sketch.liked), count: sketch.like_count || 0 }) }, [sketch.id, sketch.liked, sketch.like_count])

  const src = imageUrl(sketch.final_sketch_url || sketch.reference_image_url)
  const owner = sketch.owner || {}
  const name = owner.display_name?.trim()
  const shared = Boolean(sketch.final_sketch_url)
  const href = `/sketches/${sketch.id}`
  const when = relativeTime(sketchDate(sketch))

  async function toggleLike() {
    if (sketch.is_owner) return
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

  return createPortal(
    <div ref={sheet.ref} style={sheet.style} role="dialog" aria-label={sketch.title || 'Sketch'}
      className={`sc-sheet ${sheet.className} flex flex-col overflow-hidden text-ink max-md:!z-[1200] md:hidden ${
        open ? `bg-black max-md:border-t-0 ${sheet.style ? '' : 'max-md:h-[72dvh] max-md:!max-h-[85dvh]'}` : 'bg-white'}`}>
      {/* Folded: the handle and the compact row. */}
      {!open && (
        <>
          <button type="button" className="sc-sheet-handle touch-none" {...sheet.handleProps}
            aria-label="Show the sketch" aria-expanded={false}>
            <span />
          </button>
          <div className="sketch-sheet-head relative px-4 pb-3">
            <SketchCard sketch={sketch} compact />
          </div>
        </>
      )}

      {open && (
        <div className="relative min-h-0 flex-1">
          {/* The picture fills the sheet; a tap opens the sketch. */}
          <Link to={href} aria-label={`Open ${sketch.title || 'the sketch'}`} className="absolute inset-0 block">
            {src && <img src={src} alt="" className="h-full w-full object-cover" />}
          </Link>
          {/* Shade at the top and bottom, so the white text reads on any picture. */}
          <span className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/70 to-transparent" />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/70 to-transparent" />

          {/* Top: the handle, then the sketcher and the title. */}
          <div className="absolute inset-x-0 top-0 flex flex-col">
            <button type="button" className="sc-sheet-handle touch-none [&>span]:!bg-white/80" {...sheet.handleProps}
              aria-label="Fold the sketch down" aria-expanded>
              <span />
            </button>
            <div className="flex items-start gap-3 px-4 pt-1">
              <Link to={owner.username ? `/sketchers/${owner.username}` : href} className="shrink-0">
                <Avatar url={owner.avatar_url} className="h-10 w-10" />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
                <Link to={owner.username ? `/sketchers/${owner.username}` : href} className="truncate text-base text-white no-underline">
                  {name && <span className="font-semibold">{name} </span>}
                  {owner.username && <span className="text-white/80">@{owner.username}</span>}
                </Link>
                <Link to={href} className="font-heading text-xl font-semibold leading-snug text-white no-underline">
                  {sketch.title || 'Untitled sketch'}
                </Link>
              </div>
              <button type="button" onClick={onClose} aria-label="Close"
                className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15">
                <Icon name="close" size={18} />
              </button>
            </div>
          </div>

          {/* Right: the like and the comments, one above the other. */}
          {shared && (
            <div className="absolute bottom-16 right-3 flex flex-col items-center gap-5 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
              <button type="button" onClick={toggleLike} aria-pressed={like.liked}
                aria-label={sketch.is_owner ? `${like.count} likes` : like.liked ? 'Unlike' : 'Like'}
                className={`flex flex-col items-center gap-1 ${sketch.is_owner ? 'cursor-default' : ''}`}>
                <Icon name={like.liked ? 'heart-filled' : 'heart'} size={28} className={like.liked ? 'text-[var(--tab-active)]' : ''} />
                <span className="text-sm font-semibold">{like.count}</span>
              </button>
              <Link to={`${href}#comments`} aria-label="Comments" className="flex flex-col items-center gap-1 text-white no-underline">
                <Icon name="comment" size={28} />
                <span className="text-sm font-semibold">{sketch.comment_count || 0}</span>
              </Link>
            </div>
          )}

          {/* Bottom: where and when. */}
          {(sketch.location?.label || when) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 px-4 pb-4 pr-16 text-sm text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
              {sketch.location?.label && <Icon name="location" size={14} className="shrink-0" />}
              <span className="truncate">{[sketch.location?.label, when].filter(Boolean).join(' · ')}</span>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  )
}
