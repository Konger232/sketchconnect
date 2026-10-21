import BasePage from '../components/common/BasePage'
import SketchSearch from '../components/common/SketchSearch'

/**
 * Generic search (design doc, Search): one box for a sketcher's name, a
 * sketch title, or a place. Completed (shared) sketches only, newest
 * first. The map-first search by place is Explore (/explore).
 */
export default function SearchPage() {
  return (
    <BasePage>
      <SketchSearch autoFocus />
    </BasePage>
  )
}
