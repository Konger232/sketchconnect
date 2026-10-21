import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import BasePage, { PageMessage } from '../components/common/BasePage'
import Button from '../components/common/Button'
import ConfirmDialog from '../components/common/ConfirmDialog'
import Icon from '../components/common/Icon'
import LocationMap from '../components/common/LocationMap'
import PaintEditor from '../components/common/PaintEditor'
import SketchListMapView from '../components/common/SketchListMapView'
import { useAuth } from '../components/common/AuthContext'
import { MarksLayer } from '../components/analysis/Marks'
import RuleOfThirdsGrid from '../components/analysis/RuleOfThirdsGrid'
import Comments from '../components/common/Comments'
import FeedbackBlock from '../components/common/FeedbackBlock'
import PaletteBars from '../components/common/PaletteBars'
import SharePanel from '../components/common/SharePanel'
import UploadSketchModal from '../components/common/UploadSketchModal'
import { ColorSection, ValueSection } from '../components/common/StudiesSection'
import { getSketchStatus } from '../lib/sketchStatus'
import { MEDIA } from '../data/media'
import { paintById } from '../data/paints'
import { sceneTypeLabel, STYLES } from '../data/styles'
import { api } from '../lib/api'
import { dateLabel, imageUrl, timeLabel } from '../lib/media'
import { notifySketchesChanged, useSketchesVersion } from '../lib/sketchEvents'
import Avatar from '../components/common/Avatar'

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
 * Before that, the owner uses the same page for every stage (item 38):
 * Upload sketch adds a progress sketch or the final, which shares the
 * sketch and runs the critique; the feedback lands in The sketch group.
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
  const [uploading, setUploading] = useState(null) // { upload? } while the Upload sketch modal is open
  const [picked, setPicked] = useState(null) // the upload shown large in The sketch
  const [deleting, setDeleting] = useState(null) // the upload to confirm deleting
  const [actionError, setActionError] = useState(null)
  const [busyFollow, setBusyFollow] = useState(false)
  const paletteBoxRef = useRef(null)
  const sketchGroupRef = useRef(null)

  async function toggleFollow() {
    setBusyFollow(true)
    try {
      const { data } = s.owner.is_following
        ? await api.delete(`/api/sketchers/${s.owner.username}/follow`)
        : await api.post(`/api/sketchers/${s.owner.username}/follow`)
      setS((prev) => ({ ...prev, owner: { ...prev.owner, is_following: data.is_following } }))
    } catch {
      setActionError('Could not update the follow right now.')
    } finally {
      setBusyFollow(false)
    }
  }

  function reload() {
    return api.get(`/api/sketches/${sketchId}`).then(({ data }) => setS(data))
  }

  useEffect(() => {
    setError(null)
    reload()
      .catch((err) => setError(err.response?.status === 404 ? err.response?.data?.detail || 'not_found' : 'error'))
    api.get(`/api/sketches/${sketchId}/nearby`, { params: { radius_m: NEARBY_M } }).then(({ data }) => setNearby(data)).catch(() => setNearby([]))
  }, [sketchId, user?.id, sketchesVersion])
  useEffect(() => { setFavs(profile?.favorite_paints || []) }, [profile?.favorite_paints])

  // While the critique runs, check back every few seconds until it lands.
  useEffect(() => {
    if (s?.critique_status !== 'pending') return
    const timer = setInterval(() => { reload().catch(() => {}) }, 4000)
    return () => clearInterval(timer)
  }, [s?.critique_status, sketchId]) // eslint-disable-line react-hooks/exhaustive-deps

  const viewer = s?.is_owner ? 'owner' : user ? 'member' : 'visitor'
  const nearbyItems = useMemo(() => nearby.map((n) => ({
    id: n.id,
    title: n.title,
    meta: [n.owner?.display_name || n.owner?.username, `${n.distance_m} m`].filter(Boolean).join(' · '),
    date: dateLabel(n.created_at),
    lat: n.location?.lat,
    lon: n.location?.lon,
    image: imageUrl(n.final_sketch_url || n.reference_image_url),
    sketch: n,
  })), [nearby])

  if (error) {
    return <PageMessage>{error === 'error' ? 'Could not load this sketch.' : error === 'not_found' ? 'Sketch not found.' : error}</PageMessage>
  }
  if (!s) {
    return <PageMessage muted>Loading…</PageMessage>
  }

  const final = imageUrl(s.final_sketch_url)
  const reference = imageUrl(s.reference_image_url)
  const style = STYLES.find((x) => x.value === s.style)?.label
  const scene = sceneTypeLabel[s.scene_type]
  const shared = Boolean(s.final_sketch_url)
  // Before the final sketch, only the owner sees this page (design doc, item 38).
  const kicker = shared ? ['Sketch', style, scene].filter(Boolean).join(' · ') : `${getSketchStatus({ ...s, upload_count: s.uploads?.length || 0 })} · Only you`
  const uploads = s.uploads || []
  const finalUpload = uploads.find((u) => u.is_final)
  const lastUpload = uploads[uploads.length - 1]
  const shownUpload = uploads.find((u) => u.id === picked) || finalUpload || lastUpload
  const heroImage = final || imageUrl(lastUpload?.url) || reference
  const critiquePending = s.critique_status === 'pending'
  const when = s.captured_at || s.created_at
  const scenePaints = (s.palettes?.scene || []).map(paintById).filter(Boolean)
  const sketchPaints = (s.palettes?.sketch || []).map(paintById).filter(Boolean)
  const latestCritique = viewer === 'owner' ? s.critiques?.[s.critiques.length - 1] : null
  const carried = (s.plan_read?.principles || []).filter((p) => p.group !== 'none')
  // A principle's tips, as the Plan tab lists them (PlanReadCard): its own,
  // then its relationships' tips, at most 3.
  const tipsOf = (p) => [
    ...(p.tips || []),
    ...(s.plan_read?.relationships || []).filter((r) => r.principle === p.principle).flatMap((r) => r.tips || []),
  ].slice(0, 3)
  // The owner's bookmarks: the last choice per tip wins.
  const bookmarked = new Set()
  for (const c of s.session_choices || []) {
    if (c.key !== 'bookmark') continue
    const k = `${c.principle}:${c.response}`
    if (c.bookmarked) bookmarked.add(k)
    else bookmarked.delete(k)
  }
  const media = (s.media || [])
  const mediaRows = MEDIA.map((g) => ({ group: g.group, items: g.items.filter(([k]) => media.includes(k)).map(([, label]) => label) })).filter((g) => g.items.length)
  const imageCount = uploads.length + (reference ? 1 : 0) + (s.marks?.length ? 1 : 0)
  const pageUrl = `${window.location.origin}/sketches/${s.id}`

  async function toggleLike() {
    if (viewer === 'visitor') return navigate('/login', { state: { from: location.pathname } })
    if (viewer === 'owner') return
    const { data } = s.liked ? await api.delete(`/api/sketches/${s.id}/like`) : await api.post(`/api/sketches/${s.id}/like`)
    setS((x) => ({ ...x, liked: data.liked, like_count: data.like_count }))
  }

  // Edit opens the existing Edit Sketch over this page, on Details. Save
  // closes it and comes back here.
  // ---- uploads (owner) ----
  const uploadLabel = (u) => (u.is_final ? 'Final' : `Sketch ${uploads.filter((x) => !x.is_final).indexOf(u) + 1}`)
  async function moveUpload(u, dir) {
    const ids = uploads.map((x) => x.id)
    const i = ids.indexOf(u.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setActionError(null)
    try {
      const { data } = await api.put(`/api/sketches/${s.id}/uploads/order`, { ids })
      setS((x) => ({ ...x, uploads: data.uploads }))
    } catch {
      setActionError('Could not change the order.')
    }
  }
  async function deleteUpload() {
    const u = deleting
    setDeleting(null)
    setActionError(null)
    try {
      await api.delete(`/api/sketches/${s.id}/uploads/${u.id}`)
      if (picked === u.id) setPicked(null)
      await reload()
    } catch (err) {
      const d = err.response?.data?.detail
      setActionError(typeof d === 'string' ? d : 'Could not delete that upload.')
    }
  }
  async function retryFeedback() {
    setActionError(null)
    try {
      const form = new FormData()
      form.append('sketch_id', s.id)
      await api.post('/api/critique', form)
      setS((x) => ({ ...x, critique_status: 'pending' }))
    } catch {
      setActionError('Could not start feedback right now.')
    }
  }

  const openEdit = () => navigate(`/sketches/${s.id}/edit`, { state: { backgroundLocation: location, tab: 'details' } })

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

  // Panels and modals over the page.
  const overlays = (
    <>
      {uploading && (
        <UploadSketchModal sketch={s} upload={uploading.upload || null} imageUrl={uploading.upload ? imageUrl(uploading.upload.url) : null}
          onClose={() => setUploading(null)}
          onDone={() => { setUploading(null); setPicked(null); reload(); notifySketchesChanged() }} />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title={deleting?.is_final ? 'Delete the final sketch?' : 'Delete this upload?'}
        message={deleting?.is_final
          ? 'This unshares the sketch and unlocks your plan. Its feedback stays in the history. Upload a new final sketch to share it again.'
          : "This removes the photo, and can't be undone."}
        confirmLabel="Delete"
        cancelLabel="Keep it"
        onConfirm={deleteUpload}
        onCancel={() => setDeleting(null)}
      />
      {sharing && (
        <SharePanel sketch={s} images={{ final, reference }} palette={sketchPaints} pageUrl={pageUrl} onClose={() => setSharing(false)} />
      )}
    </>
  )

  return (
    <BasePage detail overlays={overlays}>
      {/* ---- Title block and actions ---- */}
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-2.5">
          <span className="ed-kicker">{kicker}</span>
          <h1 className="ed-title">{s.title || 'Untitled sketch'}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-base">
            <Link to={s.owner?.username ? `/sketchers/${s.owner.username}` : '#'} className="flex items-center gap-2 font-semibold text-ink no-underline hover:underline">
              <Avatar url={s.owner?.avatar_url} className="h-8 w-8" />
              {s.owner?.display_name || s.owner?.username || 'A sketcher'}
            </Link>
            {/* Follow the sketcher from their sketch (not on your own). */}
            {viewer === 'member' && s.owner?.username && (
              <Button variant="editorialSolid" size="sm" active={s.owner.is_following} onClick={toggleFollow} disabled={busyFollow}>
                {s.owner.is_following ? 'Following' : 'Follow'}
              </Button>
            )}
            <span className="text-ink/80">{dateLabel(when)} · {timeLabel(when)}</span>
            {s.location?.label && (
              <span className="inline-flex items-center gap-1.5 text-ink/80">
                <Icon name="location" size={14} className="text-[var(--pin-active)]" /> {s.location.label}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {shared && likeButton}
          {viewer === 'owner' && <Button variant="editorial" onClick={openEdit}>Edit</Button>}
          {viewer === 'owner' && (
            <Button variant={shared ? 'editorial' : 'editorialSolid'} onClick={() => setUploading({})}>
              <Icon name="plus" size={15} /> Upload sketch
            </Button>
          )}
          {viewer === 'owner' && final && (
            <Button variant="editorialSolid" onClick={() => setSharing(true)}><Icon name="share" size={15} /> Share</Button>
          )}
        </div>
      </section>

      {/* ---- Hero gallery ---- */}
      <section className="flex flex-col gap-2">
        <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
          <div className={`${heroImage ? 'bg-black' : 'photo-placeholder'} relative flex aspect-[4/5] items-center justify-center overflow-hidden md:aspect-auto md:h-[520px]`}>
            {heroImage && <img src={heroImage} alt={s.title || 'Sketch'} className="max-h-full max-w-full object-contain" />}
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
        {viewer === 'owner' && (
          <p className="m-0 text-xs text-ink/70">
            {shared ? 'Only you see this: feedback and bookmarks stay private.' : 'Only you see this sketch. Upload your final sketch to share it and get feedback.'}
          </p>
        )}
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
          <h2 className="ed-kicker m-0">The composition plan</h2>
          <div className="grid gap-8 md:grid-cols-2 md:gap-14">
            <PlanImage src={reference} marks={s.marks || []} />
            <div className="flex flex-col">
              <h3 className="m-0 font-sans text-lg font-normal">Design principles</h3>
              {viewer === 'owner' && carried.length > 0 && (
                <p className="ed-note m-0 pb-2">What the AI read in your strokes. Your bookmarked tips are marked.</p>
              )}
              <dl className="m-0">
                {viewer === 'owner' && carried.map((p) => (
                  <div key={p.principle} className="ed-row">
                    <dt>{p.principle}</dt>
                    <dd className="flex flex-col gap-1">
                      {p.why && <span>{p.why}</span>}
                      {tipsOf(p).map((t) => {
                        const on = bookmarked.has(`${p.principle}:${t.name}`)
                        return (
                          <span key={t.name} className={`ed-note flex items-start gap-2 ${on ? '-ml-2 bg-[var(--ed-field-bg)] py-1 pl-2 pr-2 text-ink/80' : ''}`}>
                            <span className="flex-1">{t.name}: {t.tip}</span>
                            {on && <Icon name="bookmark-filled" size={14} className="mt-0.5 shrink-0" aria-label="Bookmarked" />}
                          </span>
                        )
                      })}
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

      {/* ---- The value and colour studies: each only when the sketcher used that tab ---- */}
      <ValueSection sketch={s} />
      <ColorSection sketch={s} reference={reference} />

      {/* ---- Group 3: The sketch: progress sketches, the final, feedback ---- */}
      {(uploads.length > 0 || viewer === 'owner') && (
        <section ref={sketchGroupRef} className="ed-section scroll-mt-6">
          <h2 className="ed-kicker m-0">The sketch</h2>
          {uploads.length === 0 ? (
            <button type="button" onClick={() => setUploading({})}
              className="flex min-h-[200px] flex-col items-center justify-center gap-2 border-[1.5px] rounded-lg border-dashed border-ink/30 p-6 text-center hover:border-ink">
              <Icon name="plus" size={22} />
              <span className="font-heading text-xl font-bold">Sketched it? Upload a photo.</span>
              <span className="max-w-[420px] text-sm text-ink/70">Add progress sketches as you go. Upload the final sketch to share it and get feedback.</span>
            </button>
          ) : (
            <div className="grid gap-8 md:grid-cols-2 md:gap-14">
              <div className="flex flex-col gap-3">
                <span className="photo-placeholder flex items-center justify-center">
                  <img src={imageUrl(shownUpload.url)} alt={`${s.title || 'Sketch'}: ${uploadLabel(shownUpload)}`} className="block w-full" />
                </span>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="ed-caption">{uploadLabel(shownUpload)}</div>
                    <div className="text-lg">{dateLabel(shownUpload.created_at)} · {timeLabel(shownUpload.created_at)}</div>
                  </div>
                  {viewer === 'owner' && (
                    <div className="flex flex-wrap gap-2">
                      {!shownUpload.is_final && (
                        <Button variant="editorial" size="sm" disabled={critiquePending} onClick={() => setUploading({ upload: shownUpload })}>Make it the final</Button>
                      )}
                      <Button variant="editorial" size="sm" disabled={critiquePending && shownUpload.is_final} onClick={() => setDeleting(shownUpload)}>Delete</Button>
                    </div>
                  )}
                </div>
                {uploads.length > 1 && (
                  <ol className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-1">
                    {uploads.map((u, i) => (
                      <li key={u.id} className="flex shrink-0 flex-col items-center gap-1">
                        <button type="button" onClick={() => setPicked(u.id)} aria-pressed={u.id === shownUpload.id} aria-label={uploadLabel(u)}
                          className={`h-[72px] w-[72px] overflow-hidden ${u.id === shownUpload.id ? 'outline outline-2 outline-ink' : 'opacity-80 hover:opacity-100'}`}>
                          <img src={imageUrl(u.url)} alt="" className="h-full w-full object-cover" />
                        </button>
                        <span className="text-2xs font-semibold uppercase tracking-[0.1em] text-ink/70">{uploadLabel(u)}</span>
                        {viewer === 'owner' && (
                          <span className="flex">
                            <button type="button" className="ed-icon-btn h-7 w-7" disabled={i === 0} aria-label={`Move ${uploadLabel(u)} earlier`} onClick={() => moveUpload(u, -1)}>‹</button>
                            <button type="button" className="ed-icon-btn h-7 w-7" disabled={i === uploads.length - 1} aria-label={`Move ${uploadLabel(u)} later`} onClick={() => moveUpload(u, 1)}>›</button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                {actionError && <p className="m-0 text-sm text-accent">{actionError}</p>}
              </div>
              <div className="flex flex-col gap-6">
                {final && (sketchPaints.length > 0 || viewer === 'owner') && (
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
                {viewer === 'owner' && critiquePending && (
                  <div className="flex flex-col gap-1 border-l-2 border-ink pl-4">
                    <span className="text-lg font-semibold">Feedback on its way…</span>
                    <span className="text-sm text-ink/70">The AI is reading your sketch against your photo and plan. This takes about a minute. You can leave this page; it waits here.</span>
                  </div>
                )}
                {viewer === 'owner' && !critiquePending && final && s.critique_status === 'failed' && (
                  <div className="flex flex-col items-start gap-2">
                    <span className="text-base text-accent">Could not get feedback this time.</span>
                    <Button variant="editorial" size="sm" onClick={retryFeedback}>Try again</Button>
                  </div>
                )}
                {!critiquePending && final && latestCritique && <FeedbackBlock critique={latestCritique} />}
                {viewer === 'owner' && !final && (
                  <p className="m-0 text-sm text-ink/70">Feedback comes when you share your final sketch.</p>
                )}
              </div>
            </div>
          )}
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
    </BasePage>
  )
}
