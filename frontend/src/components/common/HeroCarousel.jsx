import { useRef, useState } from 'react'
import Icon from './Icon'

/**
 * The sketch page's top slideshow (November 14, 2026): swipe on a phone,
 * the arrows on a computer. A counter ("2 / 5") in the corner and each
 * picture's name ("Final", "Sketch 2", "Reference") at the bottom.
 *
 *   slides     [{ src, label }]
 *   className  the frame's size: e.g. 'md:h-[520px]'. Without a height the
 *              frame takes the first picture's shape (a phone: no bars).
 *   dark       a black frame around pictures of another shape (desktop)
 */
export default function HeroCarousel({ slides, className = '', dark = false, alt = 'Sketch' }) {
  const track = useRef(null)
  const [index, setIndex] = useState(0)
  const [ratio, setRatio] = useState(null) // the first picture's width / height

  const go = (i) => {
    const el = track.current
    if (!el) return
    const n = Math.max(0, Math.min(slides.length - 1, i))
    el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' })
  }
  const onScroll = () => {
    const el = track.current
    if (el) setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
  }
  if (!slides.length) return null

  return (
    <div className={`relative ${dark ? 'bg-black' : 'bg-[var(--ed-field-bg)]'} ${className}`}
      style={!/\bh-\[/.test(className) && ratio ? { aspectRatio: ratio } : undefined}>
      <div ref={track} onScroll={onScroll}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {slides.map((sl, i) => (
          <div key={sl.src + i} className="flex h-full w-full shrink-0 snap-center items-center justify-center">
            <img src={sl.src} alt={`${alt}: ${sl.label}`} draggable={false}
              onLoad={i === 0 ? (e) => setRatio(e.target.naturalWidth / Math.max(1, e.target.naturalHeight)) : undefined}
              className="max-h-full max-w-full object-contain" />
          </div>
        ))}
      </div>

      {slides.length > 1 && (
        <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">
          {index + 1} / {slides.length}
        </span>
      )}
      <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">
        {slides[index]?.label}
      </span>

      {slides.length > 1 && (
        <>
          {index > 0 && (
            <button type="button" onClick={() => go(index - 1)} aria-label="Previous picture"
              className="absolute left-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow md:flex">
              <Icon name="chevron-left" size={18} />
            </button>
          )}
          {index < slides.length - 1 && (
            <button type="button" onClick={() => go(index + 1)} aria-label="Next picture"
              className="absolute right-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow md:flex">
              <Icon name="chevron-right" size={18} />
            </button>
          )}
          {/* Dots: where you are, and a tap jumps there. */}
          <span className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
            {slides.map((sl, i) => (
              <button key={i} type="button" onClick={() => go(i)} aria-label={`Show ${sl.label}`}
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/60'}`} />
            ))}
          </span>
        </>
      )}
    </div>
  )
}
