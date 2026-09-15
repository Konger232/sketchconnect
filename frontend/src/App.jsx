import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './components/common/AuthContext'
import { supabaseConfigured } from './lib/supabaseClient'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import CreateSketch from './pages/CreateSketch'
import SketchFlowPage from './pages/SketchFlowPage'
import ProfilePage from './pages/ProfilePage'
import EditProfilePage from './pages/EditProfilePage'
import EditSketch from './pages/EditSketch'
import SearchPage from './pages/SearchPage'
import SettingsPage from './pages/SettingsPage'
import WorkshopsPage from './pages/WorkshopsPage'

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-8 text-center text-ink/50">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return children
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
        <Route path="/sketch-flow/:sketchId" element={<RequireAuth><SketchFlowPage /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
        <Route path="/profile/edit" element={<RequireAuth><EditProfilePage /></RequireAuth>} />
        <Route path="/sketches/:sketchId" element={<EditSketch />} /> {/* public: read-only for non-owners, full owner controls when signed in as the sketcher -- see EditSketch.jsx */}
        <Route path="/search" element={<SearchPage />} /> {/* public, same as EditSketch.jsx -- logged-out visitors search the public recent feed */}
        <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
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
          <Route path="/sketches/:sketchId" element={<EditSketch />} />
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
