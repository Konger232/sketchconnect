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
  { id: 'py3', code: 'PY3', codes: ['PY3'], name: 'Hansa Yellow Light', hex: '#e6ea3c', lean: 'yellow, leaning green (cool)' },
  { id: 'py97', code: 'PY97', codes: ['PY97'], name: 'Hansa Yellow Medium', hex: '#f2c62b', lean: 'yellow, near the middle' },
  { id: 'py35', code: 'PY35', codes: ['PY35'], name: 'Cadmium Yellow', hex: '#f2c230', lean: 'yellow, leaning orange (warm)' },
  { id: 'py150', code: 'PY150', codes: ['PY150'], name: 'Nickel Azo Yellow', hex: '#d9a521', lean: 'a muted yellow, leaning orange (warm)' },
  { id: 'po49', code: 'PO49', codes: ['PO49'], name: 'Quinacridone Gold', hex: '#c98a1d', lean: 'a muted yellow-orange (warm)' },
  { id: 'py43', code: 'PY43', codes: ['PY43'], name: 'Yellow Ochre', hex: '#c8962e', lean: 'a muted yellow, an earth (warm)' },
  { id: 'pbr7-raw-sienna', code: 'PBr7', codes: ['PBr7'], name: 'Raw Sienna', hex: '#b5762f', lean: 'a muted yellow-orange, an earth (warm)' },
  { id: 'pbr7-burnt-sienna', code: 'PBr7', codes: ['PBr7'], name: 'Burnt Sienna', hex: '#8f4a2a', lean: 'a muted orange-red, an earth (warm)' },
  { id: 'pbr7-raw-umber', code: 'PBr7', codes: ['PBr7'], name: 'Raw Umber', hex: '#5e4a36', lean: 'a dull brown, leaning green (cool earth)' },
  { id: 'pbr7-burnt-umber', code: 'PBr7', codes: ['PBr7'], name: 'Burnt Umber', hex: '#4e3424', lean: 'a dark brown, leaning red (warm earth)' },
  { id: 'po73', code: 'PO73', codes: ['PO73'], name: 'Pyrrol Orange', hex: '#e2582a', lean: 'orange, leaning red (warm)' },
  { id: 'po20', code: 'PO20', codes: ['PO20'], name: 'Cadmium Orange', hex: '#e86f2a', lean: 'orange (warm)' },
  { id: 'pr255', code: 'PR255', codes: ['PR255'], name: 'Pyrrol Scarlet', hex: '#d33a2c', lean: 'red, leaning orange (warm)' },
  { id: 'pr108', code: 'PR108', codes: ['PR108'], name: 'Cadmium Red', hex: '#c8322b', lean: 'red, leaning orange (warm)' },
  // Crimsons: cool reds, leaning toward blue. "Crimson" is a marketing
  // name; the pigment behind it varies by brand (PR83, PR264, PV19 blends),
  // so the sketcher picks by the pigment on the tube.
  { id: 'pr83', code: 'PR83', codes: ['PR83'], name: 'Alizarin Crimson', hex: '#9e1f3a', lean: 'red, leaning blue (cool)' },
  { id: 'pr264', code: 'PR264', codes: ['PR264'], name: 'Pyrrole Crimson', hex: '#b22a3c', lean: 'red, leaning blue (cool)' },
  { id: 'pv19', code: 'PV19', codes: ['PV19'], name: 'Quinacridone Rose', hex: '#c23b6e', lean: 'pink-red, leaning blue (cool)' },
  { id: 'pr122', code: 'PR122', codes: ['PR122'], name: 'Quinacridone Magenta', hex: '#a8326b', lean: 'magenta, leaning violet (cool)' },
  { id: 'pv23', code: 'PV23', codes: ['PV23'], name: 'Dioxazine Violet', hex: '#4b2c6e', lean: 'violet, leaning blue (cool)' },
  { id: 'pb29', code: 'PB29', codes: ['PB29'], name: 'Ultramarine Blue', hex: '#24359a', lean: 'blue, leaning violet (warm)' },
  { id: 'pb28', code: 'PB28', codes: ['PB28'], name: 'Cobalt Blue', hex: '#2f5aa8', lean: 'blue, near the middle' },
  { id: 'pb35', code: 'PB35', codes: ['PB35'], name: 'Cerulean Blue', hex: '#3a86b8', lean: 'blue, leaning green (cool)' },
  { id: 'pb15-3', code: 'PB15:3', codes: ['PB15:3'], name: 'Phthalo Blue', hex: '#0f5e9c', lean: 'blue, leaning green (cool)' },
  { id: 'pb60', code: 'PB60', codes: ['PB60'], name: 'Indanthrone Blue', hex: '#253b6e', lean: 'a dark blue, leaning violet (warm)' },
  { id: 'pg7', code: 'PG7', codes: ['PG7'], name: 'Phthalo Green', hex: '#11695a', lean: 'green, leaning blue (cool)' },
  { id: 'pg18', code: 'PG18', codes: ['PG18'], name: 'Viridian', hex: '#1f7a62', lean: 'green, leaning blue (cool)' },
  { id: 'pg17', code: 'PG17', codes: ['PG17'], name: 'Chromium Oxide Green', hex: '#5f7a45', lean: 'a muted green, leaning yellow (warm)' },
  { id: 'pbk31', code: 'PBk31', codes: ['PBk31'], name: 'Perylene Green', hex: '#2f3b33', lean: 'a very dark green, near black' },
  { id: 'paynes-gray', code: 'PB29 + PBk9', codes: ['PB29', 'PBk9'], name: "Payne's Gray", hex: '#4b5560', lean: 'a blue-grey (cool)' },
  { id: 'neutral-tint', code: 'PB15 + PV19 + PBk6', codes: ['PB15', 'PV19', 'PBk6'], name: 'Neutral Tint', hex: '#3d3b40', lean: 'a neutral grey-black' },
  { id: 'pbk9', code: 'PBk9', codes: ['PBk9'], name: 'Ivory Black', hex: '#2a2725', lean: 'a warm black' },
  { id: 'pbk6', code: 'PBk6', codes: ['PBk6'], name: 'Lamp Black', hex: '#1f1f1f', lean: 'a cool black' },
  { id: 'pw6', code: 'PW6', codes: ['PW6'], name: 'Titanium White', hex: '#f4f2ec', lean: 'white' },
]

export const BRANDS = [
  'Daniel Smith', 'Winsor & Newton', 'Schmincke', 'ShinHan', 'Holbein',
  'M. Graham', 'Sennelier', 'White Nights', 'Da Vinci',
]

export const paintById = (id) => PAINTS.find((p) => p.id === id)

// A kit paint's id: matched by name first (two paints share PBr7), then by
// its first pigment code.
export function paintForKitItem(item) {
  const label = (item.label || '').toLowerCase()
  return (
    PAINTS.find((p) => label.includes(p.name.toLowerCase())) ||
    PAINTS.find((p) => p.codes[0] === item.pigment_codes?.[0]) ||
    null
  )
}

export const starterPaints = () => STARTER_PALETTE.map((id) => PAINTS.find((p) => p.id === id))

// The paints a sketcher mixes from: the colours in their kit and their
// favourite palette, without repeats. Empty means use starterPaints().
export function kitPaintList(kit = [], favorites = []) {
  const found = [...kit.filter((i) => i.kind === 'color').map(paintForKitItem), ...favorites.map(paintById)].filter(Boolean)
  return [...new Map(found.map((p) => [p.id, p])).values()]
}
