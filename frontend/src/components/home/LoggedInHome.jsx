import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import RecentSketchesSection from './RecentSketchesSection'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../lib/api'

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
 */
export default function LoggedInHome() {
  const { profile, displayName } = useAuth()
  const [sketches, setSketches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/api/sketches').then(({ data }) => setSketches(data)).finally(() => setLoading(false))
  }, [])

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
      <RecentSketchesSection gridSketches={sketches} mapSketches={sketches} />
    </main>
  )
}
