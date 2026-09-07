import { useState } from 'react'

/**
 * Ported directly from SketchConnect_ClaudeDesign/SpotCard.dc.html: a 4:3
 * photo tile (not square), a heart-glyph favorite toggle sized/positioned
 * to spec, an optional multi-photo dot indicator, and name/location text
 * beneath with the source's exact sizes, weights and colors.
 */
export default function SpotCard({ photoUrl, images, name, location, onClick }) {
  const photos = images?.length ? images : photoUrl ? [photoUrl] : []
  const [index, setIndex] = useState(0)
  const [liked, setLiked] = useState(false)
  const activePhoto = photos[index % Math.max(photos.length, 1)]

  return (
    <button type="button" onClick={onClick} className="flex flex-col text-left">
      <div className="sc-photo-placeholder relative aspect-[4/3] overflow-hidden rounded-[14px]">
        {activePhoto && <img src={activePhoto} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); setLiked((f) => !f) }}
          aria-label="Save"
          className="absolute right-2.5 top-2.5 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white/85 text-[15px]"
        >
          {liked ? '♥' : '♡'}
        </span>
        {photos.length > 1 && (
          <div className="sc-dots">
            {photos.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => { e.stopPropagation(); setIndex(i) }}
                aria-label="Show image"
                className="sc-dot"
                style={{ background: i === index ? 'var(--sc-ink)' : '#ccc' }}
              />
            ))}
          </div>
        )}
      </div>
      <div className="mt-2.5 pl-2.5 font-heading text-[17px] font-bold text-ink">{name}</div>
      {location && <div className="pl-2.5 text-sm" style={{ color: 'var(--sc-text-faint)' }}>{location}</div>}
    </button>
  )
}
