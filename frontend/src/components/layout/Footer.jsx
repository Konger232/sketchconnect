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
 * Ported directly from SketchConnect_ClaudeDesign/Footer.dc.html: real
 * logo image, column layout with a top divider on mobile that becomes a
 * row layout with a left divider at the md breakpoint (768px, matching
 * the source's own isMobile check), and the exact Facebook/Instagram/X
 * glyph markup rather than approximated icon characters.
 */
export default function Footer() {
  return (
    <footer className="flex w-full flex-col items-start gap-6 bg-ink px-6 py-8 text-white md:flex-row md:px-12 md:py-11 md:gap-[60px] lg:px-[60px]">
      <img src={logo} alt="SketchConnect" className="block h-[60px] w-auto rounded-md" />

      <div
        className="flex flex-1 flex-col gap-2.5 border-t pt-5 font-hand text-lg md:border-l md:border-t-0 md:pl-8 md:pt-0"
        style={{ borderColor: 'rgba(255,255,255,0.3)' }}
      >
        {LINKS.map(({ label, href }) => (
          <a key={label} href={href} className="text-white no-underline hover:underline">
            {label}
          </a>
        ))}
      </div>

      <div className="flex flex-col items-start gap-3 md:items-end">
        <span className="font-hand text-lg">Follow us</span>
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
