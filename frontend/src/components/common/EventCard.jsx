import { Link } from 'react-router-dom'
import Icon from './Icon'
import { imageUrl } from '../../lib/media'
import { FORMATS, eventDay, eventWhen } from '../../lib/events'

/**
 * An event in a list (design doc, item 49): its cover (or its type on a
 * plain block), the title, when in its own time zone, the place, and how
 * many are interested. Used on the Events page, Home and the Sketcher page.
 *
 *   event   as the API returns it      note   a line on top ("Teaching: Lena")
 */
export default function EventCard({ event: e, note, compact = false, selected = false, onSelect }) {
  const past = new Date(e.ends_at) < new Date()
  // Who runs it: the organisation when there is one, else the sketcher's @username.
  const by = e.org_name || (e.organizer?.username ? `@${e.organizer.username}` : null)
  // compact: a row for Explore's list, with the date tile the map pin uses.
  if (compact) {
    const { day, month } = eventDay(e)
    return (
      <Link to={`/events/${e.id}`} onClick={(ev) => { if (onSelect && !selected) { ev.preventDefault(); onSelect(e) } }}
        className={`group flex items-center gap-3 rounded-lg border px-3 py-2.5 text-ink no-underline ${selected ? 'border-[var(--tab-active)] ring-1 ring-[var(--tab-active)]' : 'border-ink/10 hover:border-ink/40'}`}>
        <span className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-md ${past ? 'bg-ink/40' : 'bg-ink'} text-white`}>
          <span className="font-heading text-xl font-semibold leading-none">{day}</span>
          <span className="text-3xs uppercase tracking-wider">{month}</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-heading text-base font-medium leading-snug">{e.title}</span>
          <span className="truncate text-xs text-ink/65">{e.place_name}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink/65">
            <span className="shrink-0 rounded-full bg-black/60 px-2 py-0.5 text-3xs font-medium text-white">{past ? 'Past' : FORMATS[e.format] || 'Event'}</span>
            <span className="truncate">{eventWhen(e)}</span>
          </span>
          {by && <span className="truncate text-xs text-ink/65">By {by}</span>}
        </span>
      </Link>
    )
  }
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
        {by && <span className="truncate">By {by}</span>}
        {e.interested_count > 0 && (
          <span className="flex items-center gap-1 text-xs text-ink/55"><Icon name="star" size={12} /> {e.interested_count} interested</span>
        )}
      </span>
    </Link>
  )
}
