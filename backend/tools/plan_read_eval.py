"""
Plan read trial (dev only, not part of the app). Design doc item 25.

One Gemini call per sketch, with its own trial prompt and schema. Reads
the sketch's strokes from the database and asks Gemini to place each of
the 8 principles in a group (strong, moderate, none), with strokes, why
and tips, plus up to 2 relationships. The app's marks analysis call and
its cache are not changed or called.

From backend/ (uses your .env, same as the app):
  python -m tools.plan_read_eval --sketch <id> <id>
  python -m tools.plan_read_eval --sketch <id> --media fineliner watercolor

Writes to plan_read_out/: <id>.json, <id>.<principle>.png (its strokes
highlighted) and report.html with every sketch.
"""
import argparse
import html
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance

from config import COACHING_MAX_DIMENSION
from app.core import design_fundamentals as df
from app.core import mark_geometry
from app.core.gemini_service import call_gemini_json_with_raw
from app.features.marks_analysis import question_bank
from app.features.marks_analysis import service

GROUPS = ["strong", "moderate", "none"]
# The media card (item 25). Tips may name only what the sketcher picked.
MEDIA = {
    "line": {"fineliner": "waterproof fineliner", "fountain_pen": "fountain pen", "pencil": "pencil"},
    "color": {"watercolor": "watercolor", "gouache": "gouache", "markers": "markers",
              "watercolor_pencils": "watercolor pencils", "pastels": "pastels"},
}
MEDIA_NAMES = {k: v for group in MEDIA.values() for k, v in group.items()}
TOOL_WORDS = ["ink", "pen", "pens", "marker", "markers", "brush", "pencil", "pencils", "fineliner",
              "fineliners", "watercolor", "watercolors", "watercolour", "gouache", "pastel", "pastels", "crayon"]
OUT = Path("plan_read_out")

PROMPT = """You coach a beginner urban sketcher. Before sketching, they planned the
scene by drawing strokes on the framed photo. Read the plan and give back what it shows.

Image 1 is the framed photo. Image 2 is the same photo with the strokes, each labelled
with its id (m1, m2, ...) at its start. Ids are in stroke order: what the sketcher drew
first is what they set out to plan, so it weighs more.

# Design fundamentals
$fundamentals

# Relationship types
$bank

# The scene
$scene_facts

# The strokes, in order
$marks_table

# Shapes (strokes that touch or continue each other)
$groups

# What a stroke is about

A stroke points at a part of the scene. Its element comes from what it points at in the
photo, not from the stroke's own shape. A line drawn along a red sign is about color. A
loop around a bright patch is about color or value. A line along a roof edge is about
line or shape. Look at Image 1 under each stroke before you decide.

# What to return

principles: all 8 principles, each exactly once, sorted from the one the plan shows
most to the one it shows least. Put each in a group:
- strong: the strokes build it on their own. One stroke is enough when its element
  clearly makes the principle (a single loop setting one subject apart is emphasis).
- moderate: the strokes start it, and the photo would carry the rest. A moderate principle
  needs at least one stroke that no principle above it already uses.
- none: no stroke carries it. The photo may still offer it.
Do not stretch a reason to fill a group. When in doubt, use none.
For strong and moderate: mark_ids (the strokes that carry it), elements (prefer a pair the
matrix marks strong), why (12 words or fewer, plain,
about this scene), and 1 or 2 tips.
For none: mark_ids empty, elements empty, why empty, and exactly 1 tip on how the
sketcher could bring it in from what is in the photo.

relationships: from the strokes and shapes, using the relationship types above. Each
belongs to one strong or moderate principle: set principle to it, and use the type whose
principle matches. Up to 2 per principle, and no relationship for a none principle. Each has type, principle,
objects (1 or 2 short names of parts of the scene, by the type's one-object rule),
mark_ids, why (12 words or fewer) and exactly 1 tip. A relationship says how two parts relate inside its principle. Do not repeat
the principle's own why or tips.

Tips are art technique, said plainly. Each tip has a name of 3 words or fewer and a tip
of 10 words or fewer that starts with a verb.
Example: name "Line weight", tip "Press hard up close, lighter going back."
$media

strokes: every stroke once, with its depth (foreground, middle or background), read from
what it points at in the photo, not from where it sits on the page.

Framing is an entrance, or one or more foreground objects, around a subject further back
that lead the eye to it. Every framing object is nearer than the subject.

Never write stroke ids in why or tips.
"""


def schema() -> dict:
    ids = {"type": "array", "items": {"type": "string"}}
    tip = {"type": "object", "properties": {"name": {"type": "string"}, "tip": {"type": "string"}},
           "required": ["name", "tip"]}
    tips = {"type": "array", "items": tip}
    return {
        "type": "object",
        "properties": {
            "principles": {"type": "array", "items": {
                "type": "object",
                "properties": {
                    "principle": {"type": "string", "enum": df.principle_keys()},
                    "group": {"type": "string", "enum": GROUPS},
                    "mark_ids": ids,
                    "elements": {"type": "array", "items": {"type": "string", "enum": df.element_keys()}},
                    "why": {"type": "string"},
                    "tips": tips,
                },
                "required": ["principle", "group", "mark_ids", "elements", "why", "tips"],
            }},
            "strokes": {"type": "array", "items": {
                "type": "object",
                "properties": {"mark_id": {"type": "string"}, "depth": {"type": "string", "enum": DEPTHS}},
                "required": ["mark_id", "depth"],
            }},
            "relationships": {"type": "array", "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": question_bank.relationship_types()},
                    "principle": {"type": "string", "enum": df.principle_keys()},
                    "objects": {"type": "array", "items": {"type": "string"}},
                    "mark_ids": ids,
                    "why": {"type": "string"},
                    "tips": tips,
                },
                "required": ["type", "principle", "objects", "mark_ids", "why", "tips"],
            }},
        },
        "required": ["strokes", "principles", "relationships"],
    }


def words(s: str) -> int:
    return len((s or "").split())


def _tools_named(text: str) -> set[str]:
    low = re.findall(r"[a-z]+", (text or "").lower())
    return {w for w in low if w in TOOL_WORDS}


def checks(raw: dict, visible: set[str], media: list[str]) -> list[str]:
    """What item 25's clean() would flag. Reported, not applied."""
    notes, seen, used = [], [], set()
    allowed = {w + s for k in media for w in MEDIA_NAMES[k].lower().split() for s in ("", "s")}
    for p in raw.get("principles", []):
        name = p.get("principle")
        seen.append(name)
        ids = p.get("mark_ids", [])
        bad = [i for i in ids if i not in visible]
        if bad:
            notes.append(f"{name}: unknown strokes {bad}")
        if p.get("group") in ("strong", "moderate") and not [i for i in ids if i in visible]:
            notes.append(f"{name}: {p['group']} with no strokes, would move to none")
        if p.get("group") == "moderate" and ids and set(ids) <= used:
            notes.append(f"{name}: moderate with no new strokes ({', '.join(ids)} used above), would move to none")
        if p.get("group") in ("strong", "moderate"):
            used |= set(ids)
        for e in p.get("elements", []):
            c = df.cell(e, name)
            if not c or c.get("strength") not in ("strong", "medium"):
                ok = [x for x in df.element_keys() if (df.cell(x, name) or {}).get("strength") in ("strong", "medium")]
                notes.append(f"{name}: element {e} is {c.get('strength') if c else 'not in the matrix'}, "
                             f"would switch to one of {ok}")
        for t in p.get("tips", []):
            extra = _tools_named(t.get("tip", "") + " " + t.get("name", "")) - allowed
            if extra:
                notes.append(f"{name}: tip names a medium not picked {sorted(extra)}")
        if words(p.get("why")) > 12:
            notes.append(f"{name}: why is {words(p['why'])} words")
        for t in p.get("tips", []):
            if words(t.get("name")) > 3 or words(t.get("tip")) > 10:
                notes.append(f"{name}: long tip '{t.get('name')}: {t.get('tip')}'")
    missing = set(df.principle_keys()) - set(seen)
    if missing:
        notes.append(f"missing principles: {sorted(missing)}")
    dup = {p for p in seen if seen.count(p) > 1}
    if dup:
        notes.append(f"repeated principles: {sorted(dup)}")
    shown = {p["principle"] for p in raw.get("principles", []) if p.get("group") in ("strong", "moderate")}
    per = {}
    for r in raw.get("relationships", []):
        bad = [i for i in r.get("mark_ids", []) if i not in visible]
        if bad:
            notes.append(f"relationship {r.get('type')}: unknown strokes {bad}")
        per[r.get("principle")] = per.get(r.get("principle"), 0) + 1
        if per[r.get("principle")] == 3:
            notes.append(f"{r.get('principle')}: more than 2 relationships, the rest would be cut")
        if r.get("principle") not in shown:
            notes.append(f"relationship {r.get('type')}: under {r.get('principle')}, which is not strong or moderate")
        typed = question_bank.load_bank().get("relationship", {}).get("types", {}).get(r.get("type"), {})
        if typed.get("principle") and typed["principle"] != r.get("principle"):
            notes.append(f"relationship {r.get('type')}: type is {typed['principle']}, placed under {r.get('principle')}")
        for t in r.get("tips", []):
            extra = _tools_named(t.get("tip", "") + " " + t.get("name", "")) - allowed
            if extra:
                notes.append(f"relationship {r.get('type')}: tip names a medium not picked {sorted(extra)}")
    return notes


def highlight(photo: Image.Image, marks: list[dict], ids: set[str]) -> Image.Image:
    img = ImageEnhance.Brightness(photo.convert("RGB")).enhance(0.55)
    W, H = img.size
    d = ImageDraw.Draw(img)
    for i, m in enumerate(marks):
        mid = mark_geometry.mark_id(m, i)
        pts = [(x * W / 1000, y * H / 1000) for x, y in m.get("points", [])]
        if len(pts) < 2:
            continue
        on = mid in ids
        d.line(pts, fill="#ffd400" if on else "#9a9a9a", width=6 if on else 2, joint="curve")
        if on:
            d.text((pts[0][0] + 6, pts[0][1] - 14), mid, fill="#ffd400")
    return img


DEPTHS = ["foreground", "middle", "background"]
MAX_STRONG = 3


def areas(marks: list[dict], aspect: float, depth: dict[str, str]) -> list[list[str]]:
    """Item 25 areas: shapes joined one level up, after the call.
    - Shapes that touch, in any stroke order, join when at the same depth
      (or either depth is unknown).
    - A stroke sitting inside a frame joins it, across depth: its centre falls
      within the frame's box (with a margin) and the frame is nearer. The frame
      is one shape, or nearer strokes on opposite sides (left and right, or
      above and below).
    Guides and big strokes never join."""
    from app.core import mark_geometry as g
    geo = g.analyse(marks, aspect)
    vis = g.visible_marks(marks)
    ids = [g.mark_id(m, i) for i, m in enumerate(vis)]
    if not ids:
        return []
    sx, sy = g.square_scale(aspect)
    sq = {ids[i]: g._to_square(m, sx, sy) for i, m in enumerate(vis)}
    free = {i: not (g.is_guide(sq[i]) or g.is_big(sq[i])) for i in ids}
    rank = {d: n for n, d in enumerate(DEPTHS)}
    gid = {m: grp["id"] for grp in geo["groups"] for m in grp["mark_ids"]}
    parent = {grp["id"]: grp["id"] for grp in geo["groups"]}

    def root(x):
        while parent[x] != x:
            x = parent[x]
        return x

    why = []

    def join(a, b, reason=""):
        if root(a) != root(b) and reason:
            why.append(reason)
        parent[root(b)] = root(a)

    def same_depth(a, b):
        da, db = depth.get(a), depth.get(b)
        return da is None or db is None or da == db

    def nearer(a, b):  # a not farther than b (a truck in a gate is at the gate's depth); unknown passes
        da, db = depth.get(a), depth.get(b)
        return da is None or db is None or rank[da] <= rank[db]

    for ln in geo["links"]:
        if ln["kind"] in ("connects", "crosses", "runs_along", "contains", "inside") \
                and free[ln["a"]] and free[ln["b"]] and same_depth(ln["a"], ln["b"]):
            join(gid[ln["a"]], gid[ln["b"]], f"{ln['a']} {ln['kind']} {ln['b']}")

    box = {m: g._box(sq[m]["points"]) for m in ids}
    pad = g.SNAP + 10
    for m in ids:
        if not free[m] or g.kind(sq[m]) == "straight line":  # a straight line is a framing piece, not a subject
            continue
        x0, y0, x1, y1 = box[m]
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        # one nearer shape around it
        for grp in geo["groups"]:
            # A frame is open, like a doorway: a loop drawn around a subject
            # is not one. It is wider and taller than what it frames.
            if grp["id"] == gid[m] or not all(free[k] for k in grp["mark_ids"]) \
                    or any(g.kind(sq[k]) == "closed shape" for k in grp["mark_ids"]):
                continue
            a0, b0, a1, b1 = g._box([q for k in grp["mark_ids"] for q in sq[k]["points"]])
            if a0 - pad <= cx <= a1 + pad and b0 - pad <= cy <= b1 + pad \
                    and a1 - a0 > x1 - x0 and b1 - b0 > y1 - y0 \
                    and all(nearer(k, m) for k in grp["mark_ids"]):
                join(grp["id"], gid[m], f"{m} inside {'+'.join(grp['mark_ids'])}")
        # nearer strokes on opposite sides
        # Framing pieces close by (within twice the subject's size): left and
        # right level with its centre, the top over its centre. Never below: a wall between its roof and the ground is
        # not framed.
        w, h = x1 - x0, y1 - y0
        reach = max(2 * max(w, h), 100)  # how far a framing piece may stand from it
        near = [k for k in ids if k != m and free[k] and depth.get(k) and depth.get(m) and nearer(k, m)
                and gid[k] != gid[m] and g.kind(sq[k]) != "closed shape"]
        left = [k for k in near if x0 - reach <= box[k][2] <= x0 + pad and box[k][1] - pad <= cy <= box[k][3] + pad]
        right = [k for k in near if x1 - pad <= box[k][0] <= x1 + reach and box[k][1] - pad <= cy <= box[k][3] + pad]
        top = [k for k in near if y0 - reach <= box[k][3] <= y0 + pad and box[k][0] - pad <= cx <= box[k][2] + pad]
        sides = {}
        if left:
            sides["left"] = max(left, key=lambda k: box[k][2])
        if right:
            sides["right"] = min(right, key=lambda k: box[k][0])
        if top:
            sides["top"] = max(top, key=lambda k: box[k][3])
        # A frame: left and right (two pillars, two trees), or the top with a
        # side it meets (an arch, a doorway, a tree with its branch over).
        # The ground below is never part of a frame.
        touching = {frozenset((ln["a"], ln["b"])) for ln in geo["links"]}

        def corner(side):  # the top piece meets that side, as a beam meets a pillar
            return side in sides and frozenset((sides["top"], sides[side])) in touching

        if ("left" in sides and "right" in sides) or ("top" in sides and (corner("left") or corner("right"))):
            pieces = " + ".join(f"{k} {v}" for k, v in sides.items())
            for k in sides.values():
                join(gid[k], gid[m], f"{m} framed by {pieces}")

    out: dict[str, list[str]] = {}
    for grp in geo["groups"]:
        out.setdefault(root(grp["id"]), []).extend(grp["mark_ids"])
    order = {m: i for i, m in enumerate(ids)}
    areas.why = why  # for the report
    return sorted((sorted(v, key=order.get) for v in out.values()), key=lambda v: order[v[0]])


def tidy(raw: dict, visible: set[str], media: list[str], stroke_order: list[str],
         area_list: list[list[str]] | None = None) -> dict:
    """Item 25's clean() rules, applied: what the card would show. The table in
    the report keeps Gemini's raw answer."""
    import copy
    allowed = {w + s for k in media for w in MEDIA_NAMES[k].lower().split() for s in ("", "s")}
    pos = {m: i for i, m in enumerate(stroke_order)}
    groups = ["strong", "moderate", "none"]
    principles = copy.deepcopy(raw.get("principles", []))
    rels = copy.deepcopy(raw.get("relationships", []))

    # A stroke ranks by the earliest stroke in its area (item 25).
    lead = dict(pos)
    for a in area_list or []:
        lo = min(pos.get(m, 10 ** 6) for m in a)
        for m in a:
            lead[m] = lo
    gem = {p["principle"]: n for n, p in enumerate(principles)}  # Gemini's order

    def first(p):
        ids = [lead[i] for i in p.get("mark_ids", []) if i in lead]
        return min(ids) if ids else 10 ** 6

    def to_none(p):
        p["group"], p["mark_ids"], p["elements"], p["why"] = "none", [], [], ""
        p["tips"] = p.get("tips", [])[:1]

    def ok_tip(t):
        return not (_tools_named(t.get("tip", "") + " " + t.get("name", "")) - allowed) \
            and words(t.get("name")) <= 3 and words(t.get("tip")) <= 10

    for p in principles:
        p["mark_ids"] = [i for i in p.get("mark_ids", []) if i in visible]
        if p.get("group") in ("strong", "moderate") and not p["mark_ids"]:
            to_none(p)
        # weak element: switch to a strong or medium one on the principle's row
        good = [x for x in df.element_keys() if (df.cell(x, p["principle"]) or {}).get("strength") in ("strong", "medium")]
        els = [e for e in p.get("elements", []) if e in good]
        if p.get("elements") and not els and good:
            els = [good[0]]
        p["elements"] = els
        # tips: no unpicked medium, word limits, a medium named in one tip at most
        kept, named = [], False
        for t in p.get("tips", []):
            if not ok_tip(t):
                continue
            has = bool(_tools_named(t.get("tip", "") + " " + t.get("name", "")))
            if has and named:
                continue
            named = named or has
            kept.append(t)
        p["tips"] = kept

    # Which principles stand: in Gemini's order (its read of strength), a
    # principle whose strokes are all used by one Gemini ranked above it moves
    # to none. Which leads: strong, then moderate, each by its area's earliest
    # stroke, Gemini's order breaking ties.
    principles.sort(key=lambda p: (groups.index(p.get("group", "none")), gem[p["principle"]]))
    # At most MAX_STRONG strong, Gemini's strongest; the rest become moderate.
    strong = [p for p in principles if p.get("group") == "strong"]
    for p in strong[MAX_STRONG:]:
        p["group"] = "moderate"
    principles.sort(key=lambda p: (groups.index(p.get("group", "none")), gem[p["principle"]]))
    used = set()
    for p in principles:
        if p.get("group") in ("strong", "moderate"):
            if p["mark_ids"] and set(p["mark_ids"]) <= used:
                to_none(p)
            else:
                used |= set(p["mark_ids"])
    principles.sort(key=lambda p: (groups.index(p.get("group", "none")),
                                   first(p) if p.get("group") != "none" else 0, gem[p["principle"]]))

    shown = {p["principle"]: p for p in principles if p.get("group") in ("strong", "moderate")}
    types = question_bank.load_bank()["relationship"]["types"]
    kept_rels, per = [], {}
    for r in rels:
        # A relationship sits under its type's principle. Placed elsewhere, it
        # moves there when that principle is shown, else it is dropped.
        home = (types.get(r.get("type")) or {}).get("principle")
        if home and home != r.get("principle"):
            r["principle"] = home
        p = shown.get(r.get("principle"))
        if not p or per.get(r["principle"], 0) >= 2:
            continue
        own = [set(re.findall(r"[a-z]+", t.get("tip", "").lower())) for t in p.get("tips", [])]

        def repeats(t):
            w = set(re.findall(r"[a-z]+", t.get("tip", "").lower()))
            return any(len(w & o) / max(1, len(w | o)) >= 0.5 for o in own)
        r["mark_ids"] = [i for i in r.get("mark_ids", []) if i in visible]
        r["tips"] = [t for t in r.get("tips", []) if ok_tip(t) and not repeats(t)]
        if not r["tips"]:
            continue
        per[r["principle"]] = per.get(r["principle"], 0) + 1
        kept_rels.append(r)
    return {"principles": principles, "relationships": kept_rels}


def media_text(media: list[str]) -> str:
    if not media:
        return "The sketcher has not said what they draw with. Do not name any tool or medium."
    names = ", ".join(MEDIA_NAMES[k] for k in media)
    return (f"The sketcher draws with: {names}. Name a medium only when the technique depends on "
            "it (a wash, a dry edge, pressing harder with a pen), and in at most one tip per "
            "principle. Most tips should name no medium. Never name a tool or medium not listed.")


NO_STROKES = """
# No strokes

The sketcher drew no strokes. There is no plan to read. Put all 8 principles in none,
sorted from the one the photo offers most to the one it offers least. Each gets
exactly 1 tip on how to bring that principle in from what is in the photo. Return no
relationships.
"""


def run(sid: str, sketch, photo: Image.Image, media: list[str]) -> dict:
    from app.features.scene_analysis import service as scene_service
    from app.features.scene_analysis.router import cached_scene

    photo = scene_service.resize_if_needed(photo)
    small = scene_service.resize_if_needed(photo, COACHING_MAX_DIMENSION)
    plan = service.build_plan(sketch, small)
    prompt = (PROMPT
              .replace("$fundamentals", df.render_text())
              .replace("$bank", question_bank.render_bank())
              .replace("$scene_facts", service.scene_facts(cached_scene(sketch), sketch))
              .replace("$marks_table", mark_geometry.marks_table(plan.geo))
              .replace("$groups", mark_geometry.groups_text(plan.geo))
              .replace("$media", media_text(media)))
    if not plan.marks:
        prompt += NO_STROKES
    raw, raw_text = call_gemini_json_with_raw(prompt, schema(), [photo, plan.image], mock_name="marks_analysis")
    visible = plan.visible_ids
    order = {g: i for i, g in enumerate(GROUPS)}
    raw["principles"] = sorted(raw.get("principles", []), key=lambda p: order.get(p.get("group"), 9))
    stroke_order = [f["id"] for f in plan.geo["marks"]]
    notes = checks(raw, visible, media)
    if not plan.marks:
        notes += [f"no strokes: {p['principle']} is {p.get('group')}" for p in raw["principles"]
                  if p.get("group") != "none"]
        notes += [f"no strokes: relationship {r.get('type')} returned" for r in raw.get("relationships", [])]
    depth = {s["mark_id"]: s["depth"] for s in raw.get("strokes", []) if s.get("mark_id") in visible}
    area_list = areas(sketch.marks, plan.aspect, depth) if plan.marks else []
    result = {"sketch_id": sid, "raw": raw, "depth": depth, "areas": area_list,
              "tidy": tidy(raw, visible, media, stroke_order, area_list),
              "checks": notes, "media": media, "strokes": stroke_order}
    OUT.mkdir(exist_ok=True)
    (OUT / f"{sid}.json").write_text(json.dumps(result, indent=2))
    (plan.image or small).save(OUT / f"{sid}.plan.png")
    for p in raw["principles"]:
        if p.get("group") in ("strong", "moderate"):
            highlight(small, plan.marks, set(p.get("mark_ids", []))).save(OUT / f"{sid}.{p['principle']}.png")
    for k, r in enumerate(raw.get("relationships", [])):
        highlight(small, plan.marks, set(r.get("mark_ids", []))).save(OUT / f"{sid}.rel{k}.png")
    return result


MAX_BULLETS = 3


def card_html(raw: dict) -> str:
    """The "Your plan" card as the sketcher sees it (item 25): principles with
    tip bullets, relationship tips folded in with no type, See more, and one
    line per none."""
    e = html.escape
    shown = [p for p in raw.get("principles", []) if p.get("group") in ("strong", "moderate")]
    later = [p for p in raw.get("principles", []) if p.get("group") == "none"]

    def block(p):
        tips = list(p.get("tips", []))
        for r in raw.get("relationships", []):
            if r.get("principle") == p["principle"]:
                tips += r.get("tips", [])
        li = "".join(f"<li><b>{e(t['name'])}:</b> {e(t['tip'])}</li>" for t in tips[:MAX_BULLETS])
        return f"<div class='p'>{e(p['principle'].capitalize())}</div><ul>{li}</ul>"

    def line(p):
        return f"<li><b>{e(p['principle'].capitalize())}:</b> {e(p['tips'][0]['tip'])}</li>"

    later = [p for p in later if p.get("tips")]
    if not shown:
        # No strokes, or none that carry a principle: ideas from the photo.
        top = f"<ul>{''.join(line(p) for p in later[:2])}</ul>"
        rest = "".join(line(p) for p in later[2:])
        if rest:
            top += f"<details><summary>See more</summary><ul>{rest}</ul></details>"
        return f"<div class='card'><div class='h'>Ideas for this scene</div>{top}</div>"
    top = "".join(block(p) for p in shown[:2])
    more = "".join(block(p) for p in shown[2:])
    others = "".join(line(p) for p in later)
    if others:
        more += f"<div class='p'>Other possibilities</div><ul>{others}</ul>"
    if more:
        top += f"<details><summary>See more</summary>{more}</details>"
    return f"<div class='card'><div class='h'>Your plan</div>{top}</div>"


def report() -> None:
    e = html.escape
    cards = []
    for jp in sorted(OUT.glob("*.json")):
        r = json.loads(jp.read_text())
        sid, raw = r["sketch_id"], r["raw"]
        rows = []
        rels_of = {}
        for k, x in enumerate(raw.get("relationships", [])):
            rels_of.setdefault(x.get("principle"), []).append((k, x))
        for n, p in enumerate(raw.get("principles", [])):
            tips = "<br>".join(f"<b>{e(t['name'])}:</b> {e(t['tip'])}" for t in p.get("tips", []))
            img = (f'<img src="{e(sid)}.{e(p["principle"])}.png">'
                   if p.get("group") in ("strong", "moderate") else "")
            shown = "shown" if n < 2 and p.get("group") != "none" else "See more"
            rows.append(f"<tr class='{e(p.get('group', ''))}'><td>{n+1}</td><td><b>{e(p['principle'])}</b><br>"
                        f"<span class='g'>{e(p.get('group', ''))}</span> · {shown}</td>"
                        f"<td>{e(', '.join(p.get('mark_ids', [])))}</td><td>{e(', '.join(p.get('elements', [])))}</td>"
                        f"<td>{e(p.get('why', ''))}</td><td>{tips}</td><td>{img}</td></tr>")
            for k, x in rels_of.pop(p["principle"], []):
                rtips = "<br>".join(f"<b>{e(t['name'])}:</b> {e(t['tip'])}" for t in x.get("tips", []))
                rows.append(f"<tr class='rel'><td></td><td>↳ <b>{e(x['type'])}</b><br>"
                            f"{e(' / '.join(x.get('objects', [])))}</td><td>{e(', '.join(x.get('mark_ids', [])))}</td>"
                            f"<td></td><td>{e(x.get('why', ''))}</td><td>{rtips}</td>"
                            f"<td><img src='{e(sid)}.rel{k}.png'></td></tr>")
        orphans = [x for v in rels_of.values() for x in v]
        rels = []
        for k, x in orphans:
            tips = "<br>".join(f"<b>{e(t['name'])}:</b> {e(t['tip'])}" for t in x.get("tips", []))
            rels.append(f"<tr><td><b>{e(x['type'])}</b></td><td>{e(' / '.join(x.get('objects', [])))}</td>"
                        f"<td>{e(', '.join(x.get('mark_ids', [])))}</td><td>{e(x.get('why', ''))}</td>"
                        f"<td>{tips}</td><td><img src='{e(sid)}.rel{k}.png'></td></tr>")
        notes = "".join(f"<li>{e(c)}</li>" for c in r["checks"]) or "<li>none</li>"
        cards.append(f"""<section><h2>{e(sid)}</h2>
<p>Strokes in order: {e(', '.join(r['strokes']))}</p>
<div class="row"><img class="plan" src="{e(sid)}.plan.png">{card_html(r.get('tidy') or raw)}</div>
<p>The card applies the item 25 checks. The table below is Gemini's answer as returned.</p>
<p>Media: {e(', '.join(MEDIA_NAMES[m] for m in r.get('media', [])) or 'not given')}</p>
<p>Depth: {e(', '.join(f"{k} {v[0].upper()}" for k, v in r.get('depth', {}).items()) or 'not returned')}</p>
<p>Areas: {e(' | '.join(', '.join(a) for a in r.get('areas', [])) or 'none')}</p>
<h3>Principles, with their relationships</h3>
<table><tr><th>#</th><th>Principle</th><th>Strokes</th><th>Elements</th><th>Why</th><th>Tips</th><th>Highlight</th></tr>{''.join(rows)}</table>
<h3>Relationships under no shown principle</h3><table><tr><th>Type</th><th>Objects</th><th>Strokes</th><th>Why</th><th>Tips</th><th>Highlight</th></tr>{''.join(rels)}</table>
<h3>Checks (item 25)</h3><ul>{notes}</ul></section>""")
    (OUT / "report.html").write_text(f"""<!doctype html><meta charset="utf-8"><title>Plan read trial</title>
<style>body{{font:14px system-ui;margin:24px;max-width:1300px}}table{{border-collapse:collapse;width:100%}}
td,th{{border:1px solid #ddd;padding:6px;vertical-align:top;text-align:left}}td img{{width:220px}}
img.plan{{width:520px}}tr.strong{{background:#fff8d6}}tr.moderate{{background:#f3f6ff}}tr.none{{color:#666}}tr.rel td{{background:#fbfbfb;font-size:13px}}
.row{{display:flex;gap:24px;align-items:flex-start}}.card{{border:1px solid #ddd;border-radius:12px;padding:16px 20px;width:380px}}
.card .h{{font-size:16px;font-weight:700;margin-bottom:8px}}.card .p{{font-weight:600;margin-top:10px}}
.card ul{{margin:4px 0 0 18px;padding:0}}.card li{{margin:3px 0}}.card summary{{margin-top:12px;color:#555;cursor:pointer}}
.g{{font-size:12px;text-transform:uppercase}}section{{margin-bottom:48px}}</style>
<h1>Plan read trial</h1>{''.join(cards)}""")
    print(f"report: {OUT / 'report.html'}")


def main():
    from tools.scene_eval import cases_from_db
    ap = argparse.ArgumentParser(description="Plan read trial (item 25).")
    ap.add_argument("--sketch", nargs="+", metavar="ID", required=True)
    ap.add_argument("--media", nargs="*", default=[], choices=sorted(MEDIA_NAMES),
                    help="what the sketcher draws with (the media card); none means tool-free tips")
    args = ap.parse_args()
    for sid, _, photo, sketch in cases_from_db(args.sketch):
        r = run(sid, sketch, photo, args.media)
        print(f"{sid}: " + ", ".join(f"{p['principle']}={p['group']}" for p in r["raw"]["principles"]))
        for c in r["checks"]:
            print(f"  check: {c}")
    report()


if __name__ == "__main__":
    main()
