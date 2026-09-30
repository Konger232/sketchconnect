"""
Marks relations test (dev only, not part of the app).

Checks the advisor's three questions (Sept 30) before any app change:
  1. Stroke order and selecting a stroke or a shape. The order is the
     position in sketch.marks; each mark has a stable id (m1, m2, ...).
     app/core/mark_geometry.py groups marks that touch or cross into
     shapes, with no Gemini. Erased marks are left out.
  2. Limits. Printed from the numbers: points per mark, marks, JSON size,
     prompt size.
  3. Can guided questions and options point at specific marks, and can
     Gemini see relationships between marks and between forms? One Gemini
     call with its own test schema (prompts/marks_relations.md). The
     app's scene analysis call is not changed or called.

Writes, per photo, to --out (default ./marks_eval_out):
  <name>.plan.png       Image 2 as sent: marks labelled m1, m2, ... at their start
  <name>.groups.png     each group (shape) in its own colour, guides dashed grey
  <name>.q<N>.png       each guided question with its marks highlighted
  <name>.forms.png      form_relationships: anchor points joined by a line
  <name>.json           geometry + Gemini's answer + token and size numbers
and report.html with every photo.

From backend/ (uses your .env, same as the app):
  python -m tools.marks_eval ../street.heic
  python -m tools.marks_eval ../street.heic --dry-run      # no API call: prompt + images only
  python -m tools.marks_eval --sketch <id> <id>            # real sketches with marks
  python -m tools.marks_eval ../street.heic --redraw       # reuse saved JSON

A photo's marks come from <photo name>.plan.json, the same file
tools/scene_eval.py reads.
"""
import argparse
import html
import re
import json
import time
from pathlib import Path
from types import SimpleNamespace

from PIL import Image, ImageDraw, ImageFont, ImageOps

from app.core import composite
from app.core.prompt_loader import render_prompt
from app.features.scene_analysis import question_bank
from app.core import mark_geometry as geo_mod

PROMPT = Path(__file__).parent / "prompts" / "marks_relations.md"
DRAW_WIDTH = 900
GROUP_COLORS = ["#ffd400", "#00e5ff", "#ff4fd8", "#7CFC00", "#ff9f0a", "#b388ff", "#ff5252"]
HILITE = "#39ff14"


# ---------- inputs ----------

def load_photo(path: Path) -> Image.Image:
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    w, h = im.size
    if max(w, h) > 1600:
        s = 1600 / max(w, h)
        im = im.resize((int(w * s), int(h * s)), Image.LANCZOS)
    return im


def cases_from_files(paths):
    for path in paths:
        plan_path = path.with_name(path.name + ".plan.json")
        if not plan_path.exists():
            plan_path = path.with_suffix(".plan.json")
        raw = json.loads(plan_path.read_text()) if plan_path.exists() else {}
        sketch = SimpleNamespace(
            focal_points=[{"source": "own", **p} for p in raw.get("focal_points", [])],
            marks=raw.get("marks", []),
            style=raw.get("style"),
        )
        yield path.name, path.stem, load_photo(path), sketch


def cases_from_db(ids):
    from tools.scene_eval import cases_from_db as from_db
    yield from from_db(ids)


# ---------- the call ----------

def response_schema() -> dict:
    bank = question_bank.load_bank()
    ids = {"type": "array", "items": {"type": "string"}}
    principle = {"type": "string", "enum": bank["principles"]}
    return {
        "type": "object",
        "properties": {
            "scene_type": {"type": "string", "enum": ["architectural", "still_life_organic", "figure", "open_landscape", "mixed"]},
            "marks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "mark_id": {"type": "string"},
                        "traces": {"type": "string"},
                        "element": {"type": "string", "enum": ["line", "shape", "form", "space", "value"]},
                        "role": {"type": "string", "enum": [
                            "contour", "big_shape", "eye_level", "ground_line", "perspective_guide",
                            "measurement", "alignment", "gesture", "unclear"]},
                        "fit": {"type": "string", "enum": ["close", "loose", "not_applicable"]},
                        "note": {"type": "string"},
                    },
                    "required": ["mark_id", "traces", "element", "role", "fit", "note"],
                },
            },
            "mark_relationships": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "mark_ids": ids,
                        "kind": {"type": "string", "enum": [
                            "alignment", "same_size", "proportion", "overlap_in_depth",
                            "repetition", "leads_to", "contrast_of_size", "containment"]},
                        "principle": principle,
                        "observation": {"type": "string"},
                    },
                    "required": ["mark_ids", "kind", "principle", "observation"],
                },
            },
            "form_relationships": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "forms": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "label": {"type": "string"},
                                    "x": {"type": "integer"},
                                    "y": {"type": "integer"},
                                },
                                "required": ["label", "x", "y"],
                            },
                        },
                        "mark_ids": ids,
                        "kind": {"type": "string", "enum": [
                            "overlap_in_depth", "contrast_of_size", "repetition", "alignment",
                            "leads_to", "same_size", "proportion"]},
                        "principle": principle,
                        "observation": {"type": "string"},
                    },
                    "required": ["forms", "mark_ids", "kind", "principle", "observation"],
                },
            },
            "stroke_order_note": {"type": "string"},
            "prepared_prompts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "enum": question_bank.all_keys()},
                        "focus": {"type": "string", "enum": ["selected", "unseen", "other"]},
                        "question": {"type": "string"},
                        "mark_ids": ids,
                        "form_ref": {"type": "integer"},
                        "options": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {"label": {"type": "string"}, "mark_ids": ids},
                                "required": ["label", "mark_ids"],
                            },
                        },
                    },
                    "required": ["key", "focus", "question", "mark_ids", "form_ref", "options"],
                },
            },
        },
        "required": ["scene_type", "marks", "mark_relationships", "form_relationships",
                     "stroke_order_note", "prepared_prompts"],
    }


def build_prompt(style: str, geo: dict, focal_points) -> str:
    return render_prompt(
        PROMPT,
        style=style,
        marks_table=geo_mod.marks_table(geo),
        groups=geo_mod.groups_text(geo),
        focal_points=composite.describe_focal_points(focal_points),
        prompt_guide=question_bank.render_guide(),
    )


def check(result: dict, geo: dict) -> list[str]:
    """What the app would have to reject or fix. Printed, and shown in the report."""
    known = {m["id"] for m in geo["marks"]}
    problems = []

    def bad(ids, where):
        unknown = [i for i in ids if i not in known]
        if unknown:
            problems.append(f"{where}: unknown mark ids {unknown}")

    got = [m["mark_id"] for m in result.get("marks", [])]
    missing = sorted(known - set(got), key=lambda s: int(s[1:]))
    if missing:
        problems.append(f"marks: no entry for {missing}")
    bad(got, "marks")
    for r in result.get("mark_relationships", []):
        bad(r["mark_ids"], "mark_relationships")
    for r in result.get("form_relationships", []):
        bad(r["mark_ids"], "form_relationships")
        for f in r["forms"]:
            if not (0 <= f["x"] <= 1000 and 0 <= f["y"] <= 1000):
                problems.append(f"form_relationships: {f['label']} point outside the frame")
    bank = question_bank.load_bank()
    eligible = set(question_bank.eligible_keys(result.get("scene_type", "")))
    for p in result.get("prepared_prompts", []):
        bad(p["mark_ids"], f"prompt {p['key']}")
        if p["key"] not in eligible:
            problems.append(f"prompt {p['key']}: not in the bank for {result.get('scene_type')}")
        n = len(bank["questions"].get(p["key"], {}).get("options", []))
        if n and len(p["options"]) != n:
            problems.append(f"prompt {p['key']}: {len(p['options'])} options, bank has {n}")
        for o in p["options"]:
            bad(o["mark_ids"], f"prompt {p['key']} option")
        if re.search(r"\bm\d+\b", p["question"], re.IGNORECASE):
            problems.append(f"prompt {p['key']}: mark id written in the question text")
    prompts = result.get("prepared_prompts", [])
    if not 3 <= len(prompts) <= 4:
        problems.append(f"{len(prompts)} questions, asked for 3 or 4")
    # Order: selected first (when anything is selected), then unseen, then other.
    selected = {m["id"] for m in geo["marks"] if m.get("selected")}
    rank = {"selected": 0, "unseen": 1, "other": 2}
    focuses = [p.get("focus") for p in prompts]
    if [rank.get(f, 3) for f in focuses] != sorted(rank.get(f, 3) for f in focuses):
        problems.append(f"question order is {focuses}, expected selected, then unseen, then other")
    if selected and (not prompts or prompts[0].get("focus") != "selected"):
        problems.append("marks are selected, but the first question is not about them")
    if not selected and "selected" in focuses:
        problems.append("a question has focus 'selected', but nothing is selected")
    if "unseen" not in focuses:
        problems.append("no question about something the sketcher may not have seen")
    forms = result.get("form_relationships", [])
    for p in prompts:
        if p.get("focus") == "selected" and not (set(p["mark_ids"]) & selected):
            problems.append(f"prompt {p['key']}: focus 'selected' but none of its marks are selected")
        ref = p.get("form_ref", -1)
        if p.get("focus") == "unseen" and not 0 <= ref < len(forms):
            problems.append(f"prompt {p['key']}: focus 'unseen' needs a valid form_ref, got {ref}")
        seen = []
        for o in p["options"]:
            if len(o["mark_ids"]) > 3:
                problems.append(f"prompt {p['key']}: option '{o['label']}' points at {len(o['mark_ids'])} marks (max 3)")
            if o["mark_ids"] and sorted(o["mark_ids"]) in seen:
                problems.append(f"prompt {p['key']}: two options point at the same marks")
            seen.append(sorted(o["mark_ids"]))
    return problems


# ---------- drawing ----------

def _font(size):
    for name in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _base(photo: Image.Image, dim=0.0) -> Image.Image:
    h = round(photo.height * DRAW_WIDTH / photo.width)
    im = photo.resize((DRAW_WIDTH, h), Image.LANCZOS)
    if dim:
        im = Image.blend(im, Image.new("RGB", im.size, (0, 0, 0)), dim)
    return im


def _poly(m, W, H):
    return [(x * W / 1000, y * H / 1000) for x, y in m["points"]]


def _stroke(d, pts, color, width, dashed=False):
    if len(pts) == 1:
        x, y = pts[0]
        d.ellipse((x - width, y - width, x + width, y + width), fill=color)
        return
    if not dashed:
        d.line(pts, fill=color, width=width, joint="curve")
        return
    for i in range(0, len(pts) - 1, 2):
        d.line([pts[i], pts[i + 1]], fill=color, width=width)


def _tag(d, xy, text, color, font):
    x, y = xy
    box = d.textbbox((x + 6, y - 22), text, font=font)
    d.rectangle((box[0] - 4, box[1] - 2, box[2] + 4, box[3] + 2), fill="#000000")
    d.text((x + 6, y - 22), text, fill=color, font=font)


def plan_image(photo, marks, focal_points) -> Image.Image:
    """Image 2: the app's planning image plus an id tag at each mark's start."""
    im = composite.draw_plan(photo, focal_points, marks)
    d = ImageDraw.Draw(im)
    font = _font(max(14, im.width // 45))
    for i, m in enumerate(marks):
        x, y = m["points"][0]
        _tag(d, (x * im.width / 1000, y * im.height / 1000), geo_mod.mark_id(m, i), "#ffffff", font)
    return im


def groups_image(photo, marks, geo) -> Image.Image:
    im = _base(photo, 0.45)
    d = ImageDraw.Draw(im)
    font = _font(16)
    color_of = {}
    for n, g in enumerate(geo["groups"]):
        for mid in g["mark_ids"]:
            color_of[mid] = (GROUP_COLORS[n % len(GROUP_COLORS)], g["id"])
    for i, m in enumerate(marks):
        f = geo["marks"][i]
        color, gid = color_of[f["id"]]
        if f["guide"]:
            color = "#bbbbbb"
        _stroke(d, _poly(m, *im.size), color, 4, dashed=f["guide"])
        x, y = _poly(m, *im.size)[0]
        _tag(d, (x, y), f"{f['id']} {gid}", color, font)
    for ln in geo["links"]:
        at = ln.get("at")
        pts = at if at and isinstance(at[0], list) else ([at] if at else [])
        for p in pts:
            x, y = p[0] * im.width / 1000, p[1] * im.height / 1000
            d.ellipse((x - 5, y - 5, x + 5, y + 5), outline="#ffffff", width=2)
    return im


def _caption(im, lines, font):
    pad = 10
    line_h = font.size + 6
    out = Image.new("RGB", (im.width, im.height + pad * 2 + line_h * len(lines)), "#111111")
    out.paste(im, (0, 0))
    d = ImageDraw.Draw(out)
    for n, (text, color) in enumerate(lines):
        d.text((pad, im.height + pad + n * line_h), text, fill=color, font=font)
    return out


def _wrap(text, n=95):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > n:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    return lines + ([cur] if cur else [])


def question_image(photo, marks, prompt, forms=None) -> Image.Image:
    """One guided question: its marks bright, the rest faint, like the app would show it.
    An "unseen" question also shows its form_relationships anchors (orange)."""
    im = _base(photo, 0.35)
    d = ImageDraw.Draw(im)
    font = _font(15)
    on = set(prompt["mark_ids"])
    per_option = {}
    for n, o in enumerate(prompt["options"], 1):
        for mid in o["mark_ids"]:
            per_option.setdefault(mid, []).append(str(n))
    for i, m in enumerate(marks):
        mid = geo_mod.mark_id(m, i)
        pts = _poly(m, *im.size)
        if mid in on:
            _stroke(d, pts, HILITE, 6)
        elif mid in per_option:
            _stroke(d, pts, "#00e5ff", 4)
        else:
            _stroke(d, pts, "#777777", 2)
        if mid in on or mid in per_option:
            tag = mid + (f" opt {','.join(per_option[mid])}" if mid in per_option else "")
            _tag(d, pts[0], tag, HILITE if mid in on else "#00e5ff", font)
    ref = prompt.get("form_ref", -1)
    if forms and 0 <= ref < len(forms):
        pts = [(f["x"] * im.width / 1000, f["y"] * im.height / 1000) for f in forms[ref]["forms"]]
        if len(pts) > 1:
            d.line(pts, fill="#ff9f0a", width=3)
        for f, (x, y) in zip(forms[ref]["forms"], pts):
            d.ellipse((x - 8, y - 8, x + 8, y + 8), fill="#ff9f0a")
            _tag(d, (x, y), f["label"][:26], "#ff9f0a", font)
    lines = [(t, "#ffffff") for t in _wrap(f"[{prompt['key']} / {prompt.get('focus', '?')}] {prompt['question']}")]
    lines.append((f"question marks: {', '.join(prompt['mark_ids']) or 'none'} (green)"
                  + (f"; form_ref {ref} (orange)" if ref is not None and ref >= 0 else ""), HILITE))
    for n, o in enumerate(prompt["options"], 1):
        lines.append((f"{n}. {o['label']}  ->  {', '.join(o['mark_ids']) or 'no marks'} (cyan)", "#00e5ff"))
    return _caption(im, lines, _font(14))


def forms_image(photo, result) -> Image.Image:
    im = _base(photo, 0.3)
    d = ImageDraw.Draw(im)
    font = _font(14)
    lines = []
    for n, r in enumerate(result.get("form_relationships", []), 1):
        color = GROUP_COLORS[(n - 1) % len(GROUP_COLORS)]
        pts = [(f["x"] * im.width / 1000, f["y"] * im.height / 1000) for f in r["forms"]]
        if len(pts) > 1:
            d.line(pts, fill=color, width=3)
        for f, (x, y) in zip(r["forms"], pts):
            d.ellipse((x - 7, y - 7, x + 7, y + 7), fill=color)
            _tag(d, (x, y), f"{n} {f['label'][:26]}", color, font)
        for t in _wrap(f"{n}. {r['kind']} / {r['principle']}: {r['observation']}"):
            lines.append((t, color))
    return _caption(im, lines or [("no form_relationships", "#ffffff")], font)


# ---------- report ----------

def write_report(out: Path) -> None:
    cards = []
    for jf in sorted(out.glob("*.json")):
        data = json.loads(jf.read_text())
        stem, r, geo = jf.stem, data.get("result") or {}, data["geometry"]
        sizes = data["sizes"]
        def li(items):
            return "".join(f"<li>{x}</li>" for x in items) or "<li>none</li>"
        marks = li(
            f"<b>{html.escape(m['mark_id'])}</b> {html.escape(m['traces'])} "
            f"<small>({m['element']}, {m['role']}, fit {m['fit']})</small> {html.escape(m['note'])}"
            for m in r.get("marks", []))
        rels = li(
            f"<b>{', '.join(x['mark_ids'])}</b> {x['kind']} / {x['principle']}: {html.escape(x['observation'])}"
            for x in r.get("mark_relationships", []))
        groups = li(f"{g['id']}: {', '.join(g['mark_ids'])}" for g in geo["groups"])
        problems = li(html.escape(p) for p in data.get("problems", []))
        qimgs = "".join(f'<img src="{stem}.q{n}.png">' for n in range(1, len(r.get("prepared_prompts", [])) + 1))
        cards.append(f"""
<section><h2>{html.escape(data['name'])}</h2>
<div class=row><figure><img src="{stem}.plan.png"><figcaption>Image 2 as sent</figcaption></figure>
<figure><img src="{stem}.groups.png"><figcaption>Groups (shapes), computed without AI. Guides dashed grey.</figcaption></figure></div>
<p><b>Sizes:</b> {sizes['marks']} marks, {sizes['points']} points, marks JSON {sizes['marks_json_kb']} KB,
prompt {sizes['prompt_chars']} chars, geometry {sizes['geometry_ms']} ms,
call {data.get('call_seconds', '-')} s</p>
<p><b>Groups:</b></p><ul>{groups}</ul>
<p><b>Stroke order note:</b> {html.escape(r.get('stroke_order_note', ''))}</p>
<p><b>What each mark traces:</b></p><ol>{marks}</ol>
<p><b>Mark relationships:</b></p><ul>{rels}</ul>
<p><b>Checks (problems the app would have to handle):</b></p><ul>{problems}</ul>
<p><b>Form relationships:</b></p><img src="{stem}.forms.png">
<p><b>Guided questions, with the marks they point at:</b></p><div class=qs>{qimgs}</div>
</section>""")
    (out / "report.html").write_text(f"""<!doctype html><meta charset="utf-8">
<title>Marks relations test</title>
<style>body{{font:14px system-ui;margin:24px;background:#fafafa;max-width:1400px}}
section{{border-bottom:1px solid #ddd;padding:16px 0}} .row{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}
img{{width:100%}} figure{{margin:0}} small{{color:#666}} .qs{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}</style>
<h1>Marks relations test</h1>
<p>Tests the advisor's questions: stroke order and shape selection, limits, and questions that point at marks.
In the question images, green = marks the question points at, cyan = marks an option points at, orange = the unmarked forms an "unseen" question is about.</p>
{''.join(cards)}""")


# ---------- main ----------

def run_case(name, stem, photo, sketch, style, out: Path, dry_run: bool, redraw: bool):
    marks = geo_mod.visible_marks(sketch.marks)
    focal_points = sketch.focal_points or []
    t0 = time.perf_counter()
    geo = geo_mod.analyse(marks, photo.width / photo.height)
    geometry_ms = round((time.perf_counter() - t0) * 1000, 1)
    prompt = build_prompt(style, geo, focal_points)
    plan = plan_image(photo, marks, focal_points)
    plan.save(out / f"{stem}.plan.png")
    groups_image(photo, marks, geo).save(out / f"{stem}.groups.png")
    (out / f"{stem}.prompt.txt").write_text(prompt)
    sizes = {
        "marks": len(marks),
        "points": sum(len(m["points"]) for m in marks),
        "marks_json_kb": round(len(json.dumps(marks)) / 1024, 1),
        "prompt_chars": len(prompt),
        "geometry_ms": geometry_ms,
    }
    print(f"\n== {name}: {sizes}")
    print(geo_mod.groups_text(geo))

    saved = out / f"{stem}.json"
    data = {"name": name, "style": style, "geometry": geo, "sizes": sizes}
    if redraw and saved.exists():
        data["result"] = json.loads(saved.read_text()).get("result")
        data["call_seconds"] = json.loads(saved.read_text()).get("call_seconds")
    elif not dry_run:
        from app.core.gemini_service import call_gemini_json_with_raw
        t0 = time.perf_counter()
        result, _raw = call_gemini_json_with_raw(prompt, response_schema(), [photo, plan])
        data["call_seconds"] = round(time.perf_counter() - t0, 1)
        data["result"] = result
    result = data.get("result")
    if result:
        data["problems"] = check(result, geo)
        for p in data["problems"]:
            print("  !!", p)
        for n, p in enumerate(result.get("prepared_prompts", []), 1):
            question_image(photo, marks, p, result.get("form_relationships")).save(out / f"{stem}.q{n}.png")
        forms_image(photo, result).save(out / f"{stem}.forms.png")
    saved.write_text(json.dumps(data, indent=2))


def main():
    ap = argparse.ArgumentParser(description="Marks relations test.")
    ap.add_argument("paths", type=Path, nargs="*")
    ap.add_argument("--sketch", nargs="+", metavar="ID")
    ap.add_argument("--style", default=None, help="default: the plan's or sketch's style, else realistic")
    ap.add_argument("--out", type=Path, default=Path("marks_eval_out"))
    ap.add_argument("--dry-run", action="store_true", help="no API call: geometry, prompt and images only")
    ap.add_argument("--redraw", action="store_true", help="reuse saved JSON, no API call")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    cases = []
    if args.paths:
        cases += list(cases_from_files(args.paths))
    if args.sketch:
        cases += list(cases_from_db(args.sketch))
    if not cases:
        ap.error("give a photo with a .plan.json, or --sketch <id>")
    for name, stem, photo, sketch in cases:
        style = args.style or getattr(sketch, "style", None) or "realistic"
        run_case(name, stem, photo, sketch, style, args.out, args.dry_run, args.redraw)
    write_report(args.out)
    print(f"\nReport: {args.out / 'report.html'}")


if __name__ == "__main__":
    main()
