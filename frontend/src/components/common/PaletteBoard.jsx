import { useState } from 'react'
import GamutWheel from '../analysis/GamutWheel'
import PaintPills from './PaintPills'
import PanGrid from './PanGrid'

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
 *   onPaintDown(paint, e)          a press on a circle or a pill
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
}) {
  const [own, setOwn] = useState(null) // read-only: the paint picked here
  const driven = onPaintDown != null
  const focus = driven ? focusId : own
  const pick = (id) => setOwn((was) => (was === id ? null : id))
  const home = focus ? layout.pans.find((p) => p.paint === focus) : null
  const panSel = driven ? selectedPan : home ? { r: home.r, c: home.c } : null

  return (
    <div ref={stageRef} className="relative grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-10">
      <div ref={wheelRef} className="pb-4">
        <GamutWheel paints={paints} readOnly light ringPaint={focus} legend={driven ? undefined : null}
          onPaintDown={driven ? onPaintDown : (p) => pick(p.id)} {...wheel} />
      </div>
      <div className="flex flex-col gap-3">
        {tinTop}
        <div>
          <PanGrid layout={layout} editable={editable} selected={panSel} dropAt={dropAt}
            onPanDown={driven ? onPanDown : (p) => p.paint && pick(p.paint)} />
        </div>
        <PaintPills paints={paints} focusId={focus} placed={placed} showNames={showNames}
          onPillDown={driven ? onPaintDown : (p) => pick(p.id)}>
          {pillsEnd}
        </PaintPills>
        {tinBottom}
      </div>
      {overlay}
    </div>
  )
}
