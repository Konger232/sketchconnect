import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Avatar from './Avatar'
import Icon from './Icon'
import NameHandle from './NameHandle'
import SketchListMapView from './SketchListMapView'
import { api } from '../../lib/api'
import { dateLabel, imageUrl } from '../../lib/media'
import { handle } from '../../lib/people'

// A sketch from the API as a SketchListMapView item.
export const toListItem = (s) => ({
  id: s.id,
  title: s.title,
  meta: [s.owner && handle(s.owner), s.location?.label].filter(Boolean).join(' · '),
  date: dateLabel(s.created_at),
  place: s.location?.label,
  lat: s.location?.lat,
  lon: s.location?.lon,
  image: imageUrl(s.final_sketch_url || s.reference_image_url),
  sketch: s,
})

/**
 * The generic search box and its results (design doc, Search): a
 * sketcher's name, a sketch title, or a place (a town, a city, a country).
 * Newest first, in SketchListMapView. Used by the Search page and the
 * registered sketcher's Home.
 *
 * The results say what the text matched (November 14, 2026): sketchers
 * whose name or username has it are listed first, as links to their pages;
 * a place shows as "Sketches in <place>", and opens on the map unless
 * sketchers matched too.
 *
 *   initial    [sketches] shown before anything is typed (Home: near you)
 *   initialLabel  a line above them
 *   autoFocus
 */
export default function SketchSearch({ initial = null, initialLabel, autoFocus = false }) {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') || '')
  const [results, setResults] = useState(null) // null: nothing searched
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    const q = query.trim()
    setParams(q ? { q } : {}, { replace: true })
    clearTimeout(timer.current)
    if (q.length < 2) { setResults(null); setError(null); setLoading(false); return }
    timer.current = setTimeout(() => {
      setLoading(true)
      setError(null)
      api.get('/api/sketches/search', { params: { q } })
        .then(({ data }) => setResults(Array.isArray(data) ? { sketches: data, sketchers: [], place: null } : data))
        .catch(() => setError('Search is not available right now.'))
        .finally(() => setLoading(false))
    }, 400)
    return () => clearTimeout(timer.current)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  const searching = results !== null
  const shown = searching ? results.sketches : initial
  const people = searching ? results.sketchers : []
  const place = searching ? results.place : null
  // A place search opens on the map; a sketcher (or title) search on the grid.
  const mode = place && people.length === 0 ? 'map' : 'grid'

  return (
    <div className="flex flex-col gap-6">
      <label className="flex items-center gap-3 border-b border-ink/40 pb-2 focus-within:border-ink">
        <Icon name="search" size={18} className="text-ink/60" />
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sketchers, sketch titles or places"
          aria-label="Search sketchers, sketch titles or places"
          className="w-full bg-transparent py-1 text-lg outline-none placeholder:text-ink/40"
        />
      </label>
      {error && <p className="m-0 text-sm text-accent">{error}</p>}
      {loading && <p className="m-0 animate-pulse text-sm text-ink/60">Searching…</p>}
      {!loading && !searching && initial === null && !error && (
        <p className="m-0 text-sm text-ink/60">Try a sketcher's name, a title, or a place such as Kyoto or Thailand.</p>
      )}
      {!loading && !searching && initialLabel && initial !== null && <span className="ed-kicker -mb-2">{initialLabel}</span>}
      {!loading && people.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className="ed-kicker">Sketchers</span>
          <div className="flex flex-col gap-1">
            {people.map((p) => (
              <Link key={p.id} to={`/sketchers/${p.username}`}
                className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-ink no-underline hover:bg-ink/5">
                <Avatar url={p.avatar_url} className="h-9 w-9" />
                <NameHandle person={p} className="min-w-0 truncate" />
              </Link>
            ))}
          </div>
        </section>
      )}
      {!loading && place && (
        <span className="ed-kicker -mb-2 flex items-center gap-1.5">
          <Icon name="location" size={13} className="text-[var(--pin-active)]" /> Sketches in {place.name}
        </span>
      )}
      {!loading && searching && people.length > 0 && !place && shown.length > 0 && (
        <span className="ed-kicker -mb-2">Sketches</span>
      )}
      {!loading && shown !== null && (
        <SketchListMapView key={searching ? `${query.trim()}:${mode}` : 'initial'} view={mode}
          items={shown.map(toListItem)}
          emptyText={searching ? `No sketches match "${query.trim()}".` : 'No sketches yet.'} />
      )}
    </div>
  )
}
