import { useRef, useState } from 'react'

const HEADER = 44 // the modal's header on a phone (SketchModal, h-11)
const TOP_GAP = 8

/**
 * The phone's bottom sheet (.sc-sheet, under 768px) is dragged by its
 * handle: up to just under the modal's header for more room, or down to
 * the handle and the tabs. A tap on the handle still folds or opens it.
 * From 768px the panel is not a sheet, and nothing here applies.
 *
 *   const sheet = useSheetDrag(sheetOpen, setSheetOpen)
 *   <div ref={sheet.ref} className={`sc-panel sc-sheet ${sheet.className}`} style={sheet.style}>
 *     <button className="sc-sheet-handle" {...sheet.handleProps}>…   (no onClick of its own)
 */
export function useSheetDrag(open, setOpen) {
  const ref = useRef(null)
  const drag = useRef(null)
  const dragged = useRef(false) // the last press was a drag, not a tap
  const [height, setHeight] = useState(null) // null: the CSS height
  const isPhone = () => window.innerWidth < 768

  // The folded height: the handle and the tabs.
  const minHeight = () => {
    const el = ref.current
    const handle = el?.querySelector('.sc-sheet-handle')?.offsetHeight || 24
    const tabs = el?.querySelector('.sc-tabs')?.offsetHeight || 0
    return handle + tabs
  }
  const maxHeight = () => window.innerHeight - HEADER - TOP_GAP

  const handleProps = {
    onPointerDown(e) {
      if (!isPhone() || !ref.current) return
      drag.current = { y: e.clientY, h: ref.current.getBoundingClientRect().height, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove(e) {
      const d = drag.current
      if (!d) return
      const dy = e.clientY - d.y
      if (!d.moved && Math.abs(dy) < 5) return
      d.moved = true
      if (!open) setOpen(true)
      setHeight(Math.max(minHeight(), Math.min(maxHeight(), d.h - dy)))
    },
    onPointerUp() {
      const d = drag.current
      drag.current = null
      dragged.current = Boolean(d?.moved)
      if (!d?.moved) return
      // Dropped near the bottom: folded to the handle and the tabs.
      if (height != null && height < minHeight() + 40) { setHeight(null); setOpen(false) }
    },
    // A tap folds or opens the sheet; a drag does not.
    onClick() {
      if (dragged.current) { dragged.current = false; return }
      setHeight(null)
      setOpen((v) => !v)
    },
  }

  return {
    ref,
    handleProps,
    className: height != null && open ? 'max-md:h-[var(--sheet-h)] max-md:!max-h-none' : '',
    style: height != null && open ? { '--sheet-h': `${height}px` } : undefined,
  }
}
