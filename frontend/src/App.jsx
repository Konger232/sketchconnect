import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { supabaseConfigured } from './lib/supabaseClient'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import CapturePage from './pages/CapturePage'
import SketchFlowPage from './pages/SketchFlowPage'
import ProfilePage from './pages/ProfilePage'
import EditProfilePage from './pages/EditProfilePage'
import SketchDetailPage from './pages/SketchDetailPage'
import SearchPage from './pages/SearchPage'
import EditSketchPage from './pages/EditSketchPage'
import SettingsPage from './pages/SettingsPage'
import WorkshopsPage from './pages/WorkshopsPage'

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-8 text-center text-ink/50">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

// Shown above every page when frontend/.env is missing Supabase config --
// without this, a missing key used to crash the whole app to a blank
// white screen instead of telling you what's wrong.
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
  // fullscreen takeover (mobile) -- see CapturePage.jsx. A direct or
  // refreshed visit to /capture has no backgroundLocation, so it falls
  // through to the normal full-page route in the main <Routes> below.
  const backgroundLocation = location.state?.backgroundLocation

  return (
    <>
      <Routes location={backgroundLocation || location}>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/capture" element={<RequireAuth><CapturePage /></RequireAuth>} />
        <Route path="/sketch-flow/:sketchId" element={<RequireAuth><SketchFlowPage /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
        <Route path="/profile/edit" element={<RequireAuth><EditProfilePage /></RequireAuth>} />
        <Route path="/sketches/:sketchId" element={<SketchDetailPage />} /> {/* public: read-only for non-owners, full owner controls when signed in as the sketcher -- see SketchDetailPage.jsx */}
        <Route path="/search" element={<SearchPage />} /> {/* public, same as sketch detail -- logged-out visitors search the public recent feed */}
        <Route path="/sketches/:sketchId/edit" element={<RequireAuth><EditSketchPage /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
        <Route path="/workshops" element={<RequireAuth><WorkshopsPage /></RequireAuth>} />
      </Routes>
      {backgroundLocation && (
        <Routes>
          <Route path="/capture" element={<RequireAuth><CapturePage /></RequireAuth>} />
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
