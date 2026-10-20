import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import FloatPanel from '../common/FloatPanel'
import { api } from '../../lib/api'
import Avatar from '../common/Avatar'

// Who follows a sketcher, newest first (GET /api/sketchers/{handle}/followers).
export default function FollowersPanel({ handle, onClose }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    api.get(`/api/sketchers/${handle}/followers`).then(({ data }) => setList(data)).catch(() => setList([]))
  }, [handle])

  return (
    <FloatPanel placement="modal" title="Followers" onClose={onClose} width="420px">
      {list === null && <p className="text-sm text-ink/50">Loading…</p>}
      {list?.length === 0 && <p className="text-sm text-ink/50">No followers yet.</p>}
      <ul className="flex flex-col">
        {list?.map((p) => (
          <li key={p.handle}>
            <Link to={`/sketchers/${p.handle}`} onClick={onClose} className="flex items-center gap-3 py-2.5 text-ink no-underline hover:text-ink/70">
              <Avatar url={p.avatar_url} className="h-9 w-9" />
              <span className="flex flex-col">
                <span className="text-base font-semibold">{p.display_name || p.handle}</span>
                <span className="text-xs text-ink/50">@{p.handle}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </FloatPanel>
  )
}
