import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

/**
 * An "i" icon that shows a short explanation (November 25, 2026): on
 * hover with a mouse, on tap on a phone (tap again, or anywhere else, to
 * close), and on keyboard focus. Keeps the explanations out of the form
 * until someone asks for them.
 *
 *   label     the icon's name for screen readers ("About Keep it private")
 *   children  the explanation
 *   align     'left' (default) or 'right': which edge of the icon the card lines up with
 *   above     open above the icon (near the bottom of a scrolling panel)
 */
export default function InfoTip({ label, children, align = 'left', above = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  return (
    <span ref={ref} className="group relative inline-flex align-middle">
      <button type="button" aria-label={label} aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o) }}
        className="flex h-6 w-6 items-center justify-center rounded-full text-current opacity-70 hover:opacity-100 focus-visible:opacity-100">
        <Icon name="info" size={16} />
      </button>
      <span role="tooltip"
        className={`pointer-events-none absolute z-30 w-64 ${above ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} max-w-[80vw] rounded-lg bg-white px-3 py-2 text-left text-sm font-normal normal-case leading-snug tracking-normal text-ink shadow-lg ${
          align === 'right' ? 'right-0' : 'left-0'
        } ${open ? 'block' : 'hidden'} [@media(hover:hover)]:group-hover:block group-focus-within:block`}>
        {children}
      </span>
    </span>
  )
}
