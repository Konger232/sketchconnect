import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FloatPanel from './FloatPanel'
import Icon from './Icon'
import SketchCard, { RATIOS } from './SketchCard'
import LocationMap from './LocationMap'
import LocationSearchField from './LocationSearchField'

/**
 * GRID / MAP tabs over a list of sketches (design handoff,
 * SketchListMapView). Used on the Sketcher page and Sketch Detail, later
 * on Home and search.
 *
 *   items      [{ id, title, meta, date, place, lat, lon, image, multi, href, linkState, sketch }]
 *              sketch: the sketch itself, for SketchCard (status and like)
 *              linkState: router state for the link (e.g. backgroundLocation,
 *              to open Edit Sketch as a modal)
 *   view       'grid' | 'map', the tab it opens on
 *   pinMode    'sketch': one pin per sketch; 'place': one count pin per place
 *   center     { lat, lon, radius }: "this sketch" dot and a dashed ring
 *              (showCenter in the handoff)
 *   cols       grid columns from 768px (2 on a phone); 3 by default
 *   ratio      the card image: 'square' (default) or 'portrait' (4:5).
 *              The app's standard is the defaults; pass these only to
 *              differ.
 *   onPlaceSelect(place)  place mode: the card's "Show these" link
 *   searchPlaces          a place search over the map, to move it (Home)
 *
 * Map: the app's LocationMap. Tapping a pin turns it red and opens a card
 * (FloatPanel, placement "card") above pins in the lower half of the map
 * and below pins in the upper half.
 */
const COLS = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4' }
const CARD_W = 220
const CARD_H = 340 // image 4:5 at 220 px, plus the caption

export default function SketchListMapView({
  items = [],
  view: initialView = 'grid',
  pinMode = 'sketch',
  center,
  cols = 3,
  ratio = 'square',
  emptyText = 'No sketches yet.',
  onPlaceSelect,
  searchPlaces = false,
}) {
  const [view, setView] = useState(initialView)
  const [picked, setPicked] = useState(null) // { key, x, y }
  const [focus, setFocus] = useState(null) // a place picked in the search over the map
  const mapRef = useRef(null)

  // A new list (a place filter) or the other tab closes an open card. Keyed
  // on the ids, so a parent re-render with the same sketches keeps it open.
  const idsKey = items.map((it) => it.id).join('|')
  useEffect(() => { setPicked(null) }, [idsKey, view])

  const located = items.filter((it) => it.lat != null && it.lon != null)

  // Place mode: one pin per place, at the average of its sketches.
  const places = useMemo(() => {
    if (pinMode !== 'place') return []
    const by = new Map()
    for (const it of located) {
      const key = it.place || 'Elsewhere'
      if (!by.has(key)) by.set(key, [])
      by.get(key).push(it)
    }
    return [...by.entries()].map(([place, list]) => ({
      key: place,
      place,
      list,
      lat: list.reduce((s, i) => s + i.lat, 0) / list.length,
      lon: list.reduce((s, i) => s + i.lon, 0) / list.length,
    }))
  }, [pinMode, located])

  const pins = [
    ...(pinMode === 'place'
      ? places.map((p) => ({ id: p.key, lat: p.lat, lon: p.lon, variant: 'count', count: p.list.length, active: picked?.key === p.key }))
      : located.map((it) => ({ id: it.id, lat: it.lat, lon: it.lon, variant: 'pin', active: picked?.key === it.id }))),
    ...(center ? [{ id: '__center', lat: center.lat, lon: center.lon, variant: 'center' }] : []),
  ]

  function pickPin(pin, pt) {
    if (picked?.key === pin.id) return setPicked(null)
    setPicked({ key: pin.id, ...pt })
  }

  // The card sits above pins in the lower half, below pins in the upper half.
  function cardPosition() {
    const box = mapRef.current?.getBoundingClientRect()
    const w = box?.width || 600
    const h = box?.height || 460
    const left = Math.max(8, Math.min(picked.x - CARD_W / 2, w - CARD_W - 8))
    const top = picked.y > h / 2 ? Math.max(8, picked.y - CARD_H - 30) : Math.min(picked.y + 12, Math.max(8, h - CARD_H - 8))
    return { left, top }
  }

  const pickedSketch = pinMode === 'sketch' && picked ? located.find((it) => it.id === picked.key) : null
  const pickedPlace = pinMode === 'place' && picked ? places.find((p) => p.key === picked.key) : null

  return (
    <div className="flex flex-col gap-5">
      <div className="ed-tabs" role="tablist">
        {['grid', 'map'].map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className="ed-tab" onClick={() => setView(v)}>
            {v}
          </button>
        ))}
        <span className="ml-auto pb-2 text-sm text-ink/70">
          {items.length} {items.length === 1 ? 'sketch' : 'sketches'}
        </span>
      </div>

      {items.length === 0 && <p className="text-sm text-ink/50">{emptyText}</p>}

      {items.length > 0 && view === 'grid' && (
        <div className={`grid grid-cols-2 gap-x-4 gap-y-6 md:gap-x-7 md:gap-y-8 ${COLS[cols] || COLS[3]}`}>
          {items.map((it) => it.sketch ? (
            // A sketch: the shared card, with its status and like.
            <SketchCard key={it.id} sketch={it.sketch} meta={it.meta} href={it.href} linkState={it.linkState} image={it.image} multi={it.multi} ratio={ratio} />
          ) : (
            <Link key={it.id} to={it.href || `/sketches/${it.id}`} state={it.linkState} className="group flex flex-col gap-2 text-ink no-underline">
              <span className="ed-slide" style={{ aspectRatio: RATIOS[ratio] || RATIOS.square }}>
                {it.image && <img src={it.image} alt="" loading="lazy" />}
                {it.multi && (
                  <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-ink" aria-label="More than one image">
                    <Icon name="stack" size={15} />
                  </span>
                )}
              </span>
              {it.meta && <span className="ed-caption">{it.meta}</span>}
              <span className="-mt-1 font-heading text-lg font-medium leading-snug group-hover:text-ink/70">{it.title || 'Untitled sketch'}</span>
            </Link>
          ))}
        </div>
      )}

      {items.length > 0 && view === 'map' && (
        <div ref={mapRef} className="relative">
          {located.length === 0 ? (
            <p className="text-sm text-ink/50">None of these sketches has a location.</p>
          ) : (
            <LocationMap
              pins={pins}
              onPinClick={pickPin}
              onMapClick={() => setPicked(null)}
              ring={center ? { lat: center.lat, lon: center.lon, radius: center.radius } : undefined}
              height="h-[420px] md:h-[520px]"
              rounded={false}
              focus={focus}
            />
          )}
          {searchPlaces && located.length > 0 && (
            <div className="absolute right-3 top-3 z-[1000] w-[min(320px,calc(100%-24px))] rounded-lg bg-white p-1.5 shadow-lg">
              <LocationSearchField location={focus} onLocationChange={(loc) => { setFocus(loc); setPicked(null) }} />
            </div>
          )}

          {pickedSketch && (
            <FloatPanel placement="card" {...cardPosition()} bodyClassName="!gap-2 !p-0">
              <div className="relative">
                <Link to={pickedSketch.href || `/sketches/${pickedSketch.id}`} className="ed-slide block">
                  {pickedSketch.image && <img src={pickedSketch.image} alt="" />}
                </Link>
                <button type="button" onClick={() => setPicked(null)} aria-label="Close" className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-ink">
                  <Icon name="close" size={11} />
                </button>
              </div>
              <Link to={pickedSketch.href || `/sketches/${pickedSketch.id}`} className="flex flex-col gap-0.5 px-3 pb-3 text-ink no-underline">
                {pickedSketch.meta && <span className="ed-caption">{pickedSketch.meta}</span>}
                <span className="font-heading text-base font-medium">{pickedSketch.title || 'Untitled sketch'}</span>
                {pickedSketch.date && <span className="text-xs text-ink/60">{pickedSketch.date}</span>}
              </Link>
            </FloatPanel>
          )}

          {pickedPlace && (
            <FloatPanel placement="card" {...cardPosition()} bodyClassName="!gap-2 !p-0">
              <div className="relative">
                <span className="ed-slide block">
                  {pickedPlace.list[0]?.image && <img src={pickedPlace.list[0].image} alt="" />}
                </span>
                <button type="button" onClick={() => setPicked(null)} aria-label="Close" className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-ink">
                  <Icon name="close" size={11} />
                </button>
              </div>
              <div className="flex flex-col gap-1 px-3 pb-3">
                <span className="font-heading text-base font-medium">
                  {pickedPlace.place} · {pickedPlace.list.length} {pickedPlace.list.length === 1 ? 'sketch' : 'sketches'}
                </span>
                {onPlaceSelect && (
                  <button type="button" className="self-start text-sm font-semibold underline" onClick={() => { onPlaceSelect(pickedPlace.place); setView('grid') }}>
                    Show these
                  </button>
                )}
              </div>
            </FloatPanel>
          )}
        </div>
      )}
    </div>
  )
}
