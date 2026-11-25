import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import FloatPanel from './FloatPanel'
import Avatar from './Avatar'
import { api } from '../../lib/api'

// Every sketcher who is interested in an event (GET /api/events/{id}/attendees).
export default function AttendeesPanel({ eventId, onClose }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    api.get(`/api/events/${eventId}/attendees`).then(({ data: d }) => setData(d)).catch(() => setData({ people: [], total: 0 }))
  }, [eventId])

  return (
    <FloatPanel placement="modal" title="Sketchers who are interested" onClose={onClose} width="420px">
      {data === null && <p className="text-sm text-ink/50">Loading…</p>}
      <ul className="flex flex-col">
        {data?.people.map((p) => (
          <li key={p.username}>
            <Link to={`/sketchers/${p.username}`} onClick={onClose} className="flex items-center gap-3 py-2.5 text-ink no-underline hover:text-ink/70">
              <Avatar url={p.avatar_url} className="h-9 w-9" />
              <span className="flex flex-col">
                <span className="text-base font-semibold">{p.display_name || p.username}</span>
                <span className="text-xs text-ink/50">@{p.username}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </FloatPanel>
  )
}
