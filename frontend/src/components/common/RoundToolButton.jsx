/**
 * A round button with a picture and its name under it, such as the line
 * tools in "What you draw with" (MediaPicker). Grey, a small hop on hover,
 * the guide blue when picked. Styles: .sc-round-tool in index.css.
 */
export default function RoundToolButton({ image, label, selected = false, onClick }) {
  return (
    <button type="button" className="sc-round-tool" aria-pressed={selected} onClick={onClick}>
      <span className="sc-round-tool-circle">
        <img src={image} alt="" className="h-9 w-9 object-contain" draggable={false} />
      </span>
      {label}
    </button>
  )
}
