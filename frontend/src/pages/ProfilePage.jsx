import { useEffect, useState } from 'react'
import Header from '../components/common/Header'
import SketchCard from '../components/common/SketchCard'
import { useAuth } from '../components/common/AuthContext'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../lib/api'

// Profile / journey screen: avatar + name, "Sketches" feed — matches the
// Figma "Later in the evening" flow. Feedback Summary is the same data
// viewed per-sketch (see EditSketch) rather than a separate fetch.
export default function ProfilePage() {
  const { profile, displayName } = useAuth()
  const location = useLocation()
  const [sketches, setSketches] = useState([])
  const [loading, setLoading] = useState(true)

  // Depends on location.key, not []. This page stays mounted underneath
  // EditSketch the whole time it's open (the backgroundLocation
  // overlay trick), and Delete's navigate('/profile') is a same-pathname
  // forward navigation into a page that's already rendered -- React Router
  // doesn't remount a component just because you navigated to the route
  // it's already showing, so an empty-deps mount effect would never refire
  // and this list would keep showing a just-deleted sketch. location.key
  // changes on every real navigation into this route (even a repeat of the
  // same pathname), so it refetches then, without also refetching on
  // every unrelated re-render.
  useEffect(() => {
    setLoading(true)
    api.get('/api/sketches').then(({ data }) => setSketches(data)).finally(() => setLoading(false))
  }, [location.key])

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-2xl px-4 pb-16">
        <div className="mt-4 flex items-center gap-3">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-black/10">
            {profile?.avatar_url && (
              <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div>
            <p className="text-xl font-semibold">{displayName}</p>
            {/* <Link to="/profile/edit" className="text-sm text-blue-600 underline">
              Edit profile
            </Link> */}
          </div>
        </div>

        <div className="mt-4 border-b border-black/10">
          <span className="inline-block border-b-2 border-accent pb-2 text-sm font-semibold">Sketches</span>
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
      </main>
    </div>
  )
}
