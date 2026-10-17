// Colour helpers for swatches (design handoff: palette bars and chips).

function rgb(hex) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

// '#111' or '#fff', whichever has the higher WCAG contrast on the swatch.
export function readableInk(hex) {
  const l = luminance(hex)
  return contrast(l, luminance('#111111')) >= contrast(l, 1) ? '#111' : '#fff'
}

// Hue in degrees and saturation 0-1.
function hueSat(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (d === 0) return [0, 0]
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  const l = (max + min) / 2
  return [(h * 60 + 360) % 360, d / (1 - Math.abs(2 * l - 1))]
}

// Warm (reds, oranges, yellows), then neutral (low saturation), then cool
// (greens, blues, violets), as the palette bars are sorted.
export function warmToCool(paints) {
  const rank = (p) => {
    const [h, s] = hueSat(p.hex)
    if (s < 0.18) return 1000 + (1 - luminance(p.hex))
    const warm = h >= 330 || h < 75
    return warm ? ((h + 30) % 360) : 2000 + h
  }
  return [...paints].sort((a, b) => rank(a) - rank(b))
}
