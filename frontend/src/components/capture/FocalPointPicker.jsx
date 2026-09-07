// Purely visual now: draws the sketcher's focal-point marker (or the
// "tap where you'll focus" hint when none is set yet). Placing/moving the
// point is handled by CropFrame.jsx's single pointer handler, which also
// owns panning the photo and pinch-zoom on the same surface -- a tap
// (little to no movement) sets the point, a real drag pans instead, so
// this component no longer needs pointer handlers of its own. Kept as a
// separate file/name since CapturePage still reasons about it as "the
// focal point picker" -- only its internals moved.
export default function FocalPointPicker({ value }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {value ? (
        <div
          className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent/70 shadow-lg"
          style={{ left: `${value.x / 10}%`, top: `${value.y / 10}%` }}
        />
      ) : (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
          Tap where you'll focus
        </div>
      )}
    </div>
  )
}
