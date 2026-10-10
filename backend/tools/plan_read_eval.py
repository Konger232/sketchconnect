"""
Plan read trial (dev only, not part of the app). Design doc item 25.

One Gemini call per sketch, with its own trial prompt and schema. Reads
the sketch's strokes from the database and asks Gemini to place each of
the 8 principles in a group (strong, some, not_yet), with strokes, why
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

GROUPS = ["strong", "some", "not_yet"]
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

# What to return

principles: all 8 principles, each exactly once, sorted from the one the plan shows
most to the one it shows least. Put each in a group:
- strong: the strokes build it on their own. One stroke is enough when its element
  clearly makes the principle (a single loop setting one subject apart is emphasis).
- some: the strokes start it, and the photo would carry the rest. A some principle needs
  at least one stroke that no principle above it already uses.
- not_yet: no stroke carries it. The photo may still offer it.
Do not stretch a reason to fill a group. When in doubt, use not_yet.
For strong and some: mark_ids (the strokes that carry it), elements (the elements those
strokes use; prefer a pair the matrix marks strong), why (12 words or fewer, plain,
about this scene), and 1 or 2 tips.
For not_yet: mark_ids empty, elements empty, why empty, and exactly 1 tip on how the
sketcher could bring it in from what is in the photo.

relationships: up to 2, from the strokes and shapes, using the relationship types above.
Each belongs to one strong or some principle: set principle to it, and use the type
whose principle matches. Each has type, principle, objects (1 or 2 short names of parts
of the scene, by the type's one-object rule), mark_ids, why (12 words or fewer) and 1 or
2 tips. A relationship says how two parts relate inside its principle. Do not repeat
the principle's own why or tips.

Tips are art technique, said plainly. Each tip has a name of 3 words or fewer and a tip
of 10 words or fewer that starts with a verb.
Example: name "Line weight", tip "Press hard up close, lighter going back."
$media

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
        "required": ["principles", "relationships"],
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
        if p.get("group") in ("strong", "some") and not [i for i in ids if i in visible]:
            notes.append(f"{name}: {p['group']} with no strokes, would move to not_yet")
        if p.get("group") == "some" and ids and set(ids) <= used:
            notes.append(f"{name}: some with no new strokes ({', '.join(ids)} used above), would move to not_yet")
        if p.get("group") in ("strong", "some"):
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
    shown = {p["principle"] for p in raw.get("principles", []) if p.get("group") in ("strong", "some")}
    for r in raw.get("relationships", []):
        bad = [i for i in r.get("mark_ids", []) if i not in visible]
        if bad:
            notes.append(f"relationship {r.get('type')}: unknown strokes {bad}")
        if r.get("principle") not in shown:
            notes.append(f"relationship {r.get('type')}: under {r.get('principle')}, which is not strong or some")
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


def media_text(media: list[str]) -> str:
    if not media:
        return "The sketcher has not said what they draw with. Do not name any tool or medium."
    names = ", ".join(MEDIA_NAMES[k] for k in media)
    return (f"The sketcher draws with: {names}. A tip may name one of these, and only these, "
            "when the medium changes how to do it. Never name another tool or medium.")


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
    raw, raw_text = call_gemini_json_with_raw(prompt, schema(), [photo, plan.image], mock_name="marks_analysis")
    visible = plan.visible_ids
    order = {g: i for i, g in enumerate(GROUPS)}
    raw["principles"] = sorted(raw.get("principles", []), key=lambda p: order.get(p.get("group"), 9))
    result = {"sketch_id": sid, "raw": raw, "checks": checks(raw, visible, media), "media": media,
              "strokes": [f["id"] for f in plan.geo["marks"]]}
    OUT.mkdir(exist_ok=True)
    (OUT / f"{sid}.json").write_text(json.dumps(result, indent=2))
    plan.image.save(OUT / f"{sid}.plan.png")
    for p in raw["principles"]:
        if p.get("group") in ("strong", "some"):
            highlight(small, plan.marks, set(p.get("mark_ids", []))).save(OUT / f"{sid}.{p['principle']}.png")
    for k, r in enumerate(raw.get("relationships", [])):
        highlight(small, plan.marks, set(r.get("mark_ids", []))).save(OUT / f"{sid}.rel{k}.png")
    return result


MAX_BULLETS = 3


def card_html(raw: dict) -> str:
    """The "Your plan" card as the sketcher sees it (item 25): principles with
    tip bullets, relationship tips folded in with no type, See more, and one
    line per Not yet."""
    e = html.escape
    shown = [p for p in raw.get("principles", []) if p.get("group") in ("strong", "some")]
    later = [p for p in raw.get("principles", []) if p.get("group") == "not_yet"]

    def block(p):
        tips = list(p.get("tips", []))
        for r in raw.get("relationships", []):
            if r.get("principle") == p["principle"]:
                tips += r.get("tips", [])
        li = "".join(f"<li><b>{e(t['name'])}:</b> {e(t['tip'])}</li>" for t in tips[:MAX_BULLETS])
        return f"<div class='p'>{e(p['principle'].capitalize())}</div><ul>{li}</ul>"

    top = "".join(block(p) for p in shown[:2])
    more = "".join(block(p) for p in shown[2:])
    others = "".join(f"<li><b>{e(p['principle'].capitalize())}:</b> {e(p['tips'][0]['tip'])}</li>"
                     for p in later if p.get("tips"))
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
                   if p.get("group") in ("strong", "some") else "")
            shown = "shown" if n < 2 and p.get("group") != "not_yet" else "See more"
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
<div class="row"><img class="plan" src="{e(sid)}.plan.png">{card_html(raw)}</div>
<p>Media: {e(', '.join(MEDIA_NAMES[m] for m in r.get('media', [])) or 'not given')}</p>
<h3>Principles, with their relationships</h3>
<table><tr><th>#</th><th>Principle</th><th>Strokes</th><th>Elements</th><th>Why</th><th>Tips</th><th>Highlight</th></tr>{''.join(rows)}</table>
<h3>Relationships under no shown principle</h3><table><tr><th>Type</th><th>Objects</th><th>Strokes</th><th>Why</th><th>Tips</th><th>Highlight</th></tr>{''.join(rels)}</table>
<h3>Checks (item 25)</h3><ul>{notes}</ul></section>""")
    (OUT / "report.html").write_text(f"""<!doctype html><meta charset="utf-8"><title>Plan read trial</title>
<style>body{{font:14px system-ui;margin:24px;max-width:1300px}}table{{border-collapse:collapse;width:100%}}
td,th{{border:1px solid #ddd;padding:6px;vertical-align:top;text-align:left}}td img{{width:220px}}
img.plan{{width:520px}}tr.strong{{background:#fff8d6}}tr.some{{background:#f3f6ff}}tr.not_yet{{color:#666}}tr.rel td{{background:#fbfbfb;font-size:13px}}
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
