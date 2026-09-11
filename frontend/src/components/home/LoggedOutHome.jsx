import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import RecentSketchesSection from './RecentSketchesSection'
import { useGeolocation } from '../../lib/useGeolocation'
import { api } from '../../lib/api'

const FEATURES = [
  {
    title: 'Discover New Locations',
    body: 'See where fellow sketchers have captured amazing scenes. Our interactive map shows you sketching spots you never knew existed, from hidden cafés to architectural gems.',
  },
  {
    title: 'Share Your Adventures',
    body: 'Post your sketches with exact locations, weather conditions, and the story behind each piece. Help others find their next perfect sketching spot.',
  },
  {
    title: 'Connect with Your Tribe',
    body: 'Find local sketching groups, join workshops, and meet artists who share your passion for drawing the world around us.',
  },
  {
    title: 'Stay True to the Mission',
    body: 'Built-in location verification ensures every sketch shared is authentically created on-site, keeping true to the Urban Sketchers manifesto.',
  },
]

/**
 * Default (logged-out) Home: real recent/nearby sketches from
 * GET /api/sketches/recent, using the visitor's GPS when they grant it —
 * replacing the earlier hardcoded "popular spots" placeholders — plus the
 * marketing shell from the Figma/Claude-Design "New User" home.
 */
export default function LoggedOutHome() {
  const { coords, status } = useGeolocation()
  const [sketches, setSketches] = useState([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // Wait for a definitive geolocation answer (granted or denied/unsupported)
    // before asking, so a nearby result isn't fetched then immediately
    // replaced by an unfiltered one once permission resolves.
    if (status === 'idle' || status === 'locating') return
    const params = coords ? { lat: coords.lat, lon: coords.lon } : {}
    api.get('/api/sketches/recent', { params }).then(({ data }) => setSketches(data)).finally(() => setLoaded(true))
  }, [status, coords])

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16">
      <h2 className="mt-6 text-xl font-bold">Plan your next sketch</h2>
      <p className="text-sm text-ink/60">
        {coords ? 'Recent sketches near you' : 'Recent sketches from the community'}
      </p>

      {loaded && sketches.length === 0 && (
        <p className="mt-3 text-sm text-ink/50">No sketches shared yet — be the first!</p>
      )}
      <RecentSketchesSection gridSketches={sketches.slice(0, 4)} mapSketches={sketches} />

      <p className="mt-8 text-center font-hand text-2xl">Connect &nbsp;.&nbsp; Sketch &nbsp;.&nbsp; Share</p>
      <p className="mt-2 text-center text-sm text-ink/70">
        Discover your next sketching adventure with fellow urban sketchers worldwide.
        SketchConnect brings together the global community of artists who love to draw
        the world around them, one location at a time.
      </p>

      <Link to="/login" className="mt-6 block rounded-lg bg-ink py-4 text-center font-hand text-xl text-paper">
        Sign up Today
      </Link>

      <div className="mt-8 rounded-xl bg-black/5 p-5">
        <h2 className="text-lg font-bold">Why SketchConnect</h2>
        <p className="mt-2 text-sm text-ink/80">
          SketchConnect is built for the vibrant community of urban sketchers who believe
          in drawing on location, capturing the essence of places as they truly are.
          Inspired by the Urban Sketchers movement founded in 2007, we're creating a
          dedicated space where artists can:
        </p>
        <div className="mt-4 flex flex-col gap-4">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-sm text-ink/70">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
