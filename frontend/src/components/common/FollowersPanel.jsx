import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import FloatPanel from './FloatPanel'
import { api } from '../../lib/api'
import Avatar from './Avatar'

// Who follows a sketcher, or whom they follow, newest first
// (GET /api/sketchers/{username}/followers or /following).
//   mode   'followers' (default) | 'following'
export default function FollowersPanel({ username, mode = 'followers', onClose }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    setList(null)
    api.get(`/api/sketchers/${username}/${mode}`).then(({ data }) => setList(data)).catch(() => setList([]))
  }, [username, mode])

  return (
    <FloatPanel placement="modal" title={mode === 'following' ? 'Following' : 'Followers'} onClose={onClose} width="420px">
      {list === null && <p className="text-sm text-ink/50">Loading…</p>}
      {list?.length === 0 && <p className="text-sm text-ink/50">{mode === 'following' ? 'Not following anyone yet.' : 'No followers yet.'}</p>}
      <ul className="flex flex-col">
        {list?.map((p) => (
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
