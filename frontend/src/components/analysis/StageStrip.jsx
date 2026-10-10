import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

/**
 * The photo stage as a sideways-scrolling strip (EditSketch): Reference
 * photo, Plan, Final sketch. Each panel is the full width of the stage, so
 * the photo gets all the room there is (October 6, 2026; it used to be a
 * little narrower so the next panel peeked in). A row of labels under the
 * strip names every panel, marks the one on screen, and scrolls to the
 * one tapped. With one panel, the row shows just its label.
 *
 *   panels: [{ key, label, content }]   content fills the panel
 *   ref.show(key)                       scrolls that panel into view
 *   focusKey                            panel shown when the strip opens
 *
 * On a phone the strip is as tall as its tallest photo; from 768px it
 * fills the left side of the modal.
 */
const StageStrip = forwardRef(function StageStrip({ panels, focusKey }, ref) {
  const scrollerRef = useRef(null)
  const many = panels.length > 1
  const [current, setCurrent] = useState(focusKey || panels[0]?.key)

  // Scrolls the strip itself, not the page: scrollIntoView did nothing on a
  // phone while the photos were still loading (the strip had no height yet).
  function show(key, behavior = 'smooth') {
    const el = scrollerRef.current
    const index = panels.findIndex((p) => p.key === key)
    if (el && index >= 0) el.scrollTo({ left: index * el.clientWidth, behavior })
    setCurrent(key)
  }
  useImperativeHandle(ref, () => ({ show }))

  // Open on focusKey, without an animated scroll.
  useEffect(() => {
    if (focusKey) show(focusKey, 'instant')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The panel on screen, after a swipe.
  function handleScroll(e) {
    const el = e.currentTarget
    if (!el.clientWidth) return
    const index = Math.round(el.scrollLeft / el.clientWidth)
    const key = panels[index]?.key
    if (key && key !== current) setCurrent(key)
  }

  return (
    <div className="flex shrink-0 flex-col bg-sc-modal md:min-h-0 md:flex-1 md:shrink" aria-label="Photos">
      <div
        ref={scrollerRef}
        onScroll={many ? handleScroll : undefined}
        className={`flex md:min-h-0 md:flex-1 ${many ? 'snap-x snap-mandatory overflow-x-auto' : ''}`}
      >
        {panels.map((p) => (
          <figure
            key={p.key}
            aria-label={p.label}
            className="relative flex w-full shrink-0 snap-center flex-col"
          >
            <div className="relative flex min-h-0 flex-1 flex-col">{p.content}</div>
          </figure>
        ))}
      </div>
      <div className="flex shrink-0 justify-center gap-5 pb-3 pt-2" role={many ? 'tablist' : undefined}>
        {panels.map((p) => (
          <button
            key={p.key}
            type="button"
            role={many ? 'tab' : undefined}
            aria-selected={many ? current === p.key : undefined}
            disabled={!many}
            onClick={() => show(p.key)}
            className={`text-base font-bold ${current === p.key || !many ? 'text-white/80' : 'text-sc-text3 hover:text-white/95'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
})

export default StageStrip

// A plain photo filling a panel: the full width of the stage. On a phone
// it sits in the flow at its own height (at most 75vh); from 768px it fills
// the panel, inset top and bottom only.
export function StripImage({ src, alt }) {
  return (
    <div className="relative min-h-0 flex-1">
      <div className="relative md:absolute md:inset-x-0 md:inset-y-[var(--stage-inset)]">
        <img src={src} alt={alt} className="block h-auto max-h-[75vh] w-full object-contain md:h-full md:max-h-none" />
      </div>
    </div>
  )
}
