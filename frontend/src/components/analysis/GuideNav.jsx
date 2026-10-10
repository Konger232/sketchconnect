import Button from '../common/Button'
import Icon from '../common/Icon'

/**
 * Back and Next above a guide question, the same row in New Sketch and
 * Edit Sketch (AIGuidance.jsx). Back shows only with onBack, Next only
 * with onNext, at the right; nextDisabled keeps Next in place but off.
 */
export default function GuideNav({ onBack, onNext, nextDisabled = false }) {
  return (
    <div className="flex items-center justify-between">
      {onBack ? (
        <Button variant="quietOnDark" size="sm" className="-ml-3 flex items-center gap-1" onClick={onBack}>
          <Icon name="chevron-left" size={14} />
          Back
        </Button>
      ) : <span />}
      {onNext && (
        <Button variant="quietOnDark" size="sm" className="-mr-3 flex items-center gap-1" onClick={onNext} disabled={nextDisabled}>
          Next
          <Icon name="chevron-right" size={14} />
        </Button>
      )}
    </div>
  )
}
