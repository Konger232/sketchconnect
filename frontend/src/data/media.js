// The media card (item 25), the same keys as the backend (plan_read.MEDIA).
// Pick any number; the tips may name only these. None: tool-free tips.
// Shared by New Sketch (CreateSketch.jsx) and Sketch Detail's Tool kit.
export const MEDIA = [
  { group: 'Line', items: [['pencil', 'Pencil'], ['fountain_pen', 'Fountain Pen'], ['fineliner', 'Fine liner'], ['dip_pen', 'Dip Pen'], ['brush_pen', 'Brush Pen']] },
  { group: 'Color', items: [['watercolor', 'Watercolor'], ['gouache', 'Gouache'], ['markers', 'Markers'], ['watercolor_pencils', 'Watercolor pencils'], ['pastels', 'Pastels']] },
]

export const mediaLabel = (key) => MEDIA.flatMap((g) => g.items).find(([k]) => k === key)?.[1] || key
