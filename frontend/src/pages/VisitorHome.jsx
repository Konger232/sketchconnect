import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import SketchListMapView from '../components/common/SketchListMapView'
import { useGeolocation } from '../lib/useGeolocation'
import { api } from '../lib/api'
import { dateLabel, imageUrl } from '../lib/media'

// What SketchConnect does, for visitors (design doc: core flow and the
// Sketcher to Sketcher expansion). The first three get a picture each.
const STEPS = [
  {
    kicker: 'Before you draw',
    title: 'Make a composition plan',
    body: 'Crop your scene, then mark what catches your eye. The AI reads your marks back with the design principles they show, and short tips for the pens and paints in your bag. It reads your plan; it never draws for you.',
    art: 'plan',
  },
  {
    kicker: 'Values',
    title: 'Study the values',
    body: 'Squint at the scene in 3, 5, 7 or 9 values. The big light and dark shapes come forward, and a value chart shows which value leads. Made for fountain pen and ink sketchers too.',
    art: 'value',
  },
  {
    kicker: 'Colour',
    title: 'Shape a gamut mask',
    body: "James Gurney's gamut mask limits your colours for harmony and mood. Shape the mask on the colour wheel, collect colours, and get a mixing recipe for each from the paints you carry.",
    art: 'mask',
  },
]

const MORE = [
  {
    title: 'Feedback from an AI coach',
    body: 'Upload your sketch and get feedback in the spirit of the sketchers you admire. The coach looks at the whole journey, from your plan to your progress pages, not just the final sketch.',
  },
  {
    title: 'Search and map view',
    body: "Find sketches by a sketcher's name, a title or a place, in a list or on a map. Planning a trip? See how others sketched the same street.",
  },
  {
    title: 'Share your journey',
    body: 'Your sketch page shows the full journey, from photo to final sketch, with other sketches made at the same place. One tap shares it to Instagram or Facebook.',
  },
  {
    title: 'Your sketcher page',
    body: "A link-in-bio page with your map, featured work, tool kit and usual palette. Snap a photo of your kit; the AI lists the tools and you confirm them.",
  },
  {
    title: 'Comments, likes and follows',
    body: 'Feedback from a person, next to the AI coach. Say "this helped me" and keep up with the sketchers you learn from.',
  },
  {
    title: 'Sketch crawls',
    body: 'Weekend challenges by scene, technique or place, with everyone\'s process side by side. Coming soon.',
  },
]

// The pictures beside the first three steps, drawn here, not photos.
function StepArt({ kind }) {
  if (kind === 'plan') {
    // A photo frame with the rule of thirds, a focal point and two marks.
    return (
      <svg viewBox="0 0 400 320" className="block w-full bg-[#e9e4da]" aria-hidden="true">
        <rect x="0" y="210" width="400" height="110" fill="#cfc6b6" />
        <path d="M40 210 L120 120 L170 160 L240 80 L330 170 L360 150 L400 190 L400 210Z" fill="#b8ad9b" />
        <path d="M150 210 L150 120 L210 95 L270 120 L270 210Z" fill="#8f8574" />
        {[133, 267].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="320" stroke="#fff" strokeOpacity="0.8" />)}
        {[107, 213].map((y) => <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="#fff" strokeOpacity="0.8" />)}
        <path d="M30 250 C 110 215, 190 215, 265 125" fill="none" stroke="#f2c230" strokeWidth="5" strokeLinecap="round" />
        <path d="M150 120 L210 95 L270 120" fill="none" stroke="#e2582a" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="267" cy="107" r="18" fill="none" stroke="#111" strokeWidth="3" />
        <circle cx="267" cy="107" r="4" fill="#111" />
      </svg>
    )
  }
  if (kind === 'value') {
    // Five values, light to dark, as shapes and as a scale.
    const greys = ['#f4f4f4', '#c9c9c9', '#969696', '#5c5c5c', '#222']
    return (
      <svg viewBox="0 0 400 320" className="block w-full" aria-hidden="true">
        <rect width="400" height="320" fill={greys[1]} />
        <rect y="200" width="400" height="120" fill={greys[2]} />
        <path d="M0 200 L90 110 L150 160 L230 70 L320 150 L400 120 L400 200Z" fill={greys[3]} />
        <path d="M150 200 L150 120 L210 95 L270 120 L270 200Z" fill={greys[4]} />
        <rect x="190" y="150" width="40" height="50" fill={greys[0]} />
        <circle cx="330" cy="60" r="26" fill={greys[0]} />
        {greys.map((g, i) => <rect key={g} x={20 + i * 36} y="270" width="36" height="30" fill={g} stroke="#fff" strokeWidth="2" />)}
      </svg>
    )
  }
  // A gamut mask: a wheel, darkened outside a triangle.
  const wedges = Array.from({ length: 12 }, (_, k) => {
    const a0 = ((k * 30 - 15 + 60) * Math.PI) / 180, a1 = ((k * 30 + 15 + 60) * Math.PI) / 180
    return { k, d: `M160 160 L${160 + 140 * Math.cos(a0)} ${160 + 140 * Math.sin(a0)} A140 140 0 0 1 ${160 + 140 * Math.cos(a1)} ${160 + 140 * Math.sin(a1)}Z` }
  })
  return (
    <div className="flex items-center justify-center bg-black p-6">
      <svg viewBox="0 0 320 320" className="block w-full max-w-[300px]" aria-hidden="true">
        <defs>
          <radialGradient id="home-grey"><stop offset="0" stopColor="#8c8c8c" /><stop offset="1" stopColor="#8c8c8c" stopOpacity="0" /></radialGradient>
          <mask id="home-mask"><rect width="320" height="320" fill="#fff" /><path d="M160 50 L255 215 L65 215Z" fill="#000" /></mask>
        </defs>
        {wedges.map((w) => <path key={w.k} d={w.d} fill={`hsl(${w.k * 30} 75% 55%)`} />)}
        <circle cx="160" cy="160" r="140" fill="url(#home-grey)" />
        <rect width="320" height="320" fill="rgba(0,0,0,0.68)" mask="url(#home-mask)" />
      </svg>
    </div>
  )
}

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
export default function VisitorHome() {
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
          <SketchListMapView items={items.slice(0, 9)} emptyText="No sketches shared yet. Be the first!" />
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
      </section>

      {/* The core flow, one step per row, the picture beside the words. */}
      {STEPS.map((s, i) => (
        <section key={s.title} className="ed-section">
          <div className="grid items-center gap-6 md:grid-cols-2 md:gap-14">
            <div className={i % 2 ? 'md:order-2' : ''}><StepArt kind={s.art} /></div>
            <div className="flex flex-col gap-3">
              <span className="ed-caption">{`${i + 1} · ${s.kicker}`}</span>
              <h2 className="m-0 font-heading text-2xl font-bold leading-tight md:text-3xl">{s.title}</h2>
              <p className="m-0 text-base text-ink/75">{s.body}</p>
            </div>
          </div>
        </section>
      ))}

      <section className="ed-section">
        <h2 className="ed-kicker m-0">And more</h2>
        <div className="grid gap-x-14 gap-y-6 md:grid-cols-2 lg:grid-cols-3">
          {MORE.map((f) => (
            <div key={f.title} className="flex flex-col gap-1">
              <h3 className="m-0 font-heading text-lg font-medium">{f.title}</h3>
              <p className="m-0 text-sm text-ink/70">{f.body}</p>
            </div>
          ))}
        </div>
        <Link to="/login" className="mt-4 block w-full max-w-sm self-center rounded-lg bg-ink py-4 text-center font-hand text-xl text-paper">
          Start sketching
        </Link>
      </section>
    </main>
  )
}
