import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './components/common/AuthContext'
import { supabaseConfigured } from './lib/supabaseClient'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import CreateSketch from './pages/CreateSketch'
import EditSketch from './pages/EditSketch'
import SearchPage from './pages/SearchPage'
import Explore from './pages/Explore'
import YourWork from './pages/YourWork'
import SketcherProfile from './pages/SketcherProfile'
import SketchDetail from './pages/SketchDetail'
import WorkshopsPage from './pages/WorkshopsPage'

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-8 text-center text-ink/50">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

// Pages for registered sketchers only. A visitor goes to the Register
// page, and comes back here after joining (design doc: visitors see the
// visitor Home only).
function MembersOnly({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="p-8 text-center text-ink/50">Loading…</div>
  if (!user) return <Navigate to="/login?mode=register" replace state={{ from: location.pathname }} />
  return children
}

// The old Edit Profile address: your own page, with the panel open.
function EditProfileRedirect() {
  const { profile } = useAuth()
  return <Navigate to={profile?.username ? `/sketchers/${profile.username}?edit=profile` : '/'} replace />
}

// Universal error message for DB 
function ConfigWarningBanner() {
  if (supabaseConfigured) return null
  return (
    <div className="bg-accent px-4 py-2 text-center text-sm text-paper">
      Supabase isn't configured — fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
      in frontend/.env, then restart the dev server.
    </div>
  )
}

function Router() {
  const location = useLocation()
  // When Header/NavDrawer navigate to /capture, they pass the page the
  // sketcher was on as backgroundLocation (see Header.jsx). If it's
  // present, we render the *background* page via the routes below at its
  // own location (so it stays mounted/current underneath), then render
  // /capture a second time, on top, as a modal (desktop/tablet) or
  // fullscreen takeover (mobile) -- see CreateSketch.jsx. A direct or
  // refreshed visit to /capture has no backgroundLocation, so it falls
  // through to the normal full-page route in the main <Routes> below.
  const backgroundLocation = location.state?.backgroundLocation

  return (
    <>
      <Routes location={backgroundLocation || location}>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/capture" element={<RequireAuth><CreateSketch /></RequireAuth>} />
        <Route path="/sketchers/:username" element={<MembersOnly><SketcherProfile /></MembersOnly>} /> {/* owner and member views */}
        <Route path="/sketches/:sketchId" element={<MembersOnly><SketchDetail /></MembersOnly>} /> {/* owner and member views */}
        <Route path="/sketches/:sketchId/edit" element={<RequireAuth><EditSketch /></RequireAuth>} />
        <Route path="/search" element={<MembersOnly><SearchPage /></MembersOnly>} /> {/* search sketches by sketcher, title or place */}
        <Route path="/explore" element={<MembersOnly><Explore /></MembersOnly>} /> {/* the map of sketches */}
        <Route path="/your-work" element={<YourWork />} /> {/* public: how sketchers' work is protected */}
        {/* Old pages, now folded into the Sketcher page */}
        <Route path="/profile" element={<Navigate to="/" replace />} />
        <Route path="/profile/edit" element={<RequireAuth><EditProfileRedirect /></RequireAuth>} />
        <Route path="/settings" element={<Navigate to="/" replace />} />
        <Route path="/workshops" element={<RequireAuth><WorkshopsPage /></RequireAuth>} />
      </Routes>
      {/* When a route below was reached with backgroundLocation in its nav
          state (SketchCard.jsx clicking a card, Header.jsx's capture icon),
          the <Routes> above rendered the *background* page at that stashed
          location, and this second <Routes> -- which has no `location`
          prop, so it always matches the real current URL -- renders the
          modal on top of it. A direct or refreshed visit to either route
          has no backgroundLocation, so it only ever matches once, above,
          as a normal full-page route. */}
      {backgroundLocation && (
        <Routes>
          <Route path="/capture" element={<RequireAuth><CreateSketch /></RequireAuth>} />
          <Route path="/sketches/:sketchId/edit" element={<RequireAuth><EditSketch /></RequireAuth>} />
        </Routes>
      )}
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ConfigWarningBanner />
      <Router />
    </AuthProvider>
  )
}
