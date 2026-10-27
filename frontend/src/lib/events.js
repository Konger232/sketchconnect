// Events (design doc, item 49): small helpers shared by the event pages.

// The event's dates in its own time zone: "Sat 1 Nov, 9:00 – 12:00 (Lisbon)"
// or, over several days, "12 – 15 Mar 2027 (Singapore)".
export function eventWhen(e) {
  if (!e?.starts_at) return ''
  const tz = e.time_zone || 'UTC'
  const a = new Date(e.starts_at), b = new Date(e.ends_at || e.starts_at)
  const day = (d, o) => new Intl.DateTimeFormat(undefined, { timeZone: tz, ...o }).format(d)
  const sameDay = day(a, { year: 'numeric', month: 'numeric', day: 'numeric' }) === day(b, { year: 'numeric', month: 'numeric', day: 'numeric' })
  const city = tz.includes('/') ? tz.split('/').pop().replace(/_/g, ' ') : tz
  if (sameDay) {
    return `${day(a, { weekday: 'short', day: 'numeric', month: 'short' })}, ${day(a, { hour: 'numeric', minute: '2-digit' })} – ${day(b, { hour: 'numeric', minute: '2-digit' })} (${city})`
  }
  return `${day(a, { day: 'numeric', month: 'short' })} – ${day(b, { day: 'numeric', month: 'short', year: 'numeric' })} (${city})`
}

export const EVENT_TYPES = { crawl: 'Sketch crawl', workshop: 'Workshop', symposium: 'Symposium', festival: 'Festival' }

// A hashtag from a title: "Saturday tram crawl" -> "SaturdayTramCrawl".
export const hashtagFrom = (title) => (title || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^A-Za-z0-9]+/).filter(Boolean)
  .map((w) => w[0].toUpperCase() + w.slice(1)).join('').slice(0, 40)

// <input type="datetime-local"> value for a Date, in the browser's time.
export const localInput = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
