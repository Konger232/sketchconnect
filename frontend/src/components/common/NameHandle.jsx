/**
 * A sketcher where there is room for both: the name, then the @username in
 * grey (the sketch page, the event page). Lists use handle() from
 * lib/people.js alone. With no name, just the @username.
 */
export default function NameHandle({ person, className = '' }) {
  if (!person) return null
  const name = person.display_name?.trim()
  if (!name) return <span className={`font-semibold ${className}`}>@{person.username}</span>
  return (
    <span className={className}>
      <span className="font-semibold">{name}</span>{' '}
      <span className="font-normal text-ink/55">@{person.username}</span>
    </span>
  )
}
