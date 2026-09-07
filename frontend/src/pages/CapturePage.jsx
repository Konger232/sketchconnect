import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Button from '../components/common/Button'
import LocationPicker from '../components/map/LocationPicker'
import CropFrame from '../components/capture/CropFrame'
import AspectRatioSwitcher from '../components/capture/AspectRatioSwitcher'
import { STYLES } from '../data/styles'
import { isIdentityTransform } from '../lib/cropMath'
import { api } from '../lib/api'

// Renders a `datetime-local` input's expected "YYYY-MM-DDTHH:mm" string
// from an ISO timestamp, in the browser's own local time zone (matching
// how the input displays it back to the sketcher).
function toDatetimeLocalValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// The capture wizard: reached only via the camera icon (Header.jsx /
// NavDrawer.jsx), which passes the sketcher's current page as
// `backgroundLocation` in router state. App.jsx's Router() uses that to
// render this as an overlay -- a centered card with a dimmed backdrop on
// desktop/tablet (the IG "Create new post" pattern), or a fullscreen
// black takeover on mobile (same markup either way; only Tailwind's `md:`
// breakpoint differs). A direct/refreshed visit has no backgroundLocation
// to render underneath, so it falls back to rendering as a normal full
// page via the same main <Routes> block -- this component doesn't need
// to know the difference.
//
// Two internal steps:
//   1. Photo + crop (rule-of-thirds, pan/zoom/aspect -- unchanged from
//      before). Continuing here POSTs /api/sketches immediately (design
//      doc, Section 5: "creates the sketch entry in Postgres immediately,
//      not later at final save") -- no title/style/location/field notes
//      yet, just the image.
//   2. Details: title, style (pill buttons), a lightweight location row
//      that expands into the full LocationPicker on tap, and date/time
//      (prefilled from whatever EXIF the backend found in step 1).
//      Continuing here PUTs those four fields onto the sketch created in
//      step 1, then navigates on to /sketch-flow/:sketchId -- a plain,
//      non-modal navigation (Step 3 is its own full dark-themed page, not
//      part of this overlay).
//
// Field Notes is dropped from the wizard entirely (can still be added
// later via Edit) and there's no Discard button -- the exit is the ×
// button (or backdrop click), which just abandons the flow. If the
// sketcher decides they don't want the sketch at all, that's handled by
// the separate Delete Sketch action on the sketch's own page, not by
// anything in this flow.
export default function CapturePage() {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const backgroundLocation = routerLocation.state?.backgroundLocation

  function closeWizard() {
    navigate(backgroundLocation || '/profile')
  }

  const [step, setStep] = useState('photo') // 'photo' | 'details'

  // -- Step 1: photo + crop --
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [naturalSize, setNaturalSize] = useState(null)
  const [aspectRatioKey, setAspectRatioKey] = useState('original')
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)
  const cropFrameRef = useRef(null)

  // -- Step 2: details, filled in once step 1's POST returns --
  const [sketchId, setSketchId] = useState(null)
  const [title, setTitle] = useState('')
  const [style, setStyle] = useState(null)
  const [location, setLocation] = useState(null)
  // The human-readable place name for `location`, kept around so the
  // collapsed row below can show it instead of a generic "Location set"
  // once the sketcher closes the picker back up -- LocationPicker resolves
  // this itself (search result label, or a reverse-geocode lookup after a
  // map click/drag) and reports it up via onLabelChange.
  const [locationLabel, setLocationLabel] = useState(null)
  const [locationExpanded, setLocationExpanded] = useState(false)
  const [capturedAt, setCapturedAt] = useState('')
  const [continuing, setContinuing] = useState(false)

  const [error, setError] = useState(null)

  function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setNaturalSize(null)
    setAspectRatioKey('original')
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }

  async function handleContinueFromPhoto() {
    if (!file) return
    setSaving(true)
    setError(null)
    try {
      const form = new FormData()
      // Always the untouched original -- the backend reads its GPS/
      // timestamp EXIF from these bytes (a re-baked canvas export strips
      // EXIF entirely), and keeps it as original_image_url for a possible
      // future re-crop.
      form.append('image', file)
      if (naturalSize && !isIdentityTransform(aspectRatioKey, zoom, offset)) {
        const framedBlob = await cropFrameRef.current.bake()
        form.append('framed_image', framedBlob, 'framed.jpg')
        form.append(
          'crop_transform',
          JSON.stringify({ aspect_ratio: aspectRatioKey, offset_x: offset.x, offset_y: offset.y, zoom })
        )
      }
      const { data } = await api.post('/api/sketches', form)
      setSketchId(data.id)
      setLocation(data.location || null)
      setCapturedAt(toDatetimeLocalValue(data.captured_at))
      setStep('details')
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save this sketch.')
    } finally {
      setSaving(false)
    }
  }

  async function handleContinueFromDetails() {
    setContinuing(true)
    setError(null)
    try {
      const body = {}
      if (title) body.title = title
      if (style) body.style = style
      if (location) body.location = location
      if (capturedAt) body.captured_at = capturedAt
      if (Object.keys(body).length > 0) {
        await api.put(`/api/sketches/${sketchId}`, body)
      }
      navigate(`/sketch-flow/${sketchId}`)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save these details.')
    } finally {
      setContinuing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/60 md:p-6">
      <div className="relative flex h-full w-full flex-col bg-black text-white md:h-auto md:max-h-[85vh] md:max-w-2xl md:overflow-hidden md:rounded-2xl">
        <button
          type="button"
          onClick={closeWizard}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-2xl leading-none text-white/80 hover:bg-white/20 hover:text-white"
        >
          &times;
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-16 md:px-8">
          {step === 'photo' ? (
            <>
              <h1 className="text-lg font-bold">New sketch</h1>
              <p className="mt-1 text-sm text-white/60">Add a photo of what you're sketching.</p>

              <div className="relative mx-auto mt-5 w-full max-w-md">
                {preview ? (
                  <>
                    <CropFrame
                      ref={cropFrameRef}
                      src={preview}
                      naturalSize={naturalSize}
                      onNaturalSize={setNaturalSize}
                      aspectRatioKey={aspectRatioKey}
                      zoom={zoom}
                      onZoomChange={setZoom}
                      offset={offset}
                      onOffsetChange={setOffset}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="absolute right-2 top-2 z-10 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white"
                    >
                      Retake
                    </button>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <AspectRatioSwitcher value={aspectRatioKey} onChange={setAspectRatioKey} />
                      <input
                        type="range"
                        min={0.2}
                        max={4}
                        step={0.01}
                        value={zoom}
                        onChange={(e) => setZoom(Number(e.target.value))}
                        aria-label="Zoom"
                        className="w-24"
                      />
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-64 w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl bg-white/10"
                  >
                    <span className="text-4xl text-white/50">📷</span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.heic"
                  onChange={handleFile}
                  className="hidden"
                />
              </div>

              {error && <p className="mx-auto mt-3 max-w-md text-sm text-accent">{error}</p>}

              <div className="mx-auto mt-6 max-w-md">
                <Button className="w-full" disabled={!file || saving} onClick={handleContinueFromPhoto}>
                  {saving ? 'Saving…' : 'Continue'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-lg font-bold">A few details</h1>
              <p className="mt-1 text-sm text-white/60">You can change any of this later.</p>

              <div className="mt-5 flex flex-col gap-6 md:flex-row md:items-start">
                {preview && (
                  <div className="mx-auto w-full max-w-xs overflow-hidden rounded-xl md:mx-0 md:w-1/2">
                    <img src={preview} alt="" className="w-full object-cover" />
                  </div>
                )}

                <div className="flex w-full flex-col gap-5 md:w-1/2">
                  <label className="block">
                    <span className="text-sm font-medium text-white/80">Title</span>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Untitled sketch"
                      className="mt-1 w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-white placeholder:text-white/40"
                    />
                  </label>

                  <div>
                    <span className="text-sm font-medium text-white/80">Style</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {STYLES.map((s) => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => setStyle(s.value)}
                          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                            style === s.value
                              ? 'bg-white text-black'
                              : 'bg-white/10 text-white/80 hover:bg-white/20'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => setLocationExpanded((v) => !v)}
                      className="flex w-full items-center justify-between rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-left text-sm"
                    >
                      <span className="text-white/80">
                        📍 {location ? (locationLabel || 'Location set') : 'Add location'}
                      </span>
                      <span className="text-white/40">{locationExpanded ? '▲' : '▼'}</span>
                    </button>
                    {locationExpanded && (
                      <div className="mt-2 rounded-lg bg-white p-3 text-ink">
                        <LocationPicker location={location} onLocationChange={setLocation} onLabelChange={setLocationLabel} />
                      </div>
                    )}
                  </div>

                  <label className="block">
                    <span className="text-sm font-medium text-white/80">Date &amp; time</span>
                    <input
                      type="datetime-local"
                      value={capturedAt}
                      onChange={(e) => setCapturedAt(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-white [color-scheme:dark]"
                    />
                  </label>
                </div>
              </div>

              {error && <p className="mt-3 text-sm text-accent">{error}</p>}

              <div className="mx-auto mt-6 max-w-md md:mx-0 md:max-w-none">
                <Button className="w-full" disabled={continuing} onClick={handleContinueFromDetails}>
                  {continuing ? 'Continuing…' : 'Continue'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
