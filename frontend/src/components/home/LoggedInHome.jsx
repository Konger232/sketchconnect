import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import SketchCard from '../sketch/SketchCard'
import LocationMap from '../map/LocationMap'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../lib/api'

/**
 * Home for a signed-in sketcher — matches the Claude Design "Home - Login
 * User" canvas: avatar + name, a search-your-own-sketches bar, tabs, the
 * sketch feed, and a Map View of every sketch you've logged.
 *
 * The "Preference" tab in that canvas isn't specified anywhere beyond its
 * label, so rather than invent content for it, it links through to the
 * existing Settings page (admired-artist-per-style) — flagged for you to
 * confirm that's what it should be.
 */
export default function LoggedInHome() {
  const { profile, displayName } = useAuth()
  const [sketches, setSketches] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    api.get('/api/sketches').then(({ data }) => setSketches(data)).finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sketches
    return sketches.filter((s) => (s.title || '').toLowerCase().includes(q))
  }, [sketches, query])

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16">
      <div className="mt-4 flex items-center gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-black/10">
          {profile?.avatar_url && (
            <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <p className="text-xl font-semibold">{displayName}</p>
      </div>

      <div className="my-4 flex items-center gap-2 rounded-full border border-black/15 px-4 py-3">
        <span>🔍</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your sketches..."
          className="w-full bg-transparent outline-none placeholder:text-ink/50"
        />
      </div>

      <div className="flex border-b border-black/10">
        <span className="border-b-2 border-accent pb-2 text-sm font-semibold">Sketches</span>
        <Link to="/settings" className="ml-6 pb-2 text-sm font-semibold text-ink/50 hover:text-ink">
          Preference
        </Link>
      </div>

      {loading && <p className="mt-6 text-center text-ink/50">Loading…</p>}
      {!loading && filtered.length === 0 && (
        <p className="mt-6 text-center text-ink/50">
          {query ? 'No sketches match that search.' : 'No sketches yet — go capture something!'}
        </p>
      )}
      {filtered.map((s) => (
        <SketchCard key={s.id} sketch={s} />
      ))}

      <h2 className="mt-8 text-xl font-bold">Map View</h2>
      <div className="mt-2">
        <LocationMap points={sketches.filter((s) => s.location).map((s) => ({ ...s.location, label: s.title }))} />
      </div>
    </main>
  )
}
