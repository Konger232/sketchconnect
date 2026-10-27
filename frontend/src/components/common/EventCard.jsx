import { Link } from 'react-router-dom'
import Icon from './Icon'
import { imageUrl } from '../../lib/media'
import { FORMATS, eventWhen } from '../../lib/events'

/**
 * An event in a list (design doc, item 49): its cover (or its type on a
 * plain block), the title, when in its own time zone, the place, and how
 * many are interested. Used on the Events page, Home and the Sketcher page.
 *
 *   event   as the API returns it      note   a line on top ("Teaching: Lena")
 */
export default function EventCard({ event: e, note }) {
  const past = new Date(e.ends_at) < new Date()
  return (
    <Link to={`/events/${e.id}`} className="group flex flex-col gap-2 text-ink no-underline">
      <span className="relative block aspect-[16/9] overflow-hidden rounded-md bg-[var(--ed-field-bg)]">
        {e.cover_image_url
          ? <img src={imageUrl(e.cover_image_url)} alt="" loading="lazy" className="h-full w-full object-cover" />
          : <span className="flex h-full w-full items-center justify-center font-heading text-lg font-semibold text-ink/40">#{e.hashtag}</span>}
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-3xs font-medium text-white">
          {past ? 'Past' : FORMATS[e.format] || 'Event'}
        </span>
      </span>
      {note && <span className="ed-caption">{note}</span>}
      <span className="font-heading text-lg font-medium leading-snug group-hover:text-ink/70">{e.title}</span>
      <span className="-mt-1 flex flex-col gap-0.5 text-sm text-ink/70">
        <span>{eventWhen(e)}</span>
        <span className="truncate">{e.place_name}</span>
        {e.interested_count > 0 && (
          <span className="flex items-center gap-1 text-xs text-ink/55"><Icon name="star" size={12} /> {e.interested_count} interested</span>
        )}
      </span>
    </Link>
  )
}
