import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

/**
 * The photo stage as a sideways-scrolling strip (EditSketch): Reference
 * photo, Plan, Final sketch, each with its label underneath. Scrolls and
 * snaps like the photo strip in the Feedback panel. With more than one
 * panel, each is a little narrower than the stage so the next one peeks
 * in. Widths: --strip-* tokens in index.css.
 *
 *   panels: [{ key, label, content }]   content fills the panel
 *   ref.show(key)                       scrolls that panel into view
 *   focusKey                            panel shown when the strip opens
 *
 * The Plan panel is GuideStage, whose Guides rail sits inside it, so the
 * rail is only on screen while the Plan is.
 */
const StageStrip = forwardRef(function StageStrip({ panels, focusKey }, ref) {
  const scrollerRef = useRef(null)
  const itemRefs = useRef({})
  const many = panels.length > 1

  function show(key, behavior = 'smooth') {
    itemRefs.current[key]?.scrollIntoView({ behavior, block: 'nearest', inline: 'center' })
  }
  useImperativeHandle(ref, () => ({ show }))

  // Open on focusKey, without an animated scroll.
  useEffect(() => {
    if (focusKey) show(focusKey, 'instant')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={scrollerRef}
      className={`flex min-h-[60vh] flex-1 snap-x snap-mandatory bg-sc-modal md:min-h-0 ${
        many ? 'gap-[var(--strip-gap)] overflow-x-auto px-[var(--strip-gap)]' : ''
      }`}
      aria-label="Photos"
    >
      {panels.map((p) => (
        <figure
          key={p.key}
          ref={(el) => { itemRefs.current[p.key] = el }}
          className={`relative flex shrink-0 snap-center flex-col ${many ? 'w-[var(--strip-panel-width)]' : 'w-full'}`}
        >
          <div className="relative flex min-h-0 flex-1 flex-col">{p.content}</div>
          <figcaption className="shrink-0 pb-4 pt-1 text-center text-base font-bold text-white">{p.label}</figcaption>
        </figure>
      ))}
    </div>
  )
})

export default StageStrip

// A plain photo filling a panel, inset like GuideStage's photo.
export function StripImage({ src, alt }) {
  return (
    <div className="relative min-h-0 flex-1">
      <div className="absolute inset-3 md:inset-[var(--stage-inset)]">
        <img src={src} alt={alt} className="h-full w-full object-contain" />
      </div>
    </div>
  )
}
