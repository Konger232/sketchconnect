import { useEffect, useState } from 'react'
import Header from '../components/layout/Header'
import SketchCard from '../components/common/SketchCard'
import { useAuth } from '../context/AuthContext'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

// Profile / journey screen: avatar + name, "Sketches" feed — matches the
// Figma "Later in the evening" flow. Feedback Summary is the same data
// viewed per-sketch (see SketchDetailPage) rather than a separate fetch.
export default function ProfilePage() {
  const { profile, displayName } = useAuth()
  const [sketches, setSketches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/api/sketches').then(({ data }) => setSketches(data)).finally(() => setLoading(false))
  }, [])

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
            <Link to="/profile/edit" className="text-sm text-blue-600 underline">
              Edit profile
            </Link>
          </div>
        </div>

        <div className="mt-4 border-b border-black/10">
          <span className="inline-block border-b-2 border-accent pb-2 text-sm font-semibold">Sketches</span>
        </div>

        {loading && <p className="mt-6 text-center text-ink/50">Loading…</p>}
        {!loading && sketches.length === 0 && (
          <p className="mt-6 text-center text-ink/50">No sketches yet — go capture something!</p>
        )}
        {sketches.map((s) => (
          <SketchCard key={s.id} sketch={s} />
        ))}
      </main>
    </div>
  )
}
