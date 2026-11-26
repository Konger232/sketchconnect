import Icon from '../common/Icon'
import InfoTip from '../common/InfoTip'
import LocationSearchField from '../common/LocationSearchField'
import LocationMap from '../common/LocationMap'
import { DetailsVoiceNotes } from '../common/SketchNotes'

export const NOTE_LIMIT = 500

export function locationText(location) {
  if (!location) return ''
  return location.label || `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`
}

// Who sees a shared sketch (backend app/core/visibility.py).
export const VISIBILITY = [
  { key: 'members', label: 'All sketchers', note: 'Every signed-in sketcher can see it. Visitors see only a small part of the final.' },
  { key: 'followers', label: 'My followers', note: 'Only sketchers who follow you can see it.' },
  { key: 'private', label: 'Only me', note: 'No one else can see it.' },
]
const GLAZE_URL = 'https://glaze.cs.uchicago.edu/' // eslint-disable-line no-unused-vars

/**
 * The Details panel: scene title, location, event, field note and voice
 * notes, who can see it. Shared by Edit Sketch and Capture (design doc,
 * item 57). The state and autosave are useSketchDetails (d).
 *
 * chips: shown at the top (Edit Sketch's style and scene type).
 * extra: shown after the field note (Capture's "What you draw with").
 * locationUnchanged: the location is still the one the photo gave.
 * footer: the "Changes save as you type" line (Capture has its own footer).
 */
export default function SketchDetailsForm({ d, sketch, chips = null, extra = null, locationUnchanged = false, deleteError = null, footer = true }) {
  return (
    <>
      <div className="sc-panel-body gap-[18px]">
        {chips}

        <label className="flex flex-col gap-2">
          <span className="sc-field-label">Scene title <span aria-hidden="true">*</span></span>
          <input value={d.title} onChange={(e) => d.setTitle(e.target.value)} placeholder="Untitled sketch" className="sc-field" required />
        </label>

        <div className="flex flex-col gap-2">
          <span className="sc-field-label">Location <span aria-hidden="true">*</span></span>
          {d.location && !d.editingLocation ? (
            <button
              type="button"
              onClick={() => d.setEditingLocation(true)}
              className="flex min-h-14 items-center gap-3 rounded-xl border-[1.5px] border-sc-strong bg-sc-raised py-2 pl-3.5 pr-3 text-left text-white"
            >
              <Icon name="location" size={20} className="text-sc-text3" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-lg font-medium">{locationText(d.location)}</span>
                {locationUnchanged && <span className="text-sm text-sc-text3">Detected from photo</span>}
              </span>
              <span className="text-base font-bold text-sc-guide">Change</span>
            </button>
          ) : (
            <div className="overflow-hidden rounded-xl border-[1.5px] border-sc-strong bg-sc-raised">
              <p className="px-3.5 py-2.5 text-base text-sc-text2">
                {sketch.location ? 'Search for a place, or tap the map to move the pin.' : 'No location found in the photo. Search for a place, or tap the map to set the pin.'}
              </p>
              <div className="px-2.5 pb-2.5">
                <LocationSearchField location={d.location} onLocationChange={d.setLocation} dark />
              </div>
              <LocationMap
                key={d.location?.label || 'map'}
                lat={d.location?.lat}
                lon={d.location?.lon}
                label={d.location?.label}
                editable
                hint={false}
                height="h-[170px]"
                onLocationChange={d.setLocation}
              />
              <div className="flex items-center gap-2.5 py-2 pl-3.5 pr-2">
                <span className="min-w-0 flex-1 truncate text-md font-semibold">{locationText(d.location) || 'No place set'}</span>
                <button
                  type="button"
                  disabled={!d.location}
                  onClick={() => d.setEditingLocation(false)}
                  className="h-11 whitespace-nowrap rounded-[10px] border-[1.5px] border-sc-guide px-3.5 text-base font-bold text-sc-guide disabled:opacity-40"
                >
                  Use this spot
                </button>
              </div>
            </div>
          )}
        </div>

        {/* The event this sketch was made at. Linked: the title and Remove.
            Not linked: a nearby event to confirm, or a pick from the events
            I'm Interested in. Shown only when there is something to show. */}
        {(sketch.event || d.linkable.length > 0) && (
          <div className="flex flex-col gap-2">
            <span className="sc-field-label">Event</span>
            {sketch.event ? (
              <div className="flex items-center gap-3 rounded-xl border-[1.5px] border-sc-strong bg-sc-raised py-2 pl-3.5 pr-3">
                <span className="min-w-0 flex-1 truncate text-md font-semibold">Sketched at {sketch.event.title}</span>
                <button type="button" onClick={() => d.changeEvent(null)} className="whitespace-nowrap text-base font-bold text-sc-guide">Remove link</button>
              </div>
            ) : (
              <>
                {d.linkable.find((ev) => ev.nearby) && (
                  <div className="flex items-center gap-3 rounded-xl border-[1.5px] border-sc-strong bg-sc-raised py-2 pl-3.5 pr-3">
                    <span className="min-w-0 flex-1 text-md">Was this at {d.linkable.find((ev) => ev.nearby).title}?</span>
                    <button type="button" onClick={() => d.changeEvent(d.linkable.find((ev) => ev.nearby).id)} className="whitespace-nowrap text-base font-bold text-sc-guide">Yes, link it</button>
                  </div>
                )}
                <select value="" onChange={(ev) => ev.target.value && d.changeEvent(ev.target.value)} className="sc-field" aria-label="Link to an event">
                  <option value="">Link to an event…</option>
                  {d.linkable.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                </select>
              </>
            )}
            {d.eventError && <span className="text-sm text-accent">{d.eventError}</span>}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2">
            <label htmlFor="field-note" className="sc-field-label">Field note</label>
            {/* Record a note: the AI writes it down (DetailsVoiceNotes). */}
            <button type="button" onClick={() => d.setRecordRequest((n) => n + 1)} aria-label="Record a note" title="Record a note"
              className="flex h-8 w-8 items-center justify-center rounded-full text-sc-text3 hover:bg-white/10 hover:text-white">
              <Icon name="mic" size={18} />
            </button>
            {d.fieldNotes && <span className="ml-auto text-sm font-semibold text-sc-text3">{d.fieldNotes.length} / {NOTE_LIMIT}</span>}
          </span>
          <textarea
            id="field-note"
            value={d.fieldNotes}
            maxLength={NOTE_LIMIT}
            onChange={(e) => d.setFieldNotes(e.target.value)}
            placeholder="Weather, sounds, who stopped to watch, how long you stayed…"
            rows={4}
            className="sc-field min-h-[7rem] resize-y leading-normal"
          />
          {/* Keep it private, then the recorded notes. It covers both. */}
          <DetailsVoiceNotes sketchId={sketch.id} notesShared={sketch.notes_shared} recordRequest={d.recordRequest} />
        </div>

        {extra}

        {/* Who sees the sketch once it's shared, and Glaze (design doc:
            protecting sketchers' work). */}
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-1.5">
            <span className="sc-field-label">Who can see it</span>
            <InfoTip label="About Who can see it" above>
              {VISIBILITY.map((v) => <span key={v.key} className="mb-1 block"><b>{v.label}:</b> {v.note}</span>)}
              <span className="block">Your plan and progress pages are only yours until you share the final sketch.</span>
            </InfoTip>
          </span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Who can see this sketch">
            {VISIBILITY.map((v) => (
              <button key={v.key} type="button" role="radio" aria-checked={d.visibility === v.key} onClick={() => d.setVisibility(v.key)}
                className={`rounded-full border-[1.5px] px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  d.visibility === v.key ? 'border-sc-guide bg-sc-guide text-white' : 'border-sc-border text-white hover:border-sc-strong'
                }`}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
        {/* Glaze: on hold while Chan researches Glaze and Nightshade.
        <label className="flex items-start gap-2.5 text-sm text-white">
          <input type="checkbox" checked={d.glazed} onChange={(e) => d.setGlazed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-sc-guide" />
          <span>
            My final sketch is Glazed. <a href={GLAZE_URL} target="_blank" rel="noreferrer" className="underline">What is Glaze?</a>
            <span className="block text-sc-text3">Glaze, a free tool from the University of Chicago, changes your image so AI has a harder time copying your style. Glaze it before you upload.</span>
          </span>
        </label>
        */}

        {d.saveError && <p className="text-base text-accent">{d.saveError}</p>}
        {deleteError && <p className="text-base text-accent">{deleteError}</p>}
        
      </div>
      {footer && (
        <div className="sc-footer">
          {/* Details save as you type, like the other tabs. */}
          <span className={`text-base text-sc-text3 ${d.saving ? 'animate-pulse' : ''}`}>
            {d.saving ? 'Saving…' : d.savedJustNow ? 'Saved' : 'Changes save as you type.'}
          </span>
        </div>
      )}
    </>
  )
}
