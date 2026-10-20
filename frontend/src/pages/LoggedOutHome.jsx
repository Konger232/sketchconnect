import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import SketchListMapView from '../components/common/SketchListMapView'
import { useGeolocation } from '../lib/useGeolocation'
import { api } from '../lib/api'
import { dateLabel, imageUrl } from '../lib/media'

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

  const items = sketches.map((s) => ({
    id: s.id,
    title: s.title,
    place: s.location?.label,
    date: dateLabel(s.created_at),
    lat: s.location?.lat,
    lon: s.location?.lon,
    image: imageUrl(s.final_sketch_url || s.reference_image_url),
    sketch: s,
  }))

  // The same page width and responsive steps as the Sketcher page and
  // SketchDetail (index.css .ed-page, .ed-section).
  return (
    <main className="ed-page">
      <section className="flex flex-col gap-3">
        <span className="ed-kicker">{coords ? 'Recent sketches near you' : 'Recent sketches from the community'}</span>
        <h1 className="ed-title">Plan your next sketch</h1>
      </section>

      <section className="ed-section">
        {loaded ? (
          <SketchListMapView items={items.slice(0, 8)} cols={4} emptyText="No sketches shared yet. Be the first!" />
        ) : (
          <p className="m-0 animate-pulse text-sm text-ink/60">Finding sketches…</p>
        )}
      </section>

      <section className="ed-section items-center text-center">
        <p className="m-0 font-hand text-3xl">Connect &nbsp;.&nbsp; Sketch &nbsp;.&nbsp; Share</p>
        <p className="m-0 max-w-2xl text-base text-ink/70">
          Discover your next sketching adventure with fellow sketchers worldwide.
          SketchConnect brings together the global community of artists who love to draw
          the world around them, one location at a time.
        </p>
        <Link to="/login" className="mt-2 block w-full max-w-sm rounded-lg bg-ink py-4 text-center font-hand text-xl text-paper">
          Sign up Today
        </Link>
      </section>

      <section className="ed-section">
        <h2 className="ed-kicker m-0">Why SketchConnect</h2>
        <p className="m-0 max-w-3xl text-base text-ink/80">
          SketchConnect is for everyone learning to see like a sketcher. Inspired by the
          Urban Sketchers movement, founded in 2007, we believe drawing from observation is
          the best way to understand a place. Sketch in front of the scene when you can, or
          practice from a photo when you can't. Either way, you learn to see.
        </p>
        <div className="grid gap-6 md:grid-cols-2 md:gap-x-14">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex flex-col gap-1">
              <h3 className="m-0 font-heading text-lg font-medium">{f.title}</h3>
              <p className="m-0 text-sm text-ink/70">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
