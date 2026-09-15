import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'

// A single, compact search field for a sketch's own location -- replaces
// the old LocationPicker.jsx (search box + Search button + a resolved-
// label paragraph + an embedded, click/drag-able map). That map is gone
// entirely here: LocationMap.jsx still shows *other* sketchers' locations 
// on the Home feed, but a single sketch's own location doesn't need one
// in its editor.
//
// `location` is { lat, lon, label } | null -- the shape sketches.py now
// stores and returns end to end (Sketch.location_label), so there's no
// separate "resolve a label live" step the way the old component had:
// a location already found via EXIF/Gemini (scene_analysis.py, Case A --
// the field shows up already filled in) or picked from a search result
// (Case B) always arrives with its label attached. Clicking the X clears
// both the field and the stored location together.
export default function LocationSearchField({ location, onLocationChange }) {
  const [query, setQuery] = useState(location?.label || '')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  const debounceRef = useRef(null)
  // Guards against re-searching for text we just set ourselves (syncing
  // from a prop change, or right after a pick/clear) -- only an actual
  // keystroke from the sketcher should trigger a new search.
  const skipNextSearchRef = useRef(true)

  useEffect(() => {
    skipNextSearchRef.current = true
    setQuery(location?.label || '')
    setResults([])
    setSearchError(null)
  }, [location?.lat, location?.lon, location?.label])

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearchError(null)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const { data } = await api.get('/api/geocode/search', { params: { q } })
        setResults(data)
        if (data.length === 0) setSearchError('No matches found.')
      } catch {
        setSearchError('Location search is temporarily unavailable.')
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  function handlePick(result) {
    skipNextSearchRef.current = true
    setQuery(result.label)
    setResults([])
    onLocationChange({ lat: result.lat, lon: result.lon, label: result.label })
  }

  function handleClear() {
    skipNextSearchRef.current = true
    setQuery('')
    setResults([])
    setSearchError(null)
    onLocationChange(null)
  }

  return (
    <div className="relative">
      <div className="relative">
        <span
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink/40"
          aria-hidden="true"
        >
          🔍
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a place…"
          className="w-full rounded-lg border border-black/15 py-2.5 pl-9 pr-9 text-sm transition-colors focus:border-ink/40"
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear location"
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-sm text-ink/40 transition-colors hover:bg-black/5 hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>

      {searching && <p className="mt-1 text-xs text-ink/50">Searching…</p>}
      {searchError && !searching && <p className="mt-1 text-xs text-accent">{searchError}</p>}

      {results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-black/15 bg-white p-1 shadow-lg">
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handlePick(r)}
              className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-black/5"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
