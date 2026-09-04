import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import icoCamera from '../../assets/images/ico-camera.png'
import icoCalendar from '../../assets/images/ico-calendar.png'
import icoHome from '../../assets/images/ico-home.png'
import icoProfile from '../../assets/images/ico-profile.png' //smiley face

const linkStyle = 'flex items-center gap-2.5 text-[22px] font-bold text-ink no-underline py-3.5 border-b border-[#eee]'

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
  const { user, profile, signOut } = useAuth()
  const loggedIn = Boolean(user)
  const displayName = profile?.display_name || user?.user_metadata?.full_name || user?.email

  return (
    <>
      {open && <div className="fixed inset-0 z-[200] bg-black/40" onClick={onClose} />}
      <nav
        className={`fixed right-0 top-0 z-[201] flex h-full w-[300px] max-w-[85vw] flex-col overflow-y-auto bg-white shadow-xl transition-transform duration-300 ease-out md:w-[360px] ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {loggedIn ? (
          <div className="relative flex flex-shrink-0 items-center gap-4 bg-ink px-8 py-7 pb-6 text-white">
            <button onClick={onClose} aria-label="Close menu" className="absolute right-4 top-2 px-2 py-1 text-[28px] leading-none text-white">
              &times;
            </button>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-mono text-[9px] text-white/60">photo</span>
              )}
            </div>
            <span className="text-[22px] font-bold text-white">{displayName}</span>
          </div>
        ) : (
          <div className="flex flex-shrink-0 justify-end px-8 pt-5">
            <button onClick={onClose} aria-label="Close menu" className="px-2 py-1 text-[28px] leading-none text-ink">
              &times;
            </button>
          </div>
        )}

        <div className="flex flex-col px-8 pb-7 pt-6">
          {loggedIn ? (
            <>
              <Link to="/capture" onClick={onClose} className={linkStyle}>
                <img src={icoCamera} alt="" className="h-[26px] w-[26px]" /> Capture
              </Link>
              <Link to="/workshops" onClick={onClose} className={linkStyle}>
                <img src={icoCalendar} alt="" className="h-[26px] w-[26px]" /> Workshop Calendar
              </Link>
              <Link to="/profile/edit" onClick={onClose} className="border-b border-[#eee] py-3.5 text-[22px] font-bold text-ink no-underline">
                Edit Profile
              </Link>
              <Link to="/settings" onClick={onClose} className="border-b border-[#eee] py-3.5 text-[22px] font-bold text-ink no-underline">
                Settings
              </Link>
              <button
                onClick={() => { onClose(); signOut() }}
                className="mt-5 py-3.5 text-left text-[22px] font-bold text-ink"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/" onClick={onClose} className={linkStyle}>
                <img src={icoHome} alt="" className="h-[26px] w-[26px]" /> Home
              </Link>
              <a href="/explore" className="border-b border-[#eee] py-3.5 text-[22px] font-bold text-ink no-underline">
                Explore Sketches
              </a>
              <a href="/about" className="border-b border-[#eee] py-3.5 text-[22px] font-bold text-ink no-underline">
                About
              </a>
              <a href="/contact" className="border-b border-[#eee] py-3.5 text-[22px] font-bold text-ink no-underline">
                Contact
              </a>
              <Link to="/login" onClick={onClose} className={`${linkStyle} mt-5`}>
                <img src={icoProfile} alt="" className="h-[26px] w-[26px]" /> Login
              </Link>
              <Link to="/login?mode=register" onClick={onClose} className="py-3.5 text-[22px] font-bold text-ink no-underline">
                Register
              </Link>
            </>
          )}
        </div>
      </nav>
    </>
  )
}
