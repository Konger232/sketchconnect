import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import NavDrawer from './NavDrawer'
import logo from '../../assets/images/logo-black-on-white.png'
import icoCamera from '../../assets/images/ico-camera.png'
import icoAnchor from '../../assets/images/ico-anchor.png'
import icoCalendar from '../../assets/images/ico-calendar.png'
import icoProfile from '../../assets/images/ico-profile.png'

/**
 * Ported directly from SketchConnect_ClaudeDesign/Header.dc.html (the
 * downloaded Claude Design project HTML) — not approximated from a
 * screenshot. That file defines two layouts switched on viewport width
 * (<768px vs >=768px); reproduced here with Tailwind's `md:` breakpoint
 * (768px) instead of a JS resize listener, which is equivalent to the
 * source's own `isMobile = width < 768` check.
 *
 * Mobile: logo left, camera("Add")+menu icons right.
 * Wide (md+): camera/anchor("Explore")/calendar("Workshops") icons left,
 * centered logo, profile icon right (opens the same nav drawer as menu).
 * showAdd is always true here — neither Home page in the source passes it
 * false — and /explore has no page yet, matching /workshops' route name
 * but not (yet) implemented.
 */
export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  // The capture wizard (CapturePage) renders as a modal overlay on top
  // of whatever page is open (desktop/tablet) or a fullscreen takeover
  // (mobile) -- see App.jsx's Router(). Passing the current location as
  // backgroundLocation is what tells App.jsx to keep rendering this
  // page underneath instead of navigating away from it.
  const captureLinkState = { backgroundLocation: location }

  return (
    <>
      <header className="sticky top-0 z-[100] flex items-center justify-between border-b border-black/30 bg-paper px-5 py-2 md:px-10 md:py-[22px] lg:px-[60px]">
        {/* Mobile layout -- logo shown 30% smaller than the tablet/desktop
            version below (55x57 vs 78x82) to leave more room in a narrow
            header; the search bar that lives inline on the Home pages has
            no room here, so it collapses down to just a magnifying-glass
            icon next to the hamburger instead of a full input. Both icons
            are inline Tailwind-styled SVGs (no custom PNG assets) so they
            pick up currentColor and stay crisp at any size/DPI. */}
        <div className="flex w-full items-center justify-between md:hidden">
          <Link to="/" className="flex items-center">
            <img src={logo} alt="SketchConnect" className="block h-[50px] w-[52px] rounded-md" />
          </Link>
          <div className="flex items-center gap-1">
            <button onClick={() => navigate('/search')} aria-label="Search" className="flex items-center justify-center p-2 text-ink/50 hover:text-ink">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.2" y2="16.2" />
              </svg>
            </button>
            <button onClick={() => setMenuOpen(true)} aria-label="Open menu" className="flex items-center justify-center p-2 text-ink/50 hover:text-ink">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Wide (tablet/desktop) layout. relative + absolute-centering on
            the logo, not just a plain flex sibling with justify-between --
            the left icon group (3 icons) and the right side (1 icon) are
            different widths, so justify-between was centering the logo
            between two UNEQUAL siblings, not on the header itself, and it
            sat visibly left of true center. Taking it out of the flex flow
            and centering it against the whole row fixes that regardless of
            how wide either side ends up being. */}
        <div className="relative hidden w-full items-center justify-between md:flex">
          <div className="flex items-center gap-7">
            <Link to="/capture" state={captureLinkState} aria-label="Capture" className="flex items-center justify-center">
              <img src={icoCamera} alt="Capture" className="h-8 w-8 object-contain" />
            </Link>
            <Link to="/explore" aria-label="Explore" className="flex items-center justify-center">
              <img src={icoAnchor} alt="Explore" className="h-8 w-8 object-contain" />
            </Link>
            <Link to="/workshops" aria-label="Workshop Calendar" className="flex items-center justify-center">
              <img src={icoCalendar} alt="Workshop Calendar" className="h-8 w-8 object-contain" />
            </Link>
          </div>
          <Link to="/" className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center">
            <img src={logo} alt="SketchConnect" className="block h-[78px] w-[82px] rounded-md" />
          </Link>
          <div className="flex items-center gap-5">
            <button onClick={() => navigate('/search')} aria-label="Search" className="flex items-center justify-center text-ink/50 hover:text-ink">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.2" y2="16.2" />
              </svg>
            </button>
            <button onClick={() => setMenuOpen(true)} aria-label="Account menu" className="flex items-center justify-center">
              <img src={icoProfile} alt="Account" className="h-9 w-9 object-contain" />
            </button>
          </div>
        </div>
      </header>
      <NavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  )
}
