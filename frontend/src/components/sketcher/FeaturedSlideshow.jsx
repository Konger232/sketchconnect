import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../common/Icon'
import { imageUrl } from '../../lib/media'

const ADVANCE_MS = 6000

/**
 * The Sketcher page's featured slideshow (design handoff): up to 5
 * sketches at 4:5. It moves on every 6 seconds and stops for good after any
 * tap or click. Prev and next, "n / 5" and segment bars. Each slide opens
 * its Sketch Detail.
 */
export default function FeaturedSlideshow({ sketches }) {
  const [slide, setSlide] = useState(0)
  const stopped = useRef(false)
  const count = sketches.length

  useEffect(() => {
    if (count < 2) return
    const id = setInterval(() => { if (!stopped.current) setSlide((s) => (s + 1) % count) }, ADVANCE_MS)
    return () => clearInterval(id)
  }, [count])

  if (count === 0) return <span className="ed-slide" aria-hidden="true" />

  const go = (i) => { stopped.current = true; setSlide((i + count) % count) }
  const s = sketches[slide % count]

  return (
    <div className="flex flex-col gap-3">
      <Link to={`/sketches/${s.id}`} className="ed-slide" onClick={() => { stopped.current = true }}>
        {(s.final_sketch_url || s.reference_image_url) && (
          <img src={imageUrl(s.final_sketch_url || s.reference_image_url)} alt={s.title || 'Featured sketch'} />
        )}
      </Link>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {s.place && <div className="ed-kicker">{s.place}</div>}
          <div className="truncate text-lg">{s.title || 'Untitled sketch'}</div>
        </div>
        {count > 1 && (
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" className="ed-icon-btn" onClick={() => go(slide - 1)} aria-label="Previous sketch">
              <Icon name="chevron-left" size={16} />
            </button>
            <span className="w-10 text-center text-sm font-semibold">{slide + 1} / {count}</span>
            <button type="button" className="ed-icon-btn" onClick={() => go(slide + 1)} aria-label="Next sketch">
              <Icon name="chevron-right" size={16} />
            </button>
          </div>
        )}
      </div>
      {count > 1 && (
        <div className="ed-segments">
          {sketches.map((x, i) => (
            <button key={x.id} type="button" aria-current={i === slide} aria-label={`Sketch ${i + 1}`} onClick={() => go(i)} />
          ))}
        </div>
      )}
    </div>
  )
}
