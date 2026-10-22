"""
The kit reading call (design doc, item 44): one photo of a sketcher's bag
or flat lay, and the tools in it, each with a kind, a short name, an
optional micro-tip and where it sits in the photo. The sketcher confirms
or edits each one as a pin on the photo.

The prompt lives here for now, not in a prompts/ folder: the kit feature
has none yet (to confirm with Chan).
"""
from PIL import Image

from app.core.gemini_service import call_gemini_json

MAX_TOOLS = 20
KINDS = ["line", "ink", "color", "brush", "paper", "extra"]

PROMPT = """# Role & Task
You are looking at one photo of an urban sketcher's kit: the tools spread out on a table, or an open bag. List the sketching tools you can see, and where each one is. You only identify tools. You never judge the kit or suggest buying anything.

# What to list
- Each separate tool once, up to 20, the most clearly visible first.
- `kind`, exactly one of:
  - `line`: pens, fountain pens, fineliners, pencils, brush pens, dip pens.
  - `ink`: bottles or cartridges of ink.
  - `color`: watercolour or gouache palettes, tins, pans, tubes, coloured pencils, markers.
  - `brush`: brushes and water brushes.
  - `paper`: sketchbooks, pads, loose paper.
  - `extra`: everything else a sketcher uses: water cups, clips, paper towel, a stool, an eraser, a sharpener, tape, a viewfinder.
- Skip things that are not sketching tools: phones, keys, wallets, food, people, the bag itself.
- `label`: a short name a sketcher would use, at most 6 words. Use the brand and model only when you can read them or are sure of the shape (for example "Lamy Safari fountain pen", "Pentel water brush", "Moleskine sketchbook"). Otherwise a plain name ("fountain pen", "watercolour palette, 12 pans").
- `note`: at most 5 words, only for something clearly visible that a sketcher would care about, such as "extra fine nib", "cold press, A5" or "half pans". Leave it empty when unsure.
- `box_2d`: the tool's box as [ymin, xmin, ymax, xmax], each from 0 to 1000, on this photo.

Return an empty list when you see no sketching tools.
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "tools": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": KINDS},
                    "label": {"type": "string"},
                    "note": {"type": "string"},
                    "box_2d": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["kind", "label", "box_2d"],
            },
        },
    },
    "required": ["tools"],
}


def read_kit(image: Image.Image) -> list[dict]:
    """The tools in the photo: [{kind, label, note, x, y}], x and y the
    tool's centre from 0 to 1, from the top left."""
    result = call_gemini_json(PROMPT, SCHEMA, image, mock_name="kit_reading")
    tools = []
    for t in (result.get("tools") or [])[:MAX_TOOLS]:
        box = t.get("box_2d") or []
        label = " ".join(str(t.get("label") or "").split())[:80]
        if t.get("kind") not in KINDS or not label or len(box) != 4:
            continue
        ymin, xmin, ymax, xmax = (max(0, min(1000, int(v))) for v in box)
        tools.append({
            "kind": t["kind"],
            "label": label,
            "note": " ".join(str(t.get("note") or "").split()[:5])[:40],
            "x": round((xmin + xmax) / 2000, 3),
            "y": round((ymin + ymax) / 2000, 3),
        })
    return tools
