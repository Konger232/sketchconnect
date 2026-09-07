// Faint rule-of-thirds guide lines overlaid on the capture preview so the
// sketcher can frame the shot with classical composition in mind before
// picking a focal point. Purely visual -- 1px lines, 70% transparent (30%
// opaque) white, so they read on both light and dark photos without being
// heavy-handed. pointer-events-none so it never blocks taps meant for
// whatever sits above it (e.g. a focal-point picker).
export default function RuleOfThirdsGrid() {
  const stops = [33.333, 66.667]
  return (
    <div className="pointer-events-none absolute inset-0">
      {stops.map((pct) => (
        <div
          key={`v-${pct}`}
          className="absolute inset-y-0 w-px bg-white/30"
          style={{ left: `${pct}%` }}
        />
      ))}
      {stops.map((pct) => (
        <div
          key={`h-${pct}`}
          className="absolute inset-x-0 h-px bg-white/30"
          style={{ top: `${pct}%` }}
        />
      ))}
    </div>
  )
}
