// The paint list for PaintEditor, the kit and palettes (design doc,
// item 28). Matching runs on the pigment, not the brand: every brand's
// Ultramarine is PB29. `id` is what the backend stores (favorites,
// palettes); `code` is what the sketcher reads; `codes` lists the pigments
// (a convenience mix such as Payne's Gray has more than one). `hex` is an
// approximate full-strength colour for the swatch, to be replaced by the
// measured reference colours (design doc, item 28, open question).
// `lean` is which way the paint leans, as painters describe it, for the
// gamut mask's labels (item 37). Written by hand: the approximate `hex`
// is not exact enough to work it out.
// The starter palette when the sketcher has no paints in My kit (design
// doc, item 37). Chan's pick: a warm and a cool of each primary, two
// earths, a white and a grey.
export const STARTER_PALETTE = ['pb29', 'pb35', 'py35', 'py43', 'pr108', 'pr83', 'pbr7-raw-sienna', 'pw6', 'paynes-gray']

export const PAINTS = [
  { id: 'py3', code: 'PY3', codes: ['PY3'], name: 'Hansa Yellow Light', hex: '#e6ea3c', lean: 'yellow, leaning green (cool)', opacity: 'semi_transparent' },
  { id: 'py97', code: 'PY97', codes: ['PY97'], name: 'Hansa Yellow Medium', hex: '#f2c62b', lean: 'yellow, near the middle', opacity: 'semi_transparent' },
  { id: 'py35', code: 'PY35', codes: ['PY35'], name: 'Cadmium Yellow', hex: '#f2c230', lean: 'yellow, leaning orange (warm)', opacity: 'opaque' },
  { id: 'py150', code: 'PY150', codes: ['PY150'], name: 'Nickel Azo Yellow', hex: '#d9a521', lean: 'a muted yellow, leaning orange (warm)', opacity: 'transparent' },
  { id: 'po49', code: 'PO49', codes: ['PO49'], name: 'Quinacridone Gold', hex: '#c98a1d', lean: 'a muted yellow-orange (warm)', opacity: 'transparent' },
  { id: 'py43', code: 'PY43', codes: ['PY43'], name: 'Yellow Ochre', hex: '#c8962e', lean: 'a muted yellow, an earth (warm)', opacity: 'semi_opaque' },
  { id: 'pbr7-raw-sienna', code: 'PBr7', codes: ['PBr7'], name: 'Raw Sienna', hex: '#b5762f', lean: 'a muted yellow-orange, an earth (warm)', opacity: 'transparent' },
  { id: 'pbr7-burnt-sienna', code: 'PBr7', codes: ['PBr7'], name: 'Burnt Sienna', hex: '#8f4a2a', lean: 'a muted orange-red, an earth (warm)', opacity: 'transparent' },
  { id: 'pbr7-raw-umber', code: 'PBr7', codes: ['PBr7'], name: 'Raw Umber', hex: '#5e4a36', lean: 'a dull brown, leaning green (cool earth)', opacity: 'transparent' },
  { id: 'pbr7-burnt-umber', code: 'PBr7', codes: ['PBr7'], name: 'Burnt Umber', hex: '#4e3424', lean: 'a dark brown, leaning red (warm earth)', opacity: 'transparent' },
  { id: 'po73', code: 'PO73', codes: ['PO73'], name: 'Pyrrol Orange', hex: '#e2582a', lean: 'orange, leaning red (warm)', opacity: 'semi_transparent' },
  { id: 'po20', code: 'PO20', codes: ['PO20'], name: 'Cadmium Orange', hex: '#e86f2a', lean: 'orange (warm)', opacity: 'opaque' },
  { id: 'pr255', code: 'PR255', codes: ['PR255'], name: 'Pyrrol Scarlet', hex: '#d33a2c', lean: 'red, leaning orange (warm)', opacity: 'semi_transparent' },
  { id: 'pr108', code: 'PR108', codes: ['PR108'], name: 'Cadmium Red', hex: '#c8322b', lean: 'red, leaning orange (warm)', opacity: 'opaque' },
  // Crimsons: cool reds, leaning toward blue. "Crimson" is a marketing
  // name; the pigment behind it varies by brand (PR83, PR264, PV19 blends),
  // so the sketcher picks by the pigment on the tube.
  { id: 'pr83', code: 'PR83', codes: ['PR83'], name: 'Alizarin Crimson', hex: '#9e1f3a', lean: 'red, leaning blue (cool)', opacity: 'transparent' },
  { id: 'pr264', code: 'PR264', codes: ['PR264'], name: 'Pyrrole Crimson', hex: '#b22a3c', lean: 'red, leaning blue (cool)', opacity: 'semi_transparent' },
  { id: 'pv19', code: 'PV19', codes: ['PV19'], name: 'Quinacridone Rose', hex: '#c23b6e', lean: 'pink-red, leaning blue (cool)', opacity: 'transparent' },
  { id: 'pr122', code: 'PR122', codes: ['PR122'], name: 'Quinacridone Magenta', hex: '#a8326b', lean: 'magenta, leaning violet (cool)', opacity: 'transparent' },
  { id: 'pv23', code: 'PV23', codes: ['PV23'], name: 'Dioxazine Violet', hex: '#4b2c6e', lean: 'violet, leaning blue (cool)', opacity: 'transparent' },
  { id: 'pb29', code: 'PB29', codes: ['PB29'], name: 'Ultramarine Blue', hex: '#24359a', lean: 'blue, leaning violet (warm)', opacity: 'transparent' },
  { id: 'pb28', code: 'PB28', codes: ['PB28'], name: 'Cobalt Blue', hex: '#2f5aa8', lean: 'blue, near the middle', opacity: 'semi_transparent' },
  { id: 'pb35', code: 'PB35', codes: ['PB35'], name: 'Cerulean Blue', hex: '#3a86b8', lean: 'blue, leaning green (cool)', opacity: 'semi_opaque' },
  { id: 'pb15-3', code: 'PB15:3', codes: ['PB15:3'], name: 'Phthalo Blue', hex: '#0f5e9c', lean: 'blue, leaning green (cool)', opacity: 'transparent' },
  { id: 'pb60', code: 'PB60', codes: ['PB60'], name: 'Indanthrone Blue', hex: '#253b6e', lean: 'a dark blue, leaning violet (warm)', opacity: 'transparent' },
  { id: 'pg7', code: 'PG7', codes: ['PG7'], name: 'Phthalo Green', hex: '#11695a', lean: 'green, leaning blue (cool)', opacity: 'transparent' },
  { id: 'pg18', code: 'PG18', codes: ['PG18'], name: 'Viridian', hex: '#1f7a62', lean: 'green, leaning blue (cool)', opacity: 'transparent' },
  { id: 'pg17', code: 'PG17', codes: ['PG17'], name: 'Chromium Oxide Green', hex: '#5f7a45', lean: 'a muted green, leaning yellow (warm)', opacity: 'opaque' },
  { id: 'pbk31', code: 'PBk31', codes: ['PBk31'], name: 'Perylene Green', hex: '#2f3b33', lean: 'a very dark green, near black', opacity: 'transparent' },
  { id: 'paynes-gray', code: 'PB29 + PBk9', codes: ['PB29', 'PBk9'], name: "Payne's Gray", hex: '#4b5560', lean: 'a blue-grey (cool)', opacity: 'semi_opaque' },
  { id: 'neutral-tint', code: 'PB15 + PV19 + PBk6', codes: ['PB15', 'PV19', 'PBk6'], name: 'Neutral Tint', hex: '#3d3b40', lean: 'a neutral grey-black', opacity: 'opaque' },
  { id: 'pbk9', code: 'PBk9', codes: ['PBk9'], name: 'Ivory Black', hex: '#2a2725', lean: 'a warm black', opacity: 'opaque' },
  { id: 'pbk6', code: 'PBk6', codes: ['PBk6'], name: 'Lamp Black', hex: '#1f1f1f', lean: 'a cool black', opacity: 'opaque' },
  { id: 'pw6', code: 'PW6', codes: ['PW6'], name: 'Titanium White', hex: '#f4f2ec', lean: 'white', opacity: 'opaque' },
]

export const BRANDS = [
  'Daniel Smith', 'Winsor & Newton', 'Schmincke', 'ShinHan', 'Holbein',
  'M. Graham', 'Sennelier', 'White Nights', 'Da Vinci',
]

// ---- the community library (design doc, item 46) ----
// Paints from the backend's library (GET /api/paints, and every palette the
// API returns as palette_paints) are kept here, so paintById finds a paint
// a sketcher added as well as ours. lib/api.js registers them as they come.
const LIBRARY = new Map()
export function registerPaints(list) {
  for (const p of list || []) if (p && p.id && p.hex) LIBRARY.set(p.id, p)
}
// Every paint we know of: ours first, then the sketchers'.
export const libraryPaints = () => [...PAINTS.map((p) => LIBRARY.get(p.id) || p), ...[...LIBRARY.values()].filter((p) => !PAINTS.some((x) => x.id === p.id))]

export const paintById = (id) => LIBRARY.get(id) || PAINTS.find((p) => p.id === id)

// A paint's description without warm or cool: the wheel already shows
// which way it leans. "blue, leaning violet (warm)" -> "blue".
export const paintDescription = (lean) => (lean || '')
  .replace(/\s*\((?:warm|cool)[^)]*\)/gi, '')
  .replace(/,\s*(?:leaning [^,(]+|near the middle)/gi, '')
  .trim() || null

// "Daniel Smith French Ultramarine", or just the name for our generic paints.
export const paintLabel = (p) => (p?.brand ? `${p.brand} ${p.name}` : p?.name || '')

// Opacity, as printed on the tube (paints.opacity), with the square
// symbols makers use.
export const OPACITY = [
  { value: 'transparent', mark: '⬜', label: 'Transparent', note: 'ink lines show clearly through; good for glazing' },
  { value: 'semi_transparent', mark: '◪', label: 'Semi-transparent', note: 'a slight veil over dark lines' },
  { value: 'semi_opaque', mark: '◩', label: 'Semi-opaque', note: 'mutes the linework under it' },
  { value: 'opaque', mark: '⬛', label: 'Opaque', note: 'covers ink lines and paper, like gouache' },
]
export const opacityLabel = (v) => OPACITY.find((o) => o.value === v)?.label || null

// ---- pigment codes (features/paints/pigments.py) ----
// The family letters after P, and where each family sits on the wheel
// (hue in degrees, and the most chroma a family like black can have).
export const FAMILIES = {
  Y: { word: 'yellow', hues: [[35, 80]] },
  O: { word: 'orange', hues: [[10, 50]] },
  R: { word: 'red', hues: [[320, 360], [0, 30]] },
  // Violets include the quinacridones (PV19, PV42), which run to red.
  V: { word: 'violet', hues: [[245, 360], [0, 15]] },
  B: { word: 'blue', hues: [[180, 270]] },
  G: { word: 'green', hues: [[70, 190]] },
  Br: { word: 'brown', hues: [[0, 60]], maxC: 0.8 },
  Bk: { word: 'black', maxC: 0.35 },
  W: { word: 'white', maxC: 0.25 },
}
const CODE = /^P(Br|Bk|Y|O|R|V|B|G|W)(\d{1,3})(?::(\d))?$/

// 'pb 15:3' -> 'PB15:3'; null when it is not a pigment code.
export function normalizeCode(raw) {
  let s = String(raw || '').replace(/\s+/g, '')
  if (s.length < 3 || s[0].toUpperCase() !== 'P') return null
  const rest = s.slice(1)
  const fam = ['Br', 'Bk'].find((f) => rest.slice(0, 2).toLowerCase() === f.toLowerCase())
  s = fam ? `P${fam}${rest.slice(2)}` : `P${rest[0].toUpperCase()}${rest.slice(1)}`
  const m = s.match(CODE)
  return m ? `P${m[1]}${Number(m[2])}${m[3] ? `:${m[3]}` : ''}` : null
}
export const familyOf = (code) => code?.match(CODE)?.[1] || null

// Does a colour on the wheel ({ h, c }) suit any of these pigments' families?
export function colourFits(codes, at) {
  const fams = codes.map(familyOf).filter(Boolean)
  if (!fams.length || !at) return true
  return fams.some((f) => {
    const { hues, maxC } = FAMILIES[f]
    if (maxC != null && at.c > maxC) return false
    return !hues || at.c < 0.12 || hues.some(([a, b]) => at.h >= a && at.h <= b)
  })
}

export const starterPaints = () => STARTER_PALETTE.map(paintById)

// The paints a sketcher mixes from: My palette (profiles.favorite_paints,
// design doc item 44). Empty means use starterPaints().
export function kitPaintList(favorites = []) {
  return [...new Map(favorites.map(paintById).filter(Boolean).map((p) => [p.id, p])).values()]
}
