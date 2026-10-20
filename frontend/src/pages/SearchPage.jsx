import Header from '../components/common/Header'
import Footer from '../components/common/Footer'
import SketchSearch from '../components/common/SketchSearch'

/**
 * Generic search (design doc, Search): one box for a sketcher's name, a
 * sketch title, or a place. Shared sketches, and the sketcher's own drafts,
 * newest first. The map-first search by place is Explore (/explore).
 */
export default function SearchPage() {
  return (
    <div className="bg-white">
      <Header />
      <main className="ed-page">
        <SketchSearch autoFocus />
      </main>
      <Footer />
    </div>
  )
}
