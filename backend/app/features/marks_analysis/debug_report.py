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
  3. The shapes and links, exactly as sent ($groups), and the selection.
  4. Which shapes the guide asks about, and the rule that picked them.
  5. The guide as the app will ask it: every prepared question and option,
     with its type, element and principle.
  6. Gemini's raw response, and the full prompt text.

A cache hit makes no Gemini call and writes no report. Change a stroke,
or bump ANALYSIS_VERSION, to run the call again.
"""
import base64
import html
import io
import json
from datetime import datetime

from PIL import Image

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


def write_report(sketch, photo: Image.Image, plan, prompt: str, raw_text: str | None,
                 cleaned: dict, result: dict, analysis_version: int,
                 original: Image.Image | None = None) -> str:
    sid = str(sketch.id)
    geo = plan.geo
    shape_of = {m: g["id"] for g in geo["groups"] for m in g["mark_ids"]}
    readings = {m["mark_id"]: m for m in cleaned.get("marks") or []}
    asked = {o["shape_id"]: o for o in cleaned.get("objects") or []}

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
        shape = shape_of.get(mid, "")
        rows.append(
            f"<tr class='{'erased' if m.get('erased') else ''}'><td>{i + 1}</td><td><b>{_e(mid)}</b></td>"
            f"<td>{'' if start is None else f'{start / 1000:.1f}s'}</td><td>{'' if dur is None else f'{dur / 1000:.1f}s'}</td>"
            f"<td>{_e(f['kind'] if f else '')}</td><td>{_e(', '.join(flags))}</td>"
            f"<td>{_e(shape)}{' &larr; asked' if shape in asked else ''}</td>"
            f"<td>{_e(r.get('traces'))}</td><td>{_e(r.get('element'))}</td><td>{_e(r.get('role'))}</td><td>{_e(r.get('fit'))}</td></tr>"
        )

    # 4. Which shapes the guide asks about.
    if plan.selected_shapes:
        rule = "The sketcher selected strokes, so the guide asks about the selected shapes, in that order."
    else:
        first = ", ".join(f"{s['id']} ({', '.join(s['mark_ids'])})" for s in plan.first_shapes) or "none"
        rule = (f"Nothing was selected, so the guide asks about the shapes drawn first: {first}. "
                "The code sets this (MarksPlan.first_shapes); Gemini's own picks are not used.")
    obj_rows = "".join(
        f"<tr><td>{_e(o['shape_id'])}</td><td>{_e(', '.join(o['mark_ids']))}</td><td>{_e(o['name'])}</td>"
        f"<td>{_e(o.get('kind'))}</td><td>{_e(o.get('depth'))}</td><td>{_e(o['element'])}</td>"
        f"<td>{_e(' | '.join(r['text'] + ' [' + r['element'] + ']' for r in o.get('readings') or []))}</td></tr>"
        for o in cleaned.get("objects") or []
    )

    # 5. The guide as asked.
    q_rows = []
    for n, p in enumerate(result.get("prepared_prompts") or [], 1):
        opts = p.get("options") or []
        meta = []
        for k, o in enumerate(opts):
            bits = [x for x in ((p.get("option_types") or [None] * len(opts))[k],
                                (p.get("option_elements") or [None] * len(opts))[k],
                                (p.get("option_principles") or [None] * len(opts))[k]) if x]
            meta.append(f"<li>{_e(o)} <span class=muted>{_e(', '.join(bits))}</span></li>")
        variants = ""
        for t, v in (p.get("variants") or {}).items():
            vo = ", ".join(f"{o} [{pr}]" for o, pr in zip(v.get("options") or [], v.get("option_principles") or []))
            variants += f"<div class=muted>after <b>{_e(t)}</b>: {_e(v.get('question'))} &mdash; {_e(vo)}</div>"
        q_rows.append(
            f"<tr><td>{n}</td><td>{_e(p.get('key'))}<br><span class=muted>{_e(p.get('focus'))}</span></td>"
            f"<td><b>{_e(p.get('question'))}</b><ul>{''.join(meta)}</ul>{variants}</td>"
            f"<td>{_e(', '.join(p.get('mark_ids') or []))}<br><span class=muted>{_e(json.dumps(p.get('name_refs') or {}))}</span></td></tr>"
        )

    try:
        raw_pretty = json.dumps(json.loads(raw_text), indent=2, ensure_ascii=False) if raw_text else "(none)"
    except Exception:
        raw_pretty = raw_text or "(none)"
    sel = ", ".join(f"{s['id']}: {', '.join(s['mark_ids'])}" for s in plan.selected_shapes) or "none selected"

    page = f"""<!doctype html><meta charset="utf-8"><title>Marks analysis {sid[:8]}</title>
<style>
body{{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#111;max-width:1200px}}
h1{{font-size:20px}} h2{{font-size:16px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px}}
table{{border-collapse:collapse;width:100%}} td,th{{border:1px solid #ddd;padding:4px 6px;vertical-align:top;text-align:left}}
th{{background:#f4f4f4}} tr.erased td{{color:#999;text-decoration:line-through}}
pre{{background:#f7f7f7;padding:10px;white-space:pre-wrap;font-size:12px}}
.muted{{color:#777;font-size:12px}} .imgs{{display:flex;gap:16px;flex-wrap:wrap}} ul{{margin:4px 0 0 18px;padding:0}}
details summary{{cursor:pointer;font-weight:600}}
</style>
<h1>Marks analysis, sketch {_e(sid)}</h1>
<p class=muted>{datetime.now():%Y-%m-%d %H:%M:%S} &middot; ANALYSIS_VERSION {analysis_version} &middot; frame aspect {plan.aspect:.3f}</p>

<h2>1. The photo, and the images sent to Gemini</h2>
<div class=imgs><div><b>Original</b>, as uploaded (not sent)<br>{_img(original, 360)}</div>
<div><b>Image 1</b>, the framed photo<br>{_img(photo, 360)}</div>
<div><b>Image 2</b>, the plan with stroke ids<br>{_img(plan.image, 360)}</div></div>

<h2>2. Strokes, in the order drawn</h2>
<table><tr><th>#</th><th>id</th><th>started</th><th>took</th><th>kind</th><th>flags</th><th>shape</th>
<th>Gemini: traces</th><th>element</th><th>role</th><th>fit</th></tr>{''.join(rows)}</table>
<p class=muted>"guide": a straight line 500 frame units or longer. "big": a box over 700 in one direction or over 500 in both. Neither ever joins a shape.</p>

<h2>3. Shapes and links, as sent</h2>
{_pre(mark_geometry.groups_text(geo))}
<p>Selected shapes: {_e(sel)}</p>
<p>Gemini's stroke order note: <i>{_e(cleaned.get('stroke_order_note'))}</i></p>

<h2>4. What the guide asks about</h2>
<p>{_e(rule)}</p>
<table><tr><th>shape</th><th>strokes</th><th>name</th><th>kind</th><th>depth</th><th>element</th><th>readings</th></tr>{obj_rows}</table>

<h2>5. The guide, in order</h2>
<table><tr><th>#</th><th>key</th><th>question and options</th><th>strokes</th></tr>{''.join(q_rows)}</table>

<h2>6. Gemini</h2>
<details><summary>Raw response</summary>{_pre(raw_pretty)}</details>
<details><summary>Full prompt</summary>{_pre(prompt)}</details>
"""
    DEBUG_DIR.mkdir(exist_ok=True)
    out = report_path(sid)
    out.write_text(page, encoding="utf-8")
    return str(out)
