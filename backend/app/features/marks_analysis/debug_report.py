"""
DEBUG=true only: one HTML page per marks analysis call that reached
Gemini, at debug_out/marks_report_<sketch>.html (git-ignored). It shows
what Gemini was given and what came back, in order:

  1. The original photo as uploaded (not sent), then the two images as
     sent: the framed photo, and the plan with each stroke's id where it
     started.
  2. The strokes in the order drawn: when each started, how long it took,
     what the geometry made of it (kind, guide, big, shape), and Gemini's
     reading (traces, element, role, fit). Erased strokes are listed too,
     though they are not sent.
  3. The shapes and links, exactly as sent ($groups), then the areas the
     backend built from Gemini's depths, and why each join happened.
  4. The plan read as the card shows it (design doc, item 25): each
     principle's group, strokes (highlighted), elements, why and tips,
     with its relationships under it.
  5. The question left in New Sketch: a missed focal area.
  6. Gemini's raw response, and the full prompt text.

A cache hit makes no Gemini call and writes no report. Change a stroke,
or bump ANALYSIS_VERSION, to run the call again.
"""
import base64
import html
import io
import json
from datetime import datetime

from PIL import Image, ImageDraw, ImageEnhance

from app.core import mark_geometry
from app.core.debug import DEBUG_DIR


def _img(im: Image.Image | None, width: int = 520) -> str:
    if im is None:
        return "<p class=muted>(none)</p>"
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=82)
    return f'<img src="data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode()}" width="{width}">'


def _e(v) -> str:
    return html.escape("" if v is None else str(v))


def _pre(text: str) -> str:
    return f"<pre>{_e(text)}</pre>"


def report_path(sketch_id) -> "Path":
    return DEBUG_DIR / f"marks_report_{sketch_id}.html"


def _highlight(photo: Image.Image, marks: list[dict], ids: set[str], width: int = 260) -> str:
    """The photo, dimmed, with these strokes in yellow and the rest grey."""
    img = ImageEnhance.Brightness(photo.convert("RGB")).enhance(0.55)
    img.thumbnail((width * 2, width * 2))
    W, H = img.size
    d = ImageDraw.Draw(img)
    for i, m in enumerate(mark_geometry.visible_marks(marks)):
        pts = [(x * W / 1000, y * H / 1000) for x, y in m.get("points", [])]
        if len(pts) > 1:
            on = mark_geometry.mark_id(m, i) in ids
            d.line(pts, fill="#ffd400" if on else "#9a9a9a", width=5 if on else 2)
    return _img(img, width)


def write_report(sketch, photo: Image.Image, plan, prompt: str, raw_text: str | None,
                 cleaned: dict, result: dict, analysis_version: int,
                 original: Image.Image | None = None) -> str:
    sid = str(sketch.id)
    geo = plan.geo
    shape_of = {m: g["id"] for g in geo["groups"] for m in g["mark_ids"]}
    area_of = {m: n for n, a in enumerate(cleaned.get("areas") or [], 1) for m in a}
    readings = {m["mark_id"]: m for m in cleaned.get("marks") or []}

    # 2. Strokes in the order drawn, erased ones included.
    rows = []
    facts = {f["id"]: f for f in geo["marks"]}
    for i, m in enumerate(sketch.marks or []):
        mid = mark_geometry.mark_id(m, i)
        f = facts.get(mid)
        r = readings.get(mid, {})
        start = m.get("started_ms")
        dur = m.get("duration_ms")
        flags = []
        if m.get("erased"):
            flags.append("erased (not sent)")
        if f and f.get("guide"):
            flags.append("guide")
        if f and f.get("big"):
            flags.append("big")
        if m.get("selected"):
            flags.append("selected")
        if m.get("source") == "prompted":
            flags.append("prompted")
        rows.append(
            f"<tr class='{'erased' if m.get('erased') else ''}'><td>{i + 1}</td><td><b>{_e(mid)}</b></td>"
            f"<td>{'' if start is None else f'{start / 1000:.1f}s'}</td><td>{'' if dur is None else f'{dur / 1000:.1f}s'}</td>"
            f"<td>{_e(f['kind'] if f else '')}</td><td>{_e(', '.join(flags))}</td>"
            f"<td>{_e(shape_of.get(mid, ''))}</td><td>{_e(area_of.get(mid, ''))}</td>"
            f"<td>{_e(r.get('traces'))}</td><td>{_e(r.get('element'))}</td><td>{_e(r.get('role'))}</td>"
            f"<td>{_e(r.get('fit'))}</td><td>{_e(r.get('depth'))}</td></tr>"
        )

    # 4. The plan read, in card order.
    pr = cleaned.get("plan_read") or {}
    rels = {}
    for r in pr.get("relationships") or []:
        rels.setdefault(r["principle"], []).append(r)
    p_rows, shown = [], 0
    for p in pr.get("principles") or []:
        place = "top 2" if p["group"] != "none" and shown < 2 else "See more"
        shown += p["group"] != "none"
        tips = "<br>".join(f"<b>{_e(t['name'])}:</b> {_e(t['tip'])}" for t in p.get("tips") or [])
        img = _highlight(photo, sketch.marks or [], set(p["mark_ids"])) if p["mark_ids"] else ""
        p_rows.append(f"<tr class='{p['group']}'><td><b>{_e(p['principle'])}</b><br><span class=muted>{_e(p['group'])} &middot; {place}</span></td>"
                      f"<td>{_e(', '.join(p['mark_ids']))}</td><td>{_e(', '.join(p.get('elements') or []))}</td>"
                      f"<td>{_e(p.get('why'))}</td><td>{tips}</td><td>{img}</td></tr>")
        for r in rels.get(p["principle"], []):
            rt = "<br>".join(f"<b>{_e(t['name'])}:</b> {_e(t['tip'])}" for t in r.get("tips") or [])
            p_rows.append(f"<tr class=rel><td>&#8627; {_e(r['type'])}<br><span class=muted>{_e(' / '.join(r.get('objects') or []))}</span></td>"
                          f"<td>{_e(', '.join(r['mark_ids']))}</td><td></td><td>{_e(r.get('why'))}</td><td>{rt}</td>"
                          f"<td>{_highlight(photo, sketch.marks or [], set(r['mark_ids'])) if r['mark_ids'] else ''}</td></tr>")

    # 5. The question left in New Sketch.
    q_rows = "".join(
        f"<tr><td>{_e(p.get('key'))}</td><td><b>{_e(p.get('question'))}</b><ul>"
        f"{''.join(f'<li>{_e(o)}</li>' for o in p.get('options') or [])}</ul></td></tr>"
        for p in result.get("prepared_prompts") or []
    ) or "<tr><td colspan=2 class=muted>none: every focal area has a stroke on it</td></tr>"

    try:
        raw_pretty = json.dumps(json.loads(raw_text), indent=2, ensure_ascii=False) if raw_text else "(none)"
    except Exception:
        raw_pretty = raw_text or "(none)"
    areas = " | ".join(", ".join(a) for a in cleaned.get("areas") or []) or "none"
    joins = "".join(f"<li>{_e(j)}</li>" for j in cleaned.get("area_joins") or []) or "<li>none</li>"
    media = ", ".join(cleaned.get("media") or []) or "none picked (tool-free tips)"

    page = f"""<!doctype html><meta charset="utf-8"><title>Marks analysis {sid[:8]}</title>
<style>
body{{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#111;max-width:1200px}}
h1{{font-size:20px}} h2{{font-size:16px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px}}
table{{border-collapse:collapse;width:100%}} td,th{{border:1px solid #ddd;padding:4px 6px;vertical-align:top;text-align:left}}
th{{background:#f4f4f4}} tr.erased td{{color:#999;text-decoration:line-through}}
tr.strong{{background:#fff8d6}} tr.moderate{{background:#f3f6ff}} tr.none td{{color:#666}} tr.rel td{{font-size:13px;background:#fbfbfb}}
pre{{background:#f7f7f7;padding:10px;white-space:pre-wrap;font-size:12px}}
.muted{{color:#777;font-size:12px}} .imgs{{display:flex;gap:16px;flex-wrap:wrap}} ul{{margin:4px 0 0 18px;padding:0}}
details summary{{cursor:pointer;font-weight:600}}
</style>
<h1>Marks analysis, sketch {_e(sid)}</h1>
<p class=muted>{datetime.now():%Y-%m-%d %H:%M:%S} &middot; ANALYSIS_VERSION {analysis_version} &middot; crop aspect {plan.aspect:.3f} &middot; media: {_e(media)}</p>

<h2>1. The photo, and the images sent to Gemini</h2>
<div class=imgs><div><b>Original</b>, as uploaded (not sent)<br>{_img(original, 360)}</div>
<div><b>Image 1</b>, the cropped photo<br>{_img(photo, 360)}</div>
<div><b>Image 2</b>, the plan with stroke ids<br>{_img(plan.image, 360)}</div></div>

<h2>2. Strokes, in the order drawn</h2>
<table><tr><th>#</th><th>id</th><th>started</th><th>took</th><th>kind</th><th>flags</th><th>shape</th><th>area</th>
<th>Gemini: traces</th><th>element</th><th>role</th><th>fit</th><th>depth</th></tr>{''.join(rows)}</table>
<p class=muted>"guide": a straight line 500 units or longer. "big": a box over 700 in one direction or over 500 in both. Neither ever joins a shape or an area.</p>

<h2>3. Shapes, links and areas</h2>
{_pre(mark_geometry.groups_text(geo))}
<p><b>Areas</b> (built after the call, from Gemini's depths): {_e(areas)}</p>
<ul>{joins}</ul>
<p>Gemini's stroke order note: <i>{_e(cleaned.get('stroke_order_note'))}</i></p>

<h2>4. The plan read, in card order</h2>
<table><tr><th>principle</th><th>strokes</th><th>elements</th><th>why</th><th>tips</th><th>highlight</th></tr>{''.join(p_rows)}</table>

<h2>5. The question left in New Sketch</h2>
<table><tr><th>key</th><th>question and options</th></tr>{q_rows}</table>

<h2>6. Gemini</h2>
<details><summary>Raw response</summary>{_pre(raw_pretty)}</details>
<details><summary>Full prompt</summary>{_pre(prompt)}</details>
"""
    DEBUG_DIR.mkdir(exist_ok=True)
    out = report_path(sid)
    out.write_text(page, encoding="utf-8")
    return str(out)
