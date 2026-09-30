import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import Icon from './Icon'

// A single, compact search field for a sketch's own location 
// `location` is { lat, lon, label } | null -- the shape sketches.py now
// stores and returns end to end (Sketch.location_label), so there's no
// separate "resolve a label live" step the way the old component had:
// a location already found via EXIF/Gemini (scene_analysis.py, Case A --
// the field shows up already filled in) or picked from a search result
// (Case B) always arrives with its label attached. Clicking the X clears
// both the field and the stored location together.
//
// `dark` (default false) switches the whole field -- input, icon, clear
// button, "Searching…" label, and the results dropdown -- to sit on a
// dark panel (EditSketch.jsx's bg-gray-820 control panel) instead of the
// light one it was originally built for (SearchPage.jsx). A plain
// className prop wouldn't have covered this: several of these pieces
// (the results dropdown's own background, the clear button's hover
// state) need genuinely different classes on dark, not just an
// additional override.
export default function LocationSearchField({ location, onLocationChange, dark = false }) {
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
        
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a place…"
          className={`w-full rounded-lg border py-2.5 pl-3 pr-9 text-sm transition-colors ${
            dark
              ? 'border-white/15 bg-gray-800 text-white/80 focus:border-white/40'
              : 'border-black/15 focus:border-ink/60'
          }`}
        />
        {/* Location pin; hidden while the clear button sits in its place */}
        {!query && (
          <Icon
            name="location-outline"
            size={14}
            className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 ${dark ? 'text-white/50' : 'text-ink/60'}`}
          />
        )}
        {query && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear location"
            className={`absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-sm transition-colors ${
              dark ? 'text-white/50 hover:bg-white/10 hover:text-white' : 'text-ink/40 hover:bg-black/5 hover:text-ink'
            }`}
          >
            <Icon name="close" size={10} className="h-2.5 w-2.5" />
          </button>
        )}
      </div>

      {searching && <p className={`mt-1 text-xs ${dark ? 'text-white/50' : 'text-ink/50'}`}>Searching…</p>}
      {searchError && !searching && <p className="mt-1 text-xs text-accent">{searchError}</p>}

      {results.length > 0 && (
        <div className={`absolute z-10 mt-1 w-full rounded-lg border p-1 shadow-lg ${dark ? 'border-white/15 bg-gray-800' : 'border-black/15 bg-white'}`}>
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handlePick(r)}
              className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${dark ? 'text-white/80 hover:bg-white/10' : 'hover:bg-black/5'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
