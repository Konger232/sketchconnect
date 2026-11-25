/**
 * How many sketchers are interested in an event (design doc, item 49): a
 * large bold number and, small and grey beside it, "sketchers interested".
 * One look everywhere: the event page beside the I'm interested button, the
 * event card in the grid and on the map, and Explore's event row.
 * Shown from 1 up; nothing at zero.
 */
export default function InterestedCount({ count, className = '' }) {
  const n = Number(count) || 0
  if (n < 1) return null
  return (
    <span className={`flex items-center gap-1.5 ${className}`} aria-label={`${n} ${n === 1 ? 'sketcher' : 'sketchers'} interested`}>
      <span className="font-heading text-2xl font-bold leading-none text-ink">{n}</span>
      <span className="flex flex-col text-3xs leading-tight text-ink/55" aria-hidden="true">
        <span>{n === 1 ? 'sketcher' : 'sketchers'}</span>
        <span>interested</span>
      </span>
    </span>
  )
}
