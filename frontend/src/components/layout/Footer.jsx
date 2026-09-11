import logo from '../../assets/images/logo-white-on-black.png'

const LINKS = [
  { label: 'Volunteer', href: '/volunteer' },
  { label: 'Donate', href: '/donate' },
  { label: 'Education', href: '/education' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
  { label: 'Privacy Policy', href: '/privacy' },
]

/**
 * Ported directly from SketchConnect_ClaudeDesign/Footer.dc.html, with one
 * deliberate mobile-only departure: the source's own layout stacked logo
 * above nav with a horizontal divider on narrow screens. Logo+nav are now
 * wrapped in their own row (`md:contents` makes that wrapper vanish at the
 * md breakpoint, so desktop's three-column row -- logo, nav, follow-us --
 * is unchanged) so nav sits to the right of the logo with a vertical
 * divider between them on mobile too, not just at md: and up.
 */
export default function Footer() {
  return (
    <footer className="flex w-full flex-col items-start gap-6 bg-ink px-6 py-8 text-white md:flex-row md:px-12 md:py-11 md:gap-[60px] lg:px-[60px]">
      <div className="flex w-full flex-row items-start gap-4 md:contents">
        <img src={logo} alt="SketchConnect" className="block h-[40px] w-auto shrink-0 rounded-md" />

        <div
          className="flex flex-1 flex-col items-end gap-2 border-l pl-4 font-hand text-sm md:items-start md:gap-2.5 md:pl-8 md:text-lg"
          style={{ borderColor: 'rgba(255,255,255,0.3)' }}
        >
          {LINKS.map(({ label, href }) => (
            <a key={label} href={href} className="text-white no-underline hover:underline">
              {label}
            </a>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-start gap-3 md:items-end">
        <span className="font-hand text-ls">Follow us</span>
        <div className="flex gap-2.5">
          <a
            href="#"
            aria-label="Facebook"
            className="flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] border-white text-[15px] font-bold text-white no-underline"
          >
            f
          </a>
          <a
            href="#"
            aria-label="Instagram"
            className="flex h-8 w-8 items-center justify-center rounded-[10px] border-[1.5px] border-white"
          >
            <span className="block h-3 w-3 rounded-full border-[1.5px] border-white" />
          </a>
          <a
            href="#"
            aria-label="X"
            className="flex h-8 w-8 items-center justify-center rounded-md border-[1.5px] border-white text-sm font-bold text-white no-underline"
          >
            X
          </a>
        </div>
      </div>
    </footer>
  )
}
