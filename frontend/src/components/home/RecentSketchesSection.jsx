import SketchCard from '../common/SketchCard'
import LocationMap from '../map/LocationMap'

/**
 * The sketch-grid + "Map View" block, extracted out of LoggedInHome.jsx
 * and LoggedOutHome.jsx -- the one piece of genuinely identical markup
 * shared between those two otherwise quite different Home views (profile
 * header + Sketches/Preference tabs vs. a marketing shell). Everything
 * else -- the search bar, loading/empty-state copy, which API endpoint
 * feeds the list -- stays in each page, since that differs meaningfully
 * between "your own sketches, searched" and "recent sketches near you".
 *
 * `gridSketches` and `mapSketches` are separate props, not one shared
 * list, because both original pages deliberately showed a wider set of
 * pins on the map than tiles in the grid above it (LoggedInHome's grid
 * respects the search filter but its map didn't; LoggedOutHome's grid
 * was capped to 4 sketches but its map wasn't) -- `mapSketches` defaults
 * to `gridSketches` for a caller that doesn't need the two to differ.
 */
export default function RecentSketchesSection({ gridSketches, mapSketches = gridSketches }) {
  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {gridSketches.map((s) => (
          <SketchCard key={s.id} sketch={s} />
        ))}
      </div>

      <h2 className="mt-8 text-xl font-bold">Map View</h2>
      <div className="mt-2">
        <LocationMap
          points={mapSketches.filter((s) => s.location).map((s) => ({ ...s.location, label: s.title }))}
        />
      </div>
    </>
  )
}
