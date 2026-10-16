import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import SketchCard from '../components/common/SketchCard'
import LocationMap from '../components/common/LocationMap'
import { useGeolocation } from '../lib/useGeolocation'
import { api } from '../lib/api'

const FEATURES = [
  {
    title: 'Plan before you draw',
    body: 'Mark what catches your eye on your photo. The AI reads your plan back with design principles and short tips for the tools in your bag.',
  },
  {
    title: 'Discover new places',
    body: 'See where fellow sketchers have drawn, on a map or by search. Planning a trip? See how others sketched the same place, and which paints they brought.',
  },
  {
    title: 'Share your journey',
    body: 'Post your sketch with its story and every stage it took to get there. Pick a location, or leave it out. Share it to Instagram or Facebook in one tap.',
  },
  {
    title: 'Connect with your tribe',
    body: 'Follow sketchers you learn from, comment on their work, and show your own kit. Join workshops and meet artists who share your passion for drawing the world around us.',
  },
]

/**
 * Default (logged-out) Home: real recent/nearby sketches from
 * GET /api/sketches/recent, using the visitor's GPS when they grant it —
 * replacing the earlier hardcoded "popular spots" placeholders — plus the
 * marketing shell from the Figma/Claude-Design "New User" home.
 *
 * The sketch-grid + "Map View" block below used to be its own
 * RecentSketchesSection.jsx, shared with LoggedInHome.jsx -- folded back
 * in here since the two pages' versions of it had drifted apart enough
 * (different grid caps, different map source) that sharing it wasn't
 * actually saving anything.
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

      <div className="mt-3 grid grid-cols-2 gap-3">
        {sketches.slice(0, 4).map((s) => (
          <SketchCard key={s.id} sketch={s} />
        ))}
      </div>

      <h2 className="mt-8 text-xl font-bold">Map View</h2>
      <div className="mt-2">
        <LocationMap
          points={sketches.filter((s) => s.location).map((s) => ({ ...s.location, label: s.title }))}
        />
      </div>

      <p className="mt-8 text-center font-hand text-2xl">Connect &nbsp;.&nbsp; Sketch &nbsp;.&nbsp; Share</p>
      <p className="mt-2 text-center text-sm text-ink/70">
        Discover your next sketching adventure with fellow sketchers worldwide.
        SketchConnect brings together the global community of artists who love to draw
        the world around them, one location at a time.
      </p>

      <Link to="/login" className="mt-6 block rounded-lg bg-ink py-4 text-center font-hand text-xl text-paper">
        Sign up Today
      </Link>

      <div className="mt-8 rounded-xl bg-black/5 p-5">
        <h2 className="text-lg font-bold">Why SketchConnect</h2>
        <p className="mt-2 text-sm text-ink/80">
          SketchConnect is for everyone learning to see like a sketcher. Inspired by the
          Urban Sketchers movement, founded in 2007, we believe drawing from observation is
          the best way to understand a place. Sketch in front of the scene when you can, or
          practice from a photo when you can't. Either way, you learn to see.
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
