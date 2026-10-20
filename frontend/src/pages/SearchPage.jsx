import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Header from '../components/common/Header'
import Footer from '../components/common/Footer'
import Icon from '../components/common/Icon'
import SketchListMapView from '../components/common/SketchListMapView'
import { api } from '../lib/api'
import { dateLabel, imageUrl } from '../lib/media'

/**
 * Generic search (design doc, Search): one box for a sketcher's name, a
 * sketch title, or a place (a town, a city, a country). Shared sketches
 * only, newest first, in the same GRID / MAP view as the Sketcher page.
 * The map-first search by place is Explore (/explore).
 */
export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') || '')
  const [results, setResults] = useState(null) // null: nothing searched yet
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    const q = query.trim()
    setParams(q ? { q } : {}, { replace: true })
    clearTimeout(timer.current)
    if (q.length < 2) { setResults(null); setError(null); return }
    timer.current = setTimeout(() => {
      setLoading(true)
      setError(null)
      api.get('/api/sketches/search', { params: { q } })
        .then(({ data }) => setResults(data))
        .catch(() => setError('Search is not available right now.'))
        .finally(() => setLoading(false))
    }, 400)
    return () => clearTimeout(timer.current)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = (results || []).map((s) => ({
    id: s.id,
    title: s.title,
    meta: [s.owner?.display_name || s.owner?.handle, s.location?.label].filter(Boolean).join(' · '),
    date: dateLabel(s.created_at),
    place: s.location?.label,
    lat: s.location?.lat,
    lon: s.location?.lon,
    image: imageUrl(s.final_sketch_url || s.reference_image_url),
  }))

  return (
    <div className="bg-white">
      <Header />
      <main className="ed-page flex flex-col gap-6">
        <label className="flex items-center gap-3 border-b border-ink/40 pb-2 focus-within:border-ink">
          <Icon name="search" size={18} className="text-ink/60" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sketchers, sketch titles or places"
            aria-label="Search sketchers, sketch titles or places"
            className="w-full bg-transparent py-1 text-lg outline-none placeholder:text-ink/40"
          />
        </label>
        {error && <p className="m-0 text-sm text-accent">{error}</p>}
        {loading && <p className="m-0 animate-pulse text-sm text-ink/60">Searching…</p>}
        {!loading && results === null && !error && (
          <p className="m-0 text-sm text-ink/60">Try a sketcher's name, a title, or a place such as Kyoto or Thailand.</p>
        )}
        {!loading && results !== null && (
          <SketchListMapView items={items} cols={4} emptyText={`No shared sketches match "${query.trim()}".`} />
        )}
      </main>
      <Footer />
    </div>
  )
}
