import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'

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
        {/* Location Icon */}
        <svg viewBox="0 0 24.00 24.00" fill="none" xmlns="http://www.w3.org/2000/svg"
         className={`w-4 h-4 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm ${dark ? 'text-white/50' : 'text-ink/60'}`}
          aria-hidden="true">
          <g id="SVGRepo_bgCarrier" stroke-width="0"></g>
          <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g>
          <g id="SVGRepo_iconCarrier"> 
            <path d="M12 21C15.5 17.4 19 14.1764 19 10.2C19 6.22355 15.866 3 12 3C8.13401 3 5 6.22355 5 10.2C5 14.1764 8.5 17.4 12 21Z" 
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> 
            <path d="M12 13C13.6569 13 15 11.6569 15 10C15 8.34315 13.6569 7 12 7C10.3431 7 9 8.34315 9 10C9 11.6569 10.3431 13 12 13Z" 
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> 
          </g>
        </svg>
        {query && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear location"
            className={`absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-sm transition-colors ${
              dark ? 'text-white/50 hover:bg-white/10 hover:text-white' : 'text-ink/40 hover:bg-black/5 hover:text-ink'
            }`}
          >
            ✕
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
