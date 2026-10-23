import { useRef, useState } from 'react'
import GamutWheel from '../analysis/GamutWheel'
import PaintPills from './PaintPills'
import PanGrid from './PanGrid'
import PaintTip, { OpacityLegend } from './PaintTip'

/**
 * My palette, one picture in three parts (design doc, items 45 and 46):
 * the paints on the Yurmby wheel (left), the tin's pans (right) and the
 * paints as pills under the tin. Picking a paint in any part picks it in
 * the other two: its circle ringed, its pan and its pill outlined.
 *
 * On the Sketcher page it is read-only and keeps its own pick. Edit
 * palette drives it: the pick (focusId, selectedPan), the presses (to drag
 * or tap), the wheel's taps, and what goes above and below the tin.
 *
 *   paints [paint], layout         the palette and the tin
 *   focusId, selectedPan           the pick (Edit palette)
 *   onPaintDown(paint, e, from)    a press on a circle ('wheel') or a pill ('pill')
 *   wheelTitle, tinTitle           "My paint collection", "My tin"
 *   wheelNote, tinNote             how to use each (Edit palette)
 *   onPanDown(pan, e)              a press on a pan
 *   wheel                          more GamutWheel props (onTapWheel, selected)
 *   editable, placed, dropAt       Edit palette: drag pans, dashed pills
 *   tinTop, tinBottom, pillsEnd    Edit palette's controls
 *   stageRef, wheelRef, overlay    Edit palette's floating form
 */
export default function PaletteBoard({
  paints, layout, focusId, selectedPan, onPaintDown, onPanDown, wheel = {},
  editable = false, placed, dropAt, showNames = false,
  tinTop, tinBottom, pillsEnd, stageRef, wheelRef, overlay,
  wheelTitle = 'My paint collection', tinTitle = 'My tin', wheelNote, tinNote,
}) {
  const [own, setOwn] = useState(null) // read-only: the paint picked here
  const [tip, setTip] = useState(null) // { paint, x, y }: a pill or pan under the mouse
  const boxRef = useRef(null)
  const setBox = (el) => { boxRef.current = el; if (stageRef) stageRef.current = el }
  function hover(paint, el) {
    if (!paint || !el || !boxRef.current) return setTip(null)
    const b = boxRef.current.getBoundingClientRect(), r = el.getBoundingClientRect()
    setTip({ paint, x: r.left + r.width / 2 - b.left, y: r.top - b.top })
  }
  const driven = onPaintDown != null
  const focus = driven ? focusId : own
  const pick = (id) => setOwn((was) => (was === id ? null : id))
  const home = focus ? layout.pans.find((p) => p.paint === focus) : null
  const panSel = driven ? selectedPan : home ? { r: home.r, c: home.c } : null

  return (
    <div ref={setBox} className="relative grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-10">
      <div ref={wheelRef} className="flex flex-col gap-3 pb-4">
        <span className="ed-caption">{wheelTitle}</span>
        {wheelNote && <div className="-mt-1 text-sm text-ink/70">{wheelNote}</div>}
        <GamutWheel paints={paints} readOnly light ringPaint={focus} legend={null}
          onPaintDown={driven ? (p, e) => onPaintDown(p, e, 'wheel') : (p) => pick(p.id)} {...wheel} />
        <div className="mt-3 flex justify-center"><OpacityLegend /></div>
      </div>
      <div className="flex flex-col gap-3">
        <span className="ed-caption">{tinTitle}</span>
        {tinNote && <div className="-mt-1 text-sm text-ink/70">{tinNote}</div>}
        {tinTop}
        <div>
          <PanGrid layout={layout} editable={editable} selected={panSel} dropAt={dropAt}
            onPanDown={driven ? onPanDown : (p) => p.paint && pick(p.paint)} onHover={hover} />
        </div>
        <PaintPills paints={paints} focusId={focus} placed={placed} showNames={showNames}
          onPillDown={driven ? (p, e) => onPaintDown(p, e, 'pill') : (p) => pick(p.id)} onHover={hover}>
          {pillsEnd}
        </PaintPills>
        {tinBottom}
      </div>
      {tip && <PaintTip paint={tip.paint} x={tip.x} y={tip.y} />}
      {overlay}
    </div>
  )
}
