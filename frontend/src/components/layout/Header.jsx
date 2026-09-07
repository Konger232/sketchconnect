import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import NavDrawer from './NavDrawer'
import logo from '../../assets/images/logo-black-on-white.png'
import icoCamera from '../../assets/images/ico-camera.png'
import icoMenu from '../../assets/images/ico-menu.png'
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
  // The capture wizard (CapturePage) renders as a modal overlay on top
  // of whatever page is open (desktop/tablet) or a fullscreen takeover
  // (mobile) -- see App.jsx's Router(). Passing the current location as
  // backgroundLocation is what tells App.jsx to keep rendering this
  // page underneath instead of navigating away from it.
  const captureLinkState = { backgroundLocation: location }

  return (
    <>
      <header
        className="sticky top-0 z-[100] flex items-center justify-between border-b px-5 py-4 md:px-10 md:py-[22px] lg:px-[60px]"
        style={{ background: 'var(--sc-bg)', borderColor: 'rgba(0,0,0,0.06)' }}
      >
        {/* Mobile layout */}
        <div className="flex w-full items-center justify-between md:hidden">
          <Link to="/" className="flex items-center">
            <img src={logo} alt="SketchConnect" className="block h-[78px] w-[82px] rounded-md" />
          </Link>
          <div className="flex items-center gap-3.5">
            {/* <Link
              to="/capture"
              aria-label="Add sketch"
              className="flex h-[70px] w-[70px] items-center justify-center rounded-full border-2"
              style={{ borderColor: 'var(--sc-accent)' }}
            >
              <img src={icoCamera} alt="Add" className="h-[62%] w-[62%] object-cover" />
            </Link> */}
            <button onClick={() => setMenuOpen(true)} aria-label="Open menu" className="flex items-center justify-center p-2">
              <img src={icoMenu} alt="Menu" className="block h-10 w-10" />
            </button>
          </div>
        </div>

        {/* Wide (tablet/desktop) layout */}
        <div className="hidden w-full items-center justify-between md:flex">
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
          <Link to="/" className="flex items-center">
            <img src={logo} alt="SketchConnect" className="block h-[78px] w-[82px] rounded-md" />
          </Link>
          <button onClick={() => setMenuOpen(true)} aria-label="Account menu" className="flex items-center justify-center">
            <img src={icoProfile} alt="Account" className="h-9 w-9 object-contain" />
          </button>
        </div>
      </header>
      <NavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  )
}
