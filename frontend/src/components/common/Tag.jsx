// bg-white/10 + text-white/80 -- the same translucent-pill-on-dark
// treatment used elsewhere in EditSketch.jsx's control panel (the
// avatar circle in NavDrawer, the "pill" Button variant's inactive
// state). Tag is only ever rendered from EditSketch.jsx's now-dark
// control panel, so there's no light-background usage to keep working
// alongside this -- if that changes later, this'll need the same
// dark/light-prop split LocationSearchField got.
export default function Tag({ children }) {
  return (
    <span className="inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
      {children}
    </span>
  )
}
