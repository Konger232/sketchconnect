import Button from '../common/Button'

// Retired (design doc, item 17): focal points became marks, and the
// capture flow no longer has this step. Nothing imports this file; it can
// be deleted. Reticle lives in Reticle.jsx now.
export { Reticle } from './Reticle'

/**
 * The Focal points step controls (New Sketch, step 3): Undo, Clear, and
 * how many of the cap are placed. The points are tapped on the photo.
 */
export default function FocalSpotPicker({ count, cap, onUndo, onClear, disabled }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondaryOnDark" className="px-3.5 text-base" onClick={onUndo} disabled={disabled || count === 0}>
        Undo
      </Button>
      <Button variant="secondaryOnDark" className="px-3.5 text-base" onClick={onClear} disabled={disabled || count === 0}>
        Clear
      </Button>
      <span className="ml-auto whitespace-nowrap text-sm font-semibold text-sc-text3">
        {count} of {cap} placed
      </span>
    </div>
  )
}
