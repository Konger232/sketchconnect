import { ASPECT_RATIO_ORDER } from '../../lib/cropMath'

const LABELS = { original: 'Original', '1:1': '1:1', '4:5': '4:5', '16:9': '16:9' }

// IG-desktop-style ratio pills under the crop frame. 'original' (no crop
// at all, the photo's own shape) is included and is the default the
// sketcher lands on -- so a quick capture with no interest in framing
// looks exactly like before, and cropping is opt-in. The sketchbook-size
// ratios (A4/A5/A6, landscape/portrait) discussed for later go in the
// parking lot rather than here, since this is scoped to matching
// Instagram's own ratio set for now.
export default function AspectRatioSwitcher({ value, onChange }) {
  return (
    <div className="mt-2 flex gap-2">
      {ASPECT_RATIO_ORDER.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            value === key ? 'bg-ink text-paper' : 'bg-black/10 text-ink/60 hover:bg-black/15'
          }`}
        >
          {LABELS[key]}
        </button>
      ))}
    </div>
  )
}
