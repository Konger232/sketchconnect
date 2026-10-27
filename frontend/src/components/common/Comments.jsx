import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Button from './Button'
import { api } from '../../lib/api'
import { relativeTime } from '../../lib/relativeTime'
import Avatar from './Avatar'

/**
 * Comments on a shared sketch (design doc, item 32). Visitors read and get
 * "Log in to comment"; members and the owner post. The author, or the
 * sketch's owner, can remove a comment.
 *
 * The same module takes questions on an event (item 49): pass `base`
 * ('/api/events/<id>'), `removeBase` ('/api/event-comments'), and the
 * words (`title`, `placeholder`, `empty`). viewer 'owner' is the one who
 * may remove anyone's (the sketch's owner, the event's organiser).
 */
export default function Comments({
  sketchId, viewer, userId, onCount,
  base = `/api/sketches/${sketchId}`, removeBase = '/api/comments',
  title = 'Comments', placeholder = 'Add a comment', empty = 'No comments yet.', loginText = 'Log in to comment',
}) {
  const [list, setList] = useState(null)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState(null)
  const location = useLocation()

  useEffect(() => {
    api.get(`${base}/comments`).then(({ data }) => setList(data)).catch(() => setList([]))
  }, [base])
  useEffect(() => { if (list) onCount?.(list.length) }, [list]) // eslint-disable-line react-hooks/exhaustive-deps

  async function post(e) {
    e.preventDefault()
    if (!text.trim()) return
    setPosting(true)
    setError(null)
    try {
      const { data } = await api.post(`${base}/comments`, { body: text })
      setList((l) => [...(l || []), data])
      setText('')
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not post your comment.')
    } finally {
      setPosting(false)
    }
  }

  async function remove(id) {
    await api.delete(`${removeBase}/${id}`)
    setList((l) => l.filter((c) => c.id !== id))
  }

  return (
    <section className="ed-section">
      <h2 className="ed-kicker m-0">{title} · {list?.length ?? 0}</h2>
      {list?.length === 0 && <p className="m-0 text-sm text-ink/50">{empty}</p>}
      <ul className="flex flex-col gap-4">
        {list?.map((c) => (
          <li key={c.id} className="flex gap-3">
            <Avatar url={c.author.avatar_url} className="h-9 w-9" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm">
                {c.author.username ? (
                  <Link to={`/sketchers/${c.author.username}`} className="font-bold text-ink no-underline hover:underline">{c.author.display_name || c.author.username}</Link>
                ) : <b>A sketcher</b>}
                <span className="text-ink/50"> · {relativeTime(c.created_at)}</span>
              </span>
              <p className="m-0 whitespace-pre-line text-base">{c.body}</p>
            </div>
            {(c.author_id === userId || viewer === 'owner') && (
              <button type="button" onClick={() => remove(c.id)} className="self-start text-xs text-ink/50 underline hover:text-ink">Remove</button>
            )}
          </li>
        ))}
      </ul>
      {viewer === 'visitor' ? (
        <Link to="/login" state={{ from: location.pathname }} className="self-start text-sm font-bold text-ink underline">{loginText}</Link>
      ) : (
        <form onSubmit={post} className="flex gap-2.5">
          <input className="field-input !rounded-none" placeholder={placeholder} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} aria-label={placeholder} />
          <Button type="submit" variant="editorialSolid" disabled={posting || !text.trim()}>{posting ? 'Posting…' : 'Post'}</Button>
        </form>
      )}
      {error && <p className="m-0 text-sm text-accent">{error}</p>}
    </section>
  )
}
