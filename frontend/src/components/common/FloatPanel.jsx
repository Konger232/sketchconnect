import { useEffect, useRef } from 'react'
import Icon from './Icon'

/**
 * The one floating frame for the community pages (design handoff,
 * design_handoff_community): white, rounded by --float-radius, with a
 * shadow. Three placements:
 *
 *   modal     centred over a scrim (Edit profile, Edit kit, Share).
 *   popover   absolute, inside the nearest relative parent, at `top` px and
 *             right 0 (PaintEditor, under the row it edits).
 *   card      absolute at `top` / `left` px, no scrim, on any screen (the
 *             map pin card in SketchListMapView).
 *
 * On a phone (under 768px) a modal or popover becomes a bottom sheet over
 * a scrim, rounded at the top only. A card stays a card.
 *
 * Header: `title` as a kicker and a close button. `footer`: the action row
 * (Cancel, Save). Escape and a tap on the scrim close it. Sizes, colours
 * and the radius are tokens in index.css (--float-*); only the position is
 * inline, as CSS variables.
 */
export default function FloatPanel({
  open = true,
  placement = 'modal',
  title,
  onClose,
  footer,
  top = 0,
  left,
  width,
  className = '',
  bodyClassName = '',
  children,
}) {
  const panelRef = useRef(null)
  const sheet = placement !== 'card'
  // The latest onClose, so Escape always calls it without re-running the
  // effects below. A parent often passes a new function on every render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Escape closes it.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Focus moves into the panel once, when it opens. Not on every render:
  // that would pull focus out of a field after each keystroke.
  useEffect(() => {
    if (open && !panelRef.current?.contains(document.activeElement)) panelRef.current?.focus()
  }, [open])

  // A modal stops the page scrolling behind it, as SketchModal does.
  useEffect(() => {
    if (!open || placement !== 'modal') return
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = before }
  }, [open, placement])

  if (!open) return null

  const frame = {
    modal: 'md:relative md:z-[1501] md:max-h-[86vh] md:w-[var(--float-w,var(--float-modal-w))]',
    popover: 'md:absolute md:right-0 md:top-[var(--float-top)] md:z-30 md:max-h-[640px] md:w-[var(--float-w,var(--float-popover-w))]',
    card: 'absolute left-[var(--float-left)] top-[var(--float-top)] z-[500] w-[var(--float-w,var(--float-card-w))]',
  }[placement]

  // Position and width are the only inline values: CSS variables the
  // classes above read.
  const vars = { '--float-top': `${top}px` }
  if (left != null) vars['--float-left'] = `${left}px`
  if (width) vars['--float-w'] = width

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={placement === 'modal' ? 'true' : undefined}
      aria-label={typeof title === 'string' ? title : undefined}
      tabIndex={-1}
      className={`float-panel outline-none ${sheet ? 'float-sheet' : ''} ${frame} ${className}`}
      style={vars}
    >
      {(title || onClose) && (
        <div className="float-head">
          <span className="ed-kicker">{title}</span>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close" className="ed-icon-btn -mr-2 h-8 w-8">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      )}
      <div className={`float-body ${bodyClassName}`}>{children}</div>
      {footer && <div className="float-foot">{footer}</div>}
    </div>
  )

  if (placement === 'card') return panel

  if (placement === 'modal') {
    return (
      <div className="float-scrim flex items-end justify-center md:items-center md:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
        {panel}
      </div>
    )
  }

  // Popover: a scrim on a phone only, where it is a bottom sheet.
  return (
    <>
      <div className="float-scrim md:hidden" onMouseDown={onClose} />
      {panel}
    </>
  )
}
