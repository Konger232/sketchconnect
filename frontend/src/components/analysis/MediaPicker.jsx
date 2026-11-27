import { MEDIA } from '../../data/media'
import RoundToolButton from '../common/RoundToolButton'
import pencil from '../../assets/images/ico_pencil.png'
import fountainPen from '../../assets/images/ico_fountainpen.png'
import fineliner from '../../assets/images/ico_liner.png'
import dipPen from '../../assets/images/ico_dip_nib.png'
import brushPen from '../../assets/images/ico_brushpen.png'
import pearWatercolor from '../../assets/images/pear-watercolor.webp'
import pearGouache from '../../assets/images/pear-gouache.webp'
import pearMarkers from '../../assets/images/pear-markers.webp'
import pearPencils from '../../assets/images/pear-colored-pencil.webp'
import pearPastel from '../../assets/images/pear-pastel.webp'

// The line tools show as round picture buttons. The colour media show as
// portrait cards, two to a row: the same pear in each medium (November 27,
// 2026), so the difference between them is the medium itself.
const LINE_ICONS = { pencil, fountain_pen: fountainPen, fineliner, dip_pen: dipPen, brush_pen: brushPen }
const COLOR_CARDS = { watercolor: pearWatercolor, gouache: pearGouache, markers: pearMarkers, watercolor_pencils: pearPencils, pastels: pearPastel }

/**
 * "What you draw with" (design doc, item 25): the media picks, any number.
 * The tips may name only these. Shared by New Sketch and Capture's
 * Details (item 57).
 */
export default function MediaPicker({ picks, onToggle }) {
  return (
    <div className="flex flex-col gap-4">
      {MEDIA.map(({ group, items }) => (
        <div key={group} className="flex flex-col gap-2" role="group" aria-label={group}>
          <p className="sc-field-label">{group}</p>
          {group === 'Line' ? (
            <div className="flex flex-wrap gap-x-2 gap-y-3">
              {items.map(([key, name]) => (
                <RoundToolButton key={key} image={LINE_ICONS[key]} label={name} selected={picks.includes(key)} onClick={() => onToggle(key)} />
              ))}
            </div>
          ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-4">
            {items.map(([key, name]) => (
              <RoundToolButton key={key} card image={COLOR_CARDS[key]} label={name} selected={picks.includes(key)} onClick={() => onToggle(key)} />
            ))}
          </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** One group's picks, shown only (the sketch page's Tool kit). */
export function MediaPictures({ items, picks }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      {items.filter(([key]) => picks.includes(key)).map(([key, name]) => (
        <RoundToolButton key={key} card={Boolean(COLOR_CARDS[key])} image={COLOR_CARDS[key] || LINE_ICONS[key]} label={name} />
      ))}
    </div>
  )
}
