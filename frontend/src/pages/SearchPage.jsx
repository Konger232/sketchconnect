import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Header from '../components/layout/Header'
import Footer from '../components/layout/Footer'
import SketchCard from '../components/common/SketchCard'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { distanceKm } from '../lib/geo'

// Sketches farther than this from a chosen location are hidden rather
// than just sorted last -- matches the default radius_km already used by
// GET /api/sketches/recent (see routers/sketches.py) so "near X" means
// the same thing everywhere in the app.
const DEFAULT_RADIUS_KM = 50
// How many public sketches to pull back when searching by location while
// logged out -- higher than the plain recent-feed's default of 10 since
// this is an explicit search, not a small Home-page preview.
const LOCATION_SEARCH_LIMIT = 50

/**
 * Full search results page -- replaces the inline search boxes that used
 * to live directly on LoggedInHome/LoggedOutHome (removed there; see those
 * files). The header's magnifying-glass icon (mobile and desktop) now just
 * links straight here instead of expanding an input in place, so all the
 * actual typing/filtering happens on this page instead of eating vertical
 * space on Home.
 *
 * Two independent, combinable filters:
 *  - title text, matched client-side against whatever sketch list is
 *    currently loaded (same substring match LoggedInHome's search box
 *    used to do);
 *  - a place name, resolved to coordinates via the same
 *    GET /api/geocode/search Nominatim proxy LocationPicker.jsx already
 *    uses for the capture flow's location editor. Once a place is picked:
 *      - signed in (searching your own sketches, already fully loaded via
 *        GET /api/sketches): ranked/filtered client-side with a plain
 *        haversine distance (lib/geo.js) -- no need to round-trip to the
 *        backend for data already in hand;
 *      - signed out (searching the public feed): re-fetched from
 *        GET /api/sketches/recent with that lat/lon, which does the
 *        equivalent PostGIS ST_DWithin/ST_Distance query server-side and
 *        already falls back to most-recent-overall if nothing is nearby,
 *        so results are never mysteriously empty.
 *
 * Results render with the same SketchCard used everywhere else (Home
 * feeds, Profile), per the "use SketchCard as the display template"
 * request -- a plain grid, no Map View (that's a Home-specific section,
 * not part of search).
 */
export default function SearchPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') || '')
  const [sketches, setSketches] = useState([])
  const [loading, setLoading] = useState(true)

  const [placeQuery, setPlaceQuery] = useState('')
  const [placeResults, setPlaceResults] = useState([])
  const [placeSearching, setPlaceSearching] = useState(false)
  const [placeError, setPlaceError] = useState(null)
  const [place, setPlace] = useState(null) // { label, lat, lon } | null

  // Base list: your own sketches when signed in, otherwise the public
  // recent feed. Re-fetched (with lat/lon) whenever a place is picked
  // while signed out, so the search can reach beyond whatever the initial
  // small "recent" page happened to include.
  useEffect(() => {
    setLoading(true)
    const endpoint = user ? '/api/sketches' : '/api/sketches/recent'
    const reqParams = !user && place
      ? { lat: place.lat, lon: place.lon, radius_km: DEFAULT_RADIUS_KM, limit: LOCATION_SEARCH_LIMIT }
      : undefined
    api.get(endpoint, { params: reqParams }).then(({ data }) => setSketches(data)).finally(() => setLoading(false))
  }, [user, place])

  const results = useMemo(() => {
    let list = sketches

    if (place && user) {
      // Own sketches aren't re-fetched per place (already fully loaded),
      // so distance filtering happens here instead of on the server.
      list = list
        .filter((s) => s.location)
        .map((s) => ({ s, km: distanceKm(place, s.location) }))
        .sort((a, b) => a.km - b.km)
        .filter((entry, i) => entry.km <= DEFAULT_RADIUS_KM || i === 0) // never empty just because nothing's within range
        .map((entry) => entry.s)
    }

    const q = query.trim().toLowerCase()
    if (q) list = list.filter((s) => (s.title || '').toLowerCase().includes(q))
    return list
  }, [sketches, query, place, user])

  function handleQueryChange(value) {
    setQuery(value)
    setParams(value ? { q: value } : {}, { replace: true })
  }

  async function handlePlaceSearch(e) {
    e.preventDefault()
    if (!placeQuery.trim()) return
    setPlaceSearching(true)
    setPlaceError(null)
    try {
      const { data } = await api.get('/api/geocode/search', { params: { q: placeQuery } })
      setPlaceResults(data)
      if (data.length === 0) setPlaceError('No matching places found.')
    } catch {
      setPlaceError('Location search is temporarily unavailable.')
    } finally {
      setPlaceSearching(false)
    }
  }

  function handlePickPlace(result) {
    setPlace(result)
    setPlaceResults([])
    setPlaceQuery('')
  }

  function handleClearPlace() {
    setPlace(null)
  }

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-2xl px-4 pb-16">
        <div className="my-4 flex items-center gap-2 rounded-full border border-black/15 px-4 py-3">
          <span>🔍</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder={user ? 'Search your sketches...' : 'Where do you want to sketch today?'}
            className="w-full bg-transparent outline-none placeholder:text-ink/50"
          />
        </div>

        {place ? (
          <div className="mb-4 flex items-center justify-between rounded-full border border-black/15 px-4 py-2 text-sm">
            <span>📍 Near {place.label}</span>
            <button type="button" onClick={handleClearPlace} className="font-semibold text-ink/50 hover:text-ink">
              Clear
            </button>
          </div>
        ) : (
          <form onSubmit={handlePlaceSearch} className="mb-1 flex gap-2">
            <input
              value={placeQuery}
              onChange={(e) => setPlaceQuery(e.target.value)}
              placeholder="Search by location..."
              className="flex-1 rounded-full border border-black/15 px-4 py-2 text-sm outline-none placeholder:text-ink/50"
            />
            <button
              type="submit"
              disabled={placeSearching}
              className="rounded-full border border-black/15 px-4 py-2 text-sm font-medium hover:bg-black/5"
            >
              {placeSearching ? 'Searching…' : 'Search'}
            </button>
          </form>
        )}

        {placeError && <p className="mb-4 text-xs text-accent">{placeError}</p>}

        {placeResults.length > 0 && (
          <div className="mb-4 flex flex-col gap-1 rounded-lg border border-black/15 p-1">
            {placeResults.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handlePickPlace(r)}
                className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-black/5"
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        {loading && <p className="mt-6 text-center text-ink/50">Loading…</p>}
        {!loading && results.length === 0 && (
          <p className="mt-6 text-center text-ink/50">
            {query || place ? 'No sketches match that search.' : 'No sketches to show yet.'}
          </p>
        )}
        {!loading && results.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {results.map((s) => (
              <SketchCard key={s.id} sketch={s} />
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
