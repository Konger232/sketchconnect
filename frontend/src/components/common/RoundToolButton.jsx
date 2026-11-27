/**
 * A picture button with its name under it, for "What you draw with"
 * (MediaPicker): round for the line tools, a portrait card for the colour
 * media (card). A small hop on hover; picked shows a guide-blue ring or
 * border around the picture and a bold blue label.
 * Styles: .sc-round-tool and .sc-media-card in index.css.
 */
export default function RoundToolButton({ image, label, selected = false, onClick, card = false }) {
  return (
    <button type="button" className={card ? 'sc-media-card' : 'sc-round-tool'} aria-pressed={selected} onClick={onClick}>
      {card ? (
        <img src={image} alt="" className="sc-media-card-image" draggable={false} />
      ) : (
        <span className="sc-round-tool-circle">
          <img src={image} alt="" className="h-[52px] w-[52px] object-contain" draggable={false} />
        </span>
      )}
      {label}
    </button>
  )
}
