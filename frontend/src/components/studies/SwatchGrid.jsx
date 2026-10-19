/**
 * "Your colours": the tiles the sketcher collected from the wheel, as a
 * swatch grid under the photo (design doc, item 37). Tap one to see how
 * to mix it.
 */
export default function SwatchGrid({ swatches, selected, onSelect }) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 px-4 pb-1 pt-3">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-sc-text3">Your colours</span>
      {swatches.length === 0 ? (
        <span className="text-sm text-sc-text3">Tap tiles on the wheel to collect them here.</span>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {swatches.map((s, i) => {
            const on = selected && selected.from === 'wheel' && selected.hex === s.hex
            return (
              <button key={i} type="button" onClick={() => onSelect({ ...s, from: 'wheel' })} aria-label="See how to mix this colour" aria-pressed={on}
                className={`h-8 w-8 border ${on ? 'border-white outline outline-2 outline-white' : 'border-[#cccccc]/70'}`} style={{ background: s.hex }} />
            )
          })}
        </div>
      )}
    </div>
  )
}
