"""
The kit reading call (design doc, item 44): one photo of a sketcher's bag
or flat lay, and the tools in it, each with a category, a short name, an
optional micro-tip and where it sits in the photo. The sketcher confirms
or edits each one as a pin on the photo.

The prompt lives here for now, not in a prompts/ folder: the kit feature
has none yet (to confirm with Chan).
"""
from PIL import Image

from app.core.gemini_service import call_gemini_json

MAX_TOOLS = 20
CATEGORIES = ["pen", "ink", "brush", "paper", "sketchbook", "palette", "clips", "easel", "bag", "other"]
# Near misses the AI sometimes writes, mapped to a category.
NEAR = {"pencil": "pen", "pencils": "pen", "pens": "pen", "brushes": "brush", "inks": "ink", "sketchbooks": "sketchbook", "palettes": "palette", "marker": "pen", "markers": "pen", "fineliner": "pen",
        "fountain pen": "pen", "gel pen": "pen", "crayon": "pen", "pastel": "pen",
        "paint": "palette", "paints": "palette", "watercolour": "palette", "watercolor": "palette",
        "tube": "palette", "tubes": "palette", "journal": "sketchbook", "notebook": "sketchbook",
        "pad": "paper", "clip": "clips", "tripod": "easel", "pouch": "bag", "case": "bag"}

PROMPT = """# Role & Task
You are looking at one photo of an urban sketcher's kit: the tools spread out on a table, or an open bag. List the sketching tools you can see, and where each one is. You only identify tools. You never judge the kit or suggest buying anything.

# What to list
- Look over the whole photo, corner to corner, before you answer: the middle, the edges and the corners. A flat lay or an open bag usually holds 10 to 20 tools. List each one you can see, the small ones too: pens, fountain pens, gel pens, fineliners, pencils, markers, brushes, ink bottles, paint tubes, an eraser, a sharpener, clips. Do not stop at the biggest few.
- List up to 20 entries, the most clearly visible first.
- A cup, case, tin or roll holding several similar tools is one entry, pinned on the group: "coloured pencils", "brushes, 5", "acrylic markers, 6". Several similar tools lying loose side by side are one entry too ("gel pens, 8"). A tool lying on its own is its own entry.
- `category`, exactly one of:
  - `pen`: pens, fountain pens, fineliners, brush pens, dip pens, pencils, coloured pencils, markers, crayons, pastels.
  - `ink`: bottles or cartridges of ink.
  - `brush`: brushes and water brushes.
  - `paper`: pads, loose sheets, postcards.
  - `sketchbook`: bound sketchbooks and journals.
  - `palette`: watercolour or gouache palettes, tins, pans, tubes.
  - `clips`: clips and bulldog clips.
  - `easel`: easels, tripods and boards on a stand, folded or set up.
  - `bag`: the sketch bag, pouch or case itself whenever it is in the photo, open, behind the tools or beside them. Sketchers choose their bag with care, so always list it.
  - `other`: everything else a sketcher uses to draw or paint: water cups, paper towel, a sketching stool, an eraser, a sharpener, tape, a viewfinder, a bone folder.
- Skip things that are not sketching tools, even when they come along outdoors: hats, sunscreen, tissues, lanyards and badges, water bottles, phones, keys, wallets, food, people.
- `label`: a short name a sketcher would use, at most 6 words. Use the brand and model only when you can read them on the tool, or when the shape is unmistakable (for example "Lamy Safari fountain pen", "Pentel water brush"). Otherwise a plain name ("fountain pen", "watercolour palette, 12 pans").
  - Read every label you can: printing, a sewn-on or woven label, a tag, a patch, a zip pull, an embossed logo. A brand you can read goes in the label, also on a bag. A label that names a material rather than the maker, such as a CORDURA fabric tag on a bag, goes in `note` ("Cordura fabric"), not in the name. Never guess a brand you cannot read. Add a visible colour or pattern when it helps tell the tool apart ("camo sketch bag").
  - Sketchbooks and paper look alike across brands. Name a brand only when you can read it on the cover, spine, band or label. Otherwise "sketchbook" or "watercolour pad".
- `note`: at most 5 words, only for something clearly visible that a sketcher would care about, such as "extra fine nib", "cold press", "half pans" or "Cordura fabric". Leave it empty when unsure. Do not put the size or orientation here.
- For `sketchbook` and `paper` only:
  - `size`: the nearest of "A3", "A4", "A5", "A6", or "square" when the sides look equal. Judge it against the other tools in the photo (a pen is about 14 cm long, a water brush about 15 cm). Leave it empty when you cannot judge.
  - `orientation`: "landscape" when the binding runs along a short side (it opens wide), "portrait" when it runs along a long side. For loose paper or a closed book with no binding visible, use the longer side as it lies. Leave it empty for square, or when unsure.
- `box_2d`: the tool's box as [ymin, xmin, ymax, xmax], each from 0 to 1000, on this photo.

Return an empty list when you see no sketching tools.

# Which way up
- `upright_turn`: how many degrees the photo must turn clockwise so the writing on the tools (labels, brand names, printing on cans, tubes and covers) reads the right way up: 0, 90, 180 or 270. Most of the writing decides. Use 0 when no writing is readable, or when it already reads the right way up.
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "tools": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "enum": CATEGORIES},
                    "label": {"type": "string"},
                    "note": {"type": "string"},
                    # Enums: without them the AI wrote its working-out into
                    # `size` ("A5 Landcape / Portrait check: ..."). Still
                    # checked in _note.
                    "size": {"type": "string", "enum": ["A3", "A4", "A5", "A6", "square"]},
                    "orientation": {"type": "string", "enum": ["landscape", "portrait"]},
                    "box_2d": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["category", "label", "box_2d"],
            },
        },
        "upright_turn": {"type": "integer"},
    },
    "required": ["tools"],
}


def _note(t: dict) -> str:
    """The tip: for a sketchbook or paper, its size and orientation first
    ("A5 landscape, cold press"), for the sketcher to confirm on the pin."""
    note = " ".join(str(t.get("note") or "").split()[:5])[:40]
    if t.get("category") not in ("sketchbook", "paper"):
        return note
    size = t.get("size") if t.get("size") in ("A3", "A4", "A5", "A6", "square") else ""
    turn = t.get("orientation") if t.get("orientation") in ("landscape", "portrait") and size != "square" else ""
    shape = " ".join(x for x in (size, turn) if x)
    return ", ".join(x for x in (shape, note) if x)


def read_kit(image: Image.Image) -> tuple[list[dict], int]:
    """The tools in the photo: [{category, label, note, x, y}], x and y the
    tool's centre from 0 to 1, from the top left; and the clockwise turn
    (0, 90, 180 or 270) that would set the photo upright, read from the
    writing on the tools. A flat lay shot from the other side of the table
    is upside down, and the AI then misses most of the tools (found November
    24, 2026), so the caller turns the photo and reads it again."""
    result = call_gemini_json(PROMPT, SCHEMA, image, mock_name="kit_reading")
    try:
        turn = int(result.get("upright_turn") or 0) % 360
    except (TypeError, ValueError):
        turn = 0
    turn = turn if turn in (90, 180, 270) else 0
    listed = result.get("tools") or []
    tools, dropped = [], 0
    for t in listed[:MAX_TOOLS]:
        label = " ".join(str(t.get("label") or "").split())[:80]
        # Forgiving: an odd category becomes "other", and a box with extra
        # numbers keeps its first four. Only an entry with no name, or no
        # place to pin it, is left out.
        category = str(t.get("category") or "").strip().lower()
        category = NEAR.get(category, category.rstrip("s") if category.rstrip("s") in CATEGORIES else category)
        if category not in CATEGORIES:
            category = "other"
        try:
            box = [int(float(v)) for v in (t.get("box_2d") or [])][:4]
        except (TypeError, ValueError):
            box = []
        if not label or len(box) != 4:
            dropped += 1
            continue
        ymin, xmin, ymax, xmax = (max(0, min(1000, v)) for v in box)
        if ymin > ymax:
            ymin, ymax = ymax, ymin
        if xmin > xmax:
            xmin, xmax = xmax, xmin
        tools.append({
            "category": category,
            "label": label,
            "note": _note(t),
            "x": round((xmin + xmax) / 2000, 3),
            "y": round((ymin + ymax) / 2000, 3),
        })
    print(f"[kit] the AI listed {len(listed)} things; kept {len(tools)}"
          + (f", left out {dropped} with no name or box" if dropped else "")
          + (f"; the photo reads upright turned {turn} degrees" if turn else ""))
    return tools, turn
