import Header from './Header'
import Footer from './Footer'

/**
 * The base page every full page builds on (VisitorHome, RegisteredUserHome,
 * the Sketcher page, SketchDetail, Search, Explore, Login, Workshops): the
 * Header, a <main>, and the Footer at the bottom of the window however short
 * the page is. One place for the page width, background and responsive
 * steps (index.css .ed-page).
 *
 *   children        the page's content, inside <main>
 *   detail          SketchDetail's tighter section gap (.ed-page--detail)
 *   mainClassName   replaces the .ed-page main (e.g. Login's narrow form)
 *   footer          false: no footer (RegisteredUserHome, Explore)
 *   fullBleed       the main fills the window under the header, no
 *                   scrolling (Explore's map)
 *   overlays        panels and modals, after the footer
 */
export default function BasePage({
  children, detail = false, mainClassName, footer = true, fullBleed = false, overlays = null, className = 'bg-white',
}) {
  const main = fullBleed
    ? 'relative min-h-0 flex-1'
    : `${mainClassName ?? `ed-page ${detail ? 'ed-page--detail' : ''}`} w-full flex-1`
  return (
    <div className={`flex flex-col ${fullBleed ? 'h-[100dvh]' : 'min-h-[100dvh]'} ${className}`}>
      <Header />
      <main className={main}>{children}</main>
      {footer && !fullBleed && <Footer />}
      {overlays}
    </div>
  )
}

// A one-line page: loading, not found, an error.
export function PageMessage({ children, muted = false }) {
  return (
    <BasePage>
      <p className={muted ? 'text-ink/50' : 'text-ink/60'}>{children}</p>
    </BasePage>
  )
}
