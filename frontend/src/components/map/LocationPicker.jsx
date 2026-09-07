import { useEffect, useRef, useState } from 'react'
import LocationMap from './LocationMap'
import { api } from '../../lib/api'

// Wraps LocationMap (the plain Leaflet click/drag picker) with the two
// things a bare map can't give you: a search box to find a place by name
// (forward geocoding), and a read-only line showing the human-readable
// name that matches whatever pin is currently set (reverse geocoding) --
// both proxied through backend/app/routers/geocode.py, which talks to
// OpenStreetMap's free Nominatim service.
//
// `location` is { lat, lon } | null, same shape EditSketchPage already
// tracks -- this component doesn't introduce a new stored "label" field,
// it just resolves one live for display whenever `location` changes.
//
// `onLabelChange`, when passed, is told about the resolved human-readable
// label too (a search-result pick, or a reverse-geocode lookup after a
// map click/drag) -- so a caller that only shows this component while
// expanded (CapturePage.jsx's collapsible "Add location" row) can still
// keep the resolved name around to display once collapsed again.
export default function LocationPicker({ location, onLocationChange, onLabelChange }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  const [resolvedLabel, setResolvedLabel] = useState(null)
  const [resolving, setResolving] = useState(false)
  // Tracks whether the current label already came straight from a search
  // result (which already carries Nominatim's own display_name) so picking
  // a search result doesn't trigger a redundant, possibly differently
  // formatted, reverse-geocode call right after.
  const knownLabelCoords = useRef(null)

  useEffect(() => {
    onLabelChange?.(resolvedLabel)
  }, [resolvedLabel])

  useEffect(() => {
    if (!location) {
      setResolvedLabel(null)
      return
    }
    const isKnown = knownLabelCoords.current
      && knownLabelCoords.current.lat === location.lat
      && knownLabelCoords.current.lon === location.lon
    if (isKnown) return

    let cancelled = false
    setResolving(true)
    api.get('/api/geocode/reverse', { params: { lat: location.lat, lon: location.lon } })
      .then(({ data }) => { if (!cancelled) setResolvedLabel(data.label || null) })
      .catch(() => { if (!cancelled) setResolvedLabel(null) })
      .finally(() => { if (!cancelled) setResolving(false) })

    return () => { cancelled = true }
  }, [location?.lat, location?.lon])

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setSearchError(null)
    try {
      const { data } = await api.get('/api/geocode/search', { params: { q: query } })
      setResults(data)
      if (data.length === 0) setSearchError('No matches found.')
    } catch {
      setSearchError('Location search is temporarily unavailable.')
    } finally {
      setSearching(false)
    }
  }

  function handlePickResult(result) {
    knownLabelCoords.current = { lat: result.lat, lon: result.lon }
    setResolvedLabel(result.label)
    onLocationChange({ lat: result.lat, lon: result.lon })
    setResults([])
    setQuery('')
  }

  function handleMapChange(loc) {
    knownLabelCoords.current = null // came from a click/drag, not a search result -- resolve it
    onLocationChange(loc)
  }

  return (
    <div>
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a place..."
          className="flex-1 rounded-lg border border-black/15 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={searching}
          className="rounded-lg border border-black/15 px-3 py-2 text-sm font-medium hover:bg-black/5"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {searchError && <p className="mt-1 text-xs text-accent">{searchError}</p>}

      {results.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 rounded-lg border border-black/15 p-1">
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handlePickResult(r)}
              className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-black/5"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      <p className="mt-2 text-sm">
        📍 {resolving ? 'Resolving location…' : resolvedLabel || (location ? 'Location set (name unavailable)' : 'No location set yet')}
      </p>

      <div className="mt-2">
        <LocationMap lat={location?.lat} lon={location?.lon} editable onLocationChange={handleMapChange} height="h-80" />
      </div>
    </div>
  )
}
