import Header from '../components/common/Header'
import Footer from '../components/common/Footer'
import LoggedInHome from './LoggedInHome'
import LoggedOutHome from './LoggedOutHome'
import { useAuth } from '../components/common/AuthContext'

// Landing / home screen. Header now manages its own nav drawer, so this
// page only decides which body to render: a signed-in sketcher sees their
// own profile-style feed (LoggedInHome); everyone else sees the public,
// GPS-aware "recent sketches near you" view (LoggedOutHome), matching the
// Claude Design "Home - Login User" canvas.
export default function HomePage() {
  const { user, loading } = useAuth()

  return (
    <div>
      <Header />
      {loading ? (
        <p className="mt-10 text-center text-ink/50">Loading…</p>
      ) : user ? (
        <LoggedInHome />
      ) : (
        <LoggedOutHome />
      )}
      <Footer />
    </div>
  )
}
