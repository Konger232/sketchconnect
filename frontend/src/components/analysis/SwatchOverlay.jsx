import { useRef, useState } from 'react'

const DRAG_START = 4 // px of movement before a press becomes a drag
const OUT = 0.04 // how far past the photo's edge counts as "dragged out"

/**
 * "Your colours" over the reference photo (design doc, item 37), like an
 * interior designer's paint chips held up to a wall. The collected colours
 * stack in the top right corner. Drag one onto the photo to compare it
 * with that spot; its place is saved (x, y from 0 to 1, from the top left)
 * and goes to the critique. Drag one off the photo to take it out. Tap one
 * to see how to mix it.
 *
 * Sits inside StripImage's `overlay`, which matches the painted photo.
 *
 *   swatches [{ h, c, hex, x?, y? }]
 *   selected, onSelect(swatch)
 *   onPlace(hex, { x, y })   dropped on the photo
 *   onRemove(hex)            dragged off the photo
 */
export default function SwatchOverlay({ swatches, selected, onSelect, onPlace, onRemove }) {
  const boxRef = useRef(null)
  const press = useRef(null)
  const [drag, setDrag] = useState(null) // { hex, x, y, out }

  function at(e) {
    const r = boxRef.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const isOut = ({ x, y }) => x < -OUT || x > 1 + OUT || y < -OUT || y > 1 + OUT

  function down(e, s) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    press.current = { s, sx: e.clientX, sy: e.clientY, moved: false }
  }
  function move(e) {
    const p = press.current
    if (!p) return
    if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < DRAG_START) return
    p.moved = true
    const q = at(e)
    setDrag({ hex: p.s.hex, ...q, out: isOut(q) })
  }
  function up(e) {
    const p = press.current
    press.current = null
    setDrag(null)
    if (!p) return
    e.stopPropagation()
    if (!p.moved) { onSelect({ ...p.s, from: 'wheel' }); return }
    const q = at(e)
    if (isOut(q)) onRemove(p.s.hex)
    else onPlace(p.s.hex, { x: Math.min(1, Math.max(0, q.x)), y: Math.min(1, Math.max(0, q.y)) })
  }

  const chip = (s, style) => {
    const on = selected?.from === 'wheel' && selected.hex === s.hex
    const dragging = drag?.hex === s.hex
    return (
      <button key={s.hex} type="button" aria-label="Your colour: drag it onto the photo to compare, off the photo to take it out, or tap to see how to mix it"
        title="Drag onto the photo to compare. Drag off to take it out."
        onPointerDown={(e) => down(e, s)} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { press.current = null; setDrag(null) }}
        onClick={(e) => e.stopPropagation()}
        className={`pointer-events-auto h-8 w-8 touch-none cursor-grab border border-white shadow-[0_1px_4px_rgba(0,0,0,0.5)] active:cursor-grabbing ${
          on ? 'outline outline-2 outline-offset-1 outline-white' : ''
        } ${dragging ? 'z-20' : ''} ${dragging && drag.out ? 'opacity-40' : ''}`}
        style={{ background: s.hex, ...style }} />
    )
  }
  // One layer for all the chips, so a chip keeps its element (and the
  // pointer) when it leaves the stack. Unplaced chips stack in the corner.
  const posOf = (s) => (drag?.hex === s.hex ? drag : s.x != null ? s : null)
  let slot = 0
  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0">
      {swatches.map((s) => {
        const p = posOf(s)
        return chip(s, p
          ? { position: 'absolute', left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: 'translate(-50%, -50%)' }
          : { position: 'absolute', right: 8, top: 8 + 38 * slot++ })
      })}
    </div>
  )
}
