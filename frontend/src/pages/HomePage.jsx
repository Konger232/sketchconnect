import Header from '../components/common/Header'
import Footer from '../components/common/Footer'
import LoggedOutHome from './LoggedOutHome'
import Sketcher from './Sketcher'
import { useAuth } from '../components/common/AuthContext'

// Home. A signed-in sketcher lands on their own Sketcher page (design doc,
// item 36). Everyone else sees the public, GPS-aware recent sketches.
export default function HomePage() {
  const { user, profile, loading } = useAuth()

  if (user && profile?.handle) return <Sketcher handle={profile.handle} />

  return (
    <div>
      <Header />
      {loading || (user && !profile) ? (
        <p className="mt-10 text-center text-ink/50">Loading…</p>
      ) : (
        <LoggedOutHome />
      )}
      <Footer />
    </div>
  )
}
