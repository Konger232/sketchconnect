/**
 * A picture button: round for the line tools, a portrait card (`card`) for
 * the colour media. Without onClick it only shows the picture, smaller,
 * with no hover, ring or blue: the sketch page's Tool kit (November 27, 2026).
 */
export default function RoundToolButton({ image, label, selected = false, onClick, card = false }) {
  const shown = !onClick
  const Tag = shown ? 'span' : 'button'
  const props = shown ? {} : { type: 'button', 'aria-pressed': selected, onClick }
  return (
    <Tag className={`${card ? 'sc-media-card' : 'sc-round-tool'}${shown ? ' is-shown' : ''}`} {...props}>
      {card ? (
        <img src={image} alt="" className="sc-media-card-image" draggable={false} />
      ) : (
        <span className="sc-round-tool-circle">
          <img src={image} alt="" className="sc-round-tool-image" draggable={false} />
        </span>
      )}
      {label}
    </Tag>
  )
}
