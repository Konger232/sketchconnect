import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import Header from '../components/common/Header'
import Footer from '../components/common/Footer'
import Button from '../components/common/Button'
import Icon from '../components/common/Icon'
import LocationMap from '../components/common/LocationMap'
import PaintEditor from '../components/common/PaintEditor'
import SketchListMapView from '../components/common/SketchListMapView'
import { useAuth } from '../components/common/AuthContext'
import { MarksLayer } from '../components/analysis/Marks'
import RuleOfThirdsGrid from '../components/analysis/RuleOfThirdsGrid'
import Comments from '../components/sketch/Comments'
import FeedbackBlock from '../components/sketch/FeedbackBlock'
import PaletteBars from '../components/sketch/PaletteBars'
import SharePanel from '../components/sketch/SharePanel'
import { MEDIA } from '../data/media'
import { paintById } from '../data/paints'
import { sceneTypeLabel, STYLES } from '../data/styles'
import { api } from '../lib/api'
import { dateLabel, imageUrl, timeLabel } from '../lib/media'
import { useSketchesVersion } from '../lib/sketchEvents'

const NEARBY_M = 300
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')

// The cropped reference photo with the sketcher's strokes on it (the same
// 0-1000 overlay as the Plan photo in Edit Sketch).
function PlanImage({ src, marks }) {
  return (
    <div className="relative">
      <img src={src} alt="The plan: strokes on the reference photo" className="block w-full" />
      <RuleOfThirdsGrid />
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <MarksLayer marks={marks} />
      </svg>
    </div>
  )
}

/**
 * Sketch Detail (design handoff, "Sketch Page - Grouped"; design doc,
 * item 29). One page, three viewers:
 *
 *   owner    Edit (opens the existing Edit Sketch modal over this page),
 *            Share, scene analysis, the full plan, palette editing and
 *            feedback. Feedback and bookmarks never show to anyone else.
 *   member   signed in: likes and comments.
 *   visitor  signed out: reads; Like and comments go to the login page.
 *
 * Others only see a shared sketch, one with a final sketch (item 30).
 */
export default function SketchDetail() {
  const { sketchId } = useParams()
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const sketchesVersion = useSketchesVersion()

  const [s, setS] = useState(null)
  const [error, setError] = useState(null)
  const [nearby, setNearby] = useState([])
  const [sharing, setSharing] = useState(false)
  const [paintEdit, setPaintEdit] = useState(null) // { mode, paintId?, top }
  const [favs, setFavs] = useState([])
  const paletteBoxRef = useRef(null)
  const sketchGroupRef = useRef(null)

  useEffect(() => {
    setError(null)
    api.get(`/api/sketches/${sketchId}`)
      .then(({ data }) => setS(data))
      .catch((err) => setError(err.response?.status === 404 ? err.response?.data?.detail || 'not_found' : 'error'))
    api.get(`/api/sketches/${sketchId}/nearby`, { params: { radius_m: NEARBY_M } }).then(({ data }) => setNearby(data)).catch(() => setNearby([]))
  }, [sketchId, user?.id, sketchesVersion])
  useEffect(() => { setFavs(profile?.favorite_paints || []) }, [profile?.favorite_paints])

  const viewer = s?.is_owner ? 'owner' : user ? 'member' : 'visitor'
  const nearbyItems = useMemo(() => nearby.map((n) => ({
    id: n.id,
    title: n.title,
    meta: [n.owner?.display_name || n.owner?.handle, `${n.distance_m} m`].filter(Boolean).join(' · '),
    date: dateLabel(n.created_at),
    lat: n.location?.lat,
    lon: n.location?.lon,
    image: imageUrl(n.final_sketch_url || n.reference_image_url),
  })), [nearby])

  if (error) {
    return (
      <div className="bg-white"><Header />
        <main className="ed-page"><p className="text-ink/60">{error === 'error' ? 'Could not load this sketch.' : error === 'not_found' ? 'Sketch not found.' : error}</p></main>
      <Footer /></div>
    )
  }
  if (!s) {
    return <div className="bg-white"><Header /><main className="ed-page"><p className="text-ink/50">Loading…</p></main><Footer /></div>
  }

  const final = imageUrl(s.final_sketch_url)
  const reference = imageUrl(s.reference_image_url)
  const style = STYLES.find((x) => x.value === s.style)?.label
  const scene = sceneTypeLabel[s.scene_type]
  const kicker = ['Sketch', style, scene].filter(Boolean).join(' · ')
  const when = s.captured_at || s.created_at
  const scenePaints = (s.palettes?.scene || []).map(paintById).filter(Boolean)
  const sketchPaints = (s.palettes?.sketch || []).map(paintById).filter(Boolean)
  const latestCritique = viewer === 'owner' ? s.critiques?.[s.critiques.length - 1] : null
  const carried = (s.plan_read?.principles || []).filter((p) => p.group !== 'none')
  const media = (s.media || [])
  const mediaRows = MEDIA.map((g) => ({ group: g.group, items: g.items.filter(([k]) => media.includes(k)).map(([, label]) => label) })).filter((g) => g.items.length)
  const imageCount = [final, reference].filter(Boolean).length + (s.marks?.length ? 1 : 0)
  const pageUrl = `${window.location.origin}/sketches/${s.id}`

  async function toggleLike() {
    if (viewer === 'visitor') return navigate('/login', { state: { from: location.pathname } })
    if (viewer === 'owner') return
    const { data } = s.liked ? await api.delete(`/api/sketches/${s.id}/like`) : await api.post(`/api/sketches/${s.id}/like`)
    setS((x) => ({ ...x, liked: data.liked, like_count: data.like_count }))
  }

  // Edit opens the existing Edit Sketch over this page, on Details. Save
  // closes it and comes back here.
  const openEdit = () => navigate(`/sketches/${s.id}/edit`, { state: { backgroundLocation: location, tab: 'details', closeOnSave: true } })

  // ---- the final sketch's palette (owner) ----
  function openPaint(mode, paint, el) {
    const box = paletteBoxRef.current?.getBoundingClientRect()
    const row = el?.closest('[data-paint-row]')?.getBoundingClientRect() || el?.getBoundingClientRect()
    setPaintEdit({ mode, paintId: paint?.id, top: box && row ? row.bottom - box.top + 6 : 0 })
  }
  async function savePalette(ids) {
    const { data } = await api.put(`/api/sketches/${s.id}/palette`, { sketch: ids })
    setS((x) => ({ ...x, palettes: data.palettes }))
  }
  async function savePaint(paintId) {
    const ids = s.palettes?.sketch || []
    const next = paintEdit.mode === 'new'
      ? [...ids.filter((x) => x !== paintId), paintId]
      : ids.map((x) => (x === paintEdit.paintId ? paintId : x)).filter((x, i, a) => a.indexOf(x) === i)
    setPaintEdit(null)
    await savePalette(next)
  }
  async function toggleFav(paintId) {
    const next = favs.includes(paintId) ? favs.filter((x) => x !== paintId) : [...favs, paintId]
    setFavs(next)
    await api.put('/api/profile', { favorite_paints: next })
  }

  const likeButton = (
    <Button variant="editorial" onClick={toggleLike} aria-pressed={s.liked} disabled={viewer === 'owner'}
      aria-label={viewer === 'owner' ? `${s.like_count} likes` : s.liked ? 'Unlike' : 'Like'}
      className="!px-4 disabled:!opacity-100">
      <Icon name={s.liked ? 'heart-filled' : 'heart'} size={16} className={s.liked ? 'text-[var(--tab-active)]' : ''} />
      {s.like_count}
    </Button>
  )

  return (
    <div className="bg-white">
      <Header />
      <main className="ed-page ed-page--detail">
        {/* ---- Title block and actions ---- */}
        <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 flex-col gap-2.5">
            <span className="ed-kicker">{kicker}</span>
            <h1 className="ed-title">{s.title || 'Untitled sketch'}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-base">
              <Link to={s.owner?.handle ? `/sketchers/${s.owner.handle}` : '#'} className="flex items-center gap-2 font-semibold text-ink no-underline hover:underline">
                <span className="ed-avatar h-8 w-8">{s.owner?.avatar_url && <img src={s.owner.avatar_url} alt="" className="h-full w-full object-cover" />}</span>
                {s.owner?.display_name || s.owner?.handle || 'A sketcher'}
              </Link>
              <span className="text-ink/80">{dateLabel(when)} · {timeLabel(when)}</span>
              {s.location?.label && (
                <span className="inline-flex items-center gap-1.5 text-ink/80">
                  <Icon name="location" size={14} className="text-[var(--pin-active)]" /> {s.location.label}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {likeButton}
            {viewer === 'owner' && <Button variant="editorial" onClick={openEdit}>Edit</Button>}
            {viewer === 'owner' && final && (
              <Button variant="editorialSolid" onClick={() => setSharing(true)}><Icon name="share" size={15} /> Share</Button>
            )}
          </div>
        </section>

        {/* ---- Hero gallery ---- */}
        <section className="flex flex-col gap-2">
          <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
            <div className="photo-placeholder relative flex aspect-[4/5] items-center justify-center overflow-hidden md:aspect-auto md:h-[520px]">
              {(final || reference) && <img src={final || reference} alt={s.title || 'Sketch'} className="max-h-full max-w-full object-contain" />}
              {imageCount > 1 && (
                <button type="button" onClick={() => sketchGroupRef.current?.scrollIntoView({ behavior: 'smooth' })}
                  className="absolute bottom-4 left-4 inline-flex h-10 items-center gap-2 rounded-full bg-ink/70 px-4 text-sm font-bold text-white">
                  <Icon name="images" size={15} /> {imageCount} images
                </button>
              )}
            </div>
            <div className="hidden grid-rows-2 gap-2 md:grid">
              <div className="photo-placeholder relative overflow-hidden">
                {reference && <img src={reference} alt="Reference photo" className="absolute inset-0 h-full w-full object-cover" />}
                <span className="absolute left-2.5 top-2.5 bg-white px-2 py-0.5 text-xs font-semibold">Reference</span>
              </div>
              <div className="relative overflow-hidden">
                <LocationMap lat={s.location?.lat} lon={s.location?.lon} height="h-full min-h-[256px]" rounded={false} />
              </div>
            </div>
          </div>
          {viewer === 'owner' && <p className="m-0 text-xs text-ink/70">Only you see this: feedback and bookmarks stay private.</p>}
        </section>

        {/* ---- Group 1: The scene ---- */}
        {reference && (
          <section className="ed-section">
            <h2 className="ed-kicker m-0">The scene</h2>
            <div className="grid gap-8 md:grid-cols-2 md:gap-14">
              <div className="relative">
                <img src={reference} alt="Reference photo" className="block w-full" />
                <RuleOfThirdsGrid />
              </div>
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <span className="ed-caption">Reference photo</span>
                  <span className="font-heading text-xl font-bold">{s.title || 'Untitled sketch'}</span>
                  {s.location?.label && (
                    <span className="inline-flex items-center gap-1.5 text-base">
                      <Icon name="location" size={14} className="text-[var(--pin-active)]" /> {s.location.label}
                    </span>
                  )}
                </div>
                {scenePaints.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="ed-caption">Scene · closest paint</span>
                    <PaletteBars paints={scenePaints} approx />
                  </div>
                )}
                {viewer === 'owner' && (s.scene?.scene_type || s.scene?.summary || s.focal_regions?.length > 0) && (
                  <div className="flex flex-col">
                    <h3 className="m-0 font-sans text-lg font-normal">Scene analysis</h3>
                    <dl className="m-0">
                      {s.scene?.scene_type && <div className="ed-row"><dt>Scene type</dt><dd>{sceneTypeLabel[s.scene.scene_type] || cap(s.scene.scene_type)}</dd></div>}
                      {s.scene?.summary && <div className="ed-row"><dt>Summary</dt><dd>{s.scene.summary}</dd></div>}
                      {s.focal_regions?.length > 0 && (
                        <div className="ed-row"><dt>Focal areas</dt><dd>{s.focal_regions.map((r, i) => `${i + 1} ${r.label}`).join(', ')}</dd></div>
                      )}
                    </dl>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ---- Group 2: The plan ---- */}
        {reference && (s.marks?.length > 0 || carried.length > 0 || s.plan_short?.length > 0) && (
          <section className="ed-section">
            <h2 className="ed-kicker m-0">The plan</h2>
            <div className="grid gap-8 md:grid-cols-2 md:gap-14">
              <PlanImage src={reference} marks={s.marks || []} />
              <div className="flex flex-col">
                <h3 className="m-0 font-sans text-lg font-normal">Plan</h3>
                <dl className="m-0">
                  {viewer === 'owner' && carried.map((p) => (
                    <div key={p.principle} className="ed-row">
                      <dt>{p.principle}</dt>
                      <dd className="flex flex-col gap-1">
                        {p.why && <span>{p.why}</span>}
                        {p.tips?.slice(0, 2).map((t) => <span key={t.name} className="ed-note">{t.name}: {t.tip}</span>)}
                      </dd>
                    </div>
                  ))}
                  {viewer !== 'owner' && s.plan_short?.length > 0 && (
                    <div className="ed-row"><dt>Focus</dt><dd>{s.plan_short.join(', ')}</dd></div>
                  )}
                  {s.marks?.length > 0 && (
                    <div className="ed-row"><dt>Strokes</dt><dd>{s.marks.filter((m) => !m.erased).length} on the cropped photo</dd></div>
                  )}
                </dl>
              </div>
            </div>
          </section>
        )}

        {/* ---- Group 3: The sketch ---- */}
        {final && (
          <section ref={sketchGroupRef} className="ed-section scroll-mt-6">
            <h2 className="ed-kicker m-0">The sketch</h2>
            <div className="grid gap-8 md:grid-cols-2 md:gap-14">
              <div className="flex flex-col gap-3">
                <span className="photo-placeholder flex items-center justify-center">
                  <img src={final} alt={s.title || 'Final sketch'} className="block w-full" />
                </span>
                <div>
                  <div className="ed-caption">Final</div>
                  <div className="text-lg">Finished {timeLabel(s.created_at) && `on ${dateLabel(s.created_at)}`}</div>
                </div>
              </div>
              <div className="flex flex-col gap-6">
                {(sketchPaints.length > 0 || viewer === 'owner') && (
                  <div ref={paletteBoxRef} className="relative flex flex-col gap-2">
                    <span className="ed-caption">Final sketch · closest paint</span>
                    {sketchPaints.length > 0 && (
                      <PaletteBars paints={sketchPaints}
                        onEdit={viewer === 'owner' ? (p, el) => openPaint('edit', p, el) : undefined}
                        onRemove={viewer === 'owner' ? (p) => savePalette((s.palettes?.sketch || []).filter((x) => x !== p.id)) : undefined} />
                    )}
                    {viewer === 'owner' && sketchPaints.length === 0 && (
                      <p className="m-0 text-sm text-ink/60">Add the paints you used, so others can see what you brought.</p>
                    )}
                    {viewer === 'owner' && (
                      <Button variant="editorial" size="sm" className="self-start" onClick={(e) => openPaint('new', null, e.currentTarget)}>
                        <Icon name="plus" size={14} /> Add paint
                      </Button>
                    )}
                    {paintEdit && (
                      <PaintEditor open mode={paintEdit.mode} paintId={paintEdit.paintId} showBrand={false} favs={favs} top={paintEdit.top}
                        onSave={savePaint} onClose={() => setPaintEdit(null)} onToggleFav={toggleFav} />
                    )}
                  </div>
                )}
                {latestCritique && <FeedbackBlock critique={latestCritique} />}
              </div>
            </div>
          </section>
        )}

        {/* ---- Group 4: Tool kit ---- */}
        {mediaRows.length > 0 && (
          <section className="ed-section">
            <h2 className="ed-kicker m-0">Tool kit</h2>
            <dl className="m-0 max-w-[640px]">
              {mediaRows.map((g) => <div key={g.group} className="ed-row"><dt>{g.group}</dt><dd className="font-semibold">{g.items.join(', ')}</dd></div>)}
            </dl>
          </section>
        )}

        {/* ---- Where it was drawn ---- */}
        {(s.location || s.field_notes) && (
          <section className="ed-section">
            <div className="ed-section-head">
              <h2 className="ed-kicker m-0">Where it was drawn</h2>
              {s.location && (
                <a href={`https://www.openstreetmap.org/?mlat=${s.location.lat}&mlon=${s.location.lon}#map=17/${s.location.lat}/${s.location.lon}`}
                  target="_blank" rel="noopener noreferrer" className="text-sm text-ink underline">Open in Maps</a>
              )}
            </div>
            <div className="flex flex-wrap gap-8">
              {s.location && (
                <div className="min-w-0 flex-[1_1_480px]">
                  <LocationMap lat={s.location.lat} lon={s.location.lon} height="h-[300px]" rounded={false} />
                </div>
              )}
              {s.field_notes && (
                <div className="flex min-w-[260px] flex-[1_1_320px] flex-col gap-3">
                  <span className="ed-caption">Field notes</span>
                  <p className="m-0 whitespace-pre-line text-base leading-relaxed">{s.field_notes}</p>
                  <span className="text-xs text-ink/60">{dateLabel(when)} · {timeLabel(when)}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ---- Comments ---- */}
        {final && <Comments sketchId={s.id} viewer={viewer} userId={user?.id} />}

        {/* ---- Other sketches near here ---- */}
        {s.location && (
          <section className="ed-section">
            <div className="flex flex-col gap-1">
              <h2 className="ed-kicker m-0">Other sketches near here</h2>
              <span className="text-sm text-ink/70">Shared sketches within {NEARBY_M} m, nearest first</span>
            </div>
            <SketchListMapView items={nearbyItems} center={{ lat: s.location.lat, lon: s.location.lon, radius: NEARBY_M }}
              emptyText="No one else has shared a sketch here yet." />
          </section>
        )}
      </main>
      <Footer />

      {sharing && (
        <SharePanel sketch={s} images={{ final, reference }} palette={sketchPaints} pageUrl={pageUrl} onClose={() => setSharing(false)} />
      )}
    </div>
  )
}
