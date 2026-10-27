import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BasePage from '../components/common/BasePage'
import Button from '../components/common/Button'
import EventCard from '../components/common/EventCard'
import EventSetupPanel from '../components/common/EventSetupPanel'
import Icon from '../components/common/Icon'
import { useAuth } from '../components/common/AuthContext'
import { api } from '../lib/api'
import { useGeolocation } from '../lib/useGeolocation'

/**
 * Events (design doc, item 49): what is coming up near me; events where a
 * sketcher I follow or like is teaching; instructor requests waiting for
 * me; and Set up an event.
 */
export default function Events() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { coords } = useGeolocation()
  const [home, setHome] = useState(null)
  const [invites, setInvites] = useState([])
  const [panel, setPanel] = useState(false)

  // One call where possible. With location already allowed, wait up to
  // 1.5 s for the position and send it; otherwise load straight away (a
  // permission prompt can wait forever) and re-sort when it arrives.
  const [ready, setReady] = useState(false)
  const fetched = useRef(null)
  useEffect(() => {
    const go = () => setReady(true)
    const timer = setTimeout(go, 1500)
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((p) => { if (p.state !== 'granted') go() }).catch(go)
    } else go()
    return () => clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (!ready && !coords) return
    const key = coords ? `${coords.lat},${coords.lon}` : 'none'
    if (fetched.current === key) return
    fetched.current = key
    api.get('/api/events/home', { params: coords ? { lat: coords.lat, lon: coords.lon } : {} })
      .then(({ data }) => setHome(data)).catch(() => setHome((h) => h || { mine: [], mine_past: [], upcoming: [], teaching: [] }))
  }, [ready, coords])
  useEffect(() => {
    if (user) api.get('/api/events/invites/mine').then(({ data }) => setInvites(data)).catch(() => setInvites([]))
  }, [user])

  async function answer(e, yes) {
    await api.post(`/api/events/${e.id}/instructors/${yes ? 'accept' : 'decline'}`)
    setInvites((list) => list.filter((x) => x.id !== e.id))
  }

  const grid = (list, note) => (
    <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((e) => <EventCard key={`${e.id}-${e.instructor?.username || ''}`} event={e} note={note?.(e)} />)}
    </div>
  )

  return (
    <BasePage>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="ed-kicker">Meet-ups, sketch crawls, workshops, festivals</span>
          <h1 className="ed-title">Events</h1>
        </div>
        {user && (
          <Button variant="editorialSolid" onClick={() => setPanel(true)}><Icon name="plus" size={14} /> Set up an event</Button>
        )}
      </section>

      {home?.mine?.length > 0 && (
        <section className="ed-section">
          <h2 className="ed-kicker m-0">Your events</h2>
          {grid(home.mine)}
        </section>
      )}

      {invites.length > 0 && (
        <section className="ed-section">
          <h2 className="ed-kicker m-0">You're invited to teach</h2>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {invites.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-md border border-ink/10 p-3">
                <span className="min-w-0 flex-1"><b>{e.title}</b> <span className="text-sm text-ink/60">by {e.organizer?.display_name || `@${e.organizer?.username}`}</span></span>
                <Button variant="editorial" size="sm" onClick={() => navigate(`/events/${e.id}`)}>See it</Button>
                <Button variant="editorial" size="sm" onClick={() => answer(e, false)}>Decline</Button>
                <Button variant="editorialSolid" size="sm" onClick={() => answer(e, true)}>Accept</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {home?.teaching?.length > 0 && (
        <section className="ed-section">
          <h2 className="ed-kicker m-0">Sketchers you follow are teaching</h2>
          {grid(home.teaching, (e) => `Teaching: ${e.instructor?.display_name || `@${e.instructor?.username}`}`)}
        </section>
      )}

      <section className="ed-section">
        <h2 className="ed-kicker m-0">{coords ? 'Coming up near you' : 'Coming up'}</h2>
        {home === null && <p className="m-0 animate-pulse text-sm text-ink/60">Finding events…</p>}
        {home && home.upcoming.length === 0 && <p className="m-0 text-sm text-ink/60">No events coming up yet.</p>}
        {home && home.upcoming.length > 0 && grid(home.upcoming)}
      </section>

      {/* Past events show only to their organiser, for now. */}
      {home?.mine_past?.length > 0 && (
        <section className="ed-section">
          <h2 className="ed-kicker m-0">Your past events</h2>
          <p className="-mt-2 m-0 text-xs text-ink/55">Only you see these.</p>
          {grid(home.mine_past)}
        </section>
      )}

      {panel && <EventSetupPanel onClose={() => setPanel(false)} onSaved={(e) => { setPanel(false); navigate(`/events/${e.id}`) }} />}
    </BasePage>
  )
}
