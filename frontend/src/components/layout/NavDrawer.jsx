import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import icoCamera from '../../assets/images/ico-camera.png'
import icoCalendar from '../../assets/images/ico-calendar.png'
import icoHome from '../../assets/images/ico-home.png'
import icoProfile from '../../assets/images/ico-profile.png' //smiley face

const linkStyle = 'flex items-center gap-2.5 text-base font-semibold text-ink no-underline py-3 border-b border-[#eee]'
// Text-only rows (no icon) reuse the same look via this variant instead of
// hand-copying the class string.
const textLinkStyle = 'text-base font-semibold text-ink no-underline py-3 border-b border-[#eee]'

/**
 * Ported from SketchConnect_ClaudeDesign/Header.dc.html's <nav> drawer —
 * the same drawer opens from either the mobile menu icon or the wide
 * layout's profile icon. Two entirely different link lists depending on
 * auth state (not just a Settings/Sign-out toggle, per the source):
 * logged in gets Capture / Workshop Calendar / Settings / Sign out under a
 * black profile header block; logged out gets Home / Explore Sketches /
 * About / Contact / Login / Register with no profile block.
 */
export default function NavDrawer({ open, onClose }) {
  const { user, profile, displayName, signOut } = useAuth()
  const loggedIn = Boolean(user)
  const location = useLocation()
  // Mobile's dedicated camera icon in Header is currently commented out,
  // so this drawer link is the actual mobile entry point into the capture
  // wizard -- needs the same backgroundLocation state as Header's desktop
  // camera icon so App.jsx's Router() can render /capture as a fullscreen
  // modal takeover instead of a plain navigation.
  const captureLinkState = { backgroundLocation: location }

  return (
    <>
      {/* z-[1500]/[1501], not the original z-[200]/[201] -- Leaflet's own
          zoom/attribution controls default to z-index: 1000 regardless of
          DOM nesting, so a page with a <LocationMap> open underneath this
          drawer (e.g. SketchDetailPage) had its +/- zoom buttons visibly
          poke through on top of the drawer. Bumped above even
          CapturePage's own modal z-[1400] so the drawer always wins if
          both ever ended up open at once. */}
      {open && <div className="fixed inset-0 z-[1500] bg-black/40" onClick={onClose} />}
      <nav
        className={`fixed right-0 top-0 z-[1501] flex h-full w-[300px] max-w-[85vw] flex-col overflow-y-auto bg-white shadow-xl transition-transform duration-300 ease-out md:w-[360px] ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {loggedIn ? (
          <div className="relative flex flex-shrink-0 items-center gap-4 bg-ink px-6 py-6 text-white">
            <button onClick={onClose} aria-label="Close menu" className="absolute right-4 top-3 px-2 py-1 text-2xl leading-none text-white transition-colors hover:text-white/70">
              &times;
            </button>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-mono text-[9px] text-white/60">photo</span>
              )}
            </div>
            <span className="text-lg font-semibold text-white">{displayName}</span>
          </div>
        ) : (
          <div className="flex flex-shrink-0 justify-end px-6 pt-4">
            <button onClick={onClose} aria-label="Close menu" className="px-2 py-1 text-2xl leading-none text-ink transition-colors hover:text-ink/60">
              &times;
            </button>
          </div>
        )}

        <div className="flex flex-col px-6 pb-6 pt-5">
          {loggedIn ? (
            <>
              <Link to="/capture" state={captureLinkState} onClick={onClose} className={linkStyle}>
                <img src={icoCamera} alt="" className="h-5 w-5" /> Capture
              </Link>
              <Link to="/workshops" onClick={onClose} className={linkStyle}>
                <img src={icoCalendar} alt="" className="h-5 w-5" /> Workshop Calendar
              </Link>
              <Link to="/profile/edit" onClick={onClose} className={textLinkStyle}>
                Edit Profile
              </Link>
              <Link to="/settings" onClick={onClose} className={textLinkStyle}>
                Settings
              </Link>
              <button
                onClick={() => { onClose(); signOut() }}
                className="mt-5 py-3 text-left text-base font-semibold text-ink"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/" onClick={onClose} className={linkStyle}>
                <img src={icoHome} alt="" className="h-5 w-5" /> Home
              </Link>
              <a href="/explore" className={textLinkStyle}>
                Explore Sketches
              </a>
              <a href="/about" className={textLinkStyle}>
                About
              </a>
              <a href="/contact" className={textLinkStyle}>
                Contact
              </a>
              <Link to="/login" onClick={onClose} className={`${linkStyle} mt-5`}>
                <img src={icoProfile} alt="" className="h-5 w-5" /> Login
              </Link>
              <Link to="/login?mode=register" onClick={onClose} className="py-3 text-base font-semibold text-ink no-underline">
                Register
              </Link>
            </>
          )}
        </div>
      </nav>
    </>
  )
}
