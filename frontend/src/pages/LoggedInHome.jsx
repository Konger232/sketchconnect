import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import SketchCard from '../components/common/SketchCard'
import LocationMap from '../components/common/LocationMap'
import { useAuth } from '../components/common/AuthContext'
import { api } from '../lib/api'

/**
 * Home for a signed-in sketcher — matches the Claude Design "Home - Login
 * User" canvas: avatar + name, tabs, the sketch feed, and a Map View of
 * every sketch you've logged. (The inline search bar this canvas used to
 * show here now lives on its own page -- see the header's search icon and
 * SearchPage.jsx.)
 *
 * The "Preference" tab in that canvas isn't specified anywhere beyond its
 * label, so rather than invent content for it, it links through to the
 * existing Settings page (admired-artist-per-style) — flagged for you to
 * confirm that's what it should be.
 *
 * The sketch-grid + "Map View" block below used to be its own
 * RecentSketchesSection.jsx, shared with LoggedOutHome.jsx -- folded back
 * in here since the two pages' versions of it had drifted apart enough
 * (different grid caps, different map source) that sharing it wasn't
 * actually saving anything.
 */
export default function LoggedInHome() {
  const { profile, displayName } = useAuth()
  const location = useLocation()
  const [sketches, setSketches] = useState([])
  const [loading, setLoading] = useState(true)

  // See ProfilePage.jsx's identical comment: depends on location.key so
  // this refetches whenever something navigates back into this route
  // (e.g. Delete's navigate) even though the backgroundLocation overlay
  // trick keeps this page mounted the whole time a modal is open on top
  // of it, which an empty-deps mount effect would otherwise never redo.
  useEffect(() => {
    setLoading(true)
    api.get('/api/sketches').then(({ data }) => setSketches(data)).finally(() => setLoading(false))
  }, [location.key])

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

      <div className="mb-4 flex border-b border-black/10">
        <span className="border-b-2 border-accent pb-2 text-sm font-semibold">Sketches</span>
        <Link to="/settings" className="ml-6 pb-2 text-sm font-semibold text-ink/50 hover:text-ink">
          Preference
        </Link>
      </div>

      {loading && <p className="mt-6 text-center text-ink/50">Loading…</p>}
      {!loading && sketches.length === 0 && (
        <p className="mt-6 text-center text-ink/50">No sketches yet — go capture something!</p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        {sketches.map((s) => (
          <SketchCard key={s.id} sketch={s} />
        ))}
      </div>

      <h2 className="mt-8 text-xl font-bold">Map View</h2>
      <div className="mt-2">
        <LocationMap
          points={sketches.filter((s) => s.location).map((s) => ({ ...s.location, label: s.title }))}
        />
      </div>
    </main>
  )
}
