import { useEffect } from 'react'
import Icon from './Icon'

/**
 * The dark modal shell for New Sketch (CreateSketch.jsx) and Edit Sketch
 * (EditSketch.jsx), from the design handoff.
 *
 *   header   close (x) on the left, the title centred
 *   body     children, laid out by the page: the photo stage on the left
 *            (flex-1) and the right panel (.sc-panel, 340px on iPad,
 *            380px on desktop). Under 768px they stack.
 *
 * iPad: full screen. Desktop: at most --modal-max-w x --modal-max-h,
 * centred over the --modal-scrim. Page scroll behind it is off while open.
 */
export default function SketchModal({ title, onClose, children }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-[var(--modal-scrim)]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full flex-col overflow-hidden bg-sc-modal font-sans text-sc-text
                   lg:max-h-[var(--modal-max-h)] lg:max-w-[var(--modal-max-w)] lg:rounded-[var(--modal-radius)] lg:shadow-2xl"
      >
        <div className="relative flex h-14 shrink-0 items-center border-b border-sc-divider px-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="relative z-10 flex h-11 w-11 items-center justify-center text-white"
          >
            <Icon name="close" size={16} />
          </button>
          <span className="pointer-events-none absolute inset-x-0 text-center font-heading text-title font-bold">
            {title}
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  )
}
