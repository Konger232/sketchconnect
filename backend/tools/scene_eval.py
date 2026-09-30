"""
Scene analysis evaluation harness (dev only, not part of the app).

Runs the real scene analysis call (features/scene_analysis/service.py) the
same way the app does: the framed photo, plus the sketcher's plan (focal
points and marks, drawn into the planning image and described in the
prompt) and the reframing note when there is one. Writes, per photo:
  <name>.json         the cleaned result
  <name>.overlay.png  the plan (red squares = sketcher's focal points, thin
                      lines = marks), focal_regions (numbered, strongest
                      first), the AI's missed-area suggestions (green
                      squares), eye level, and each vanishing point with
                      its edges extended to it, on a padded canvas
and one report.html with every photo side by side.

Two ways to give it photos, from backend/ (uses your .env, same as the app):

1. Photo files or folders of photos. Each photo is treated as already framed. To add a
   plan, put a <photo name>.plan.json next to it (all keys optional):
     {
       "focal_points": [{"x": 240, "y": 360}, {"x": 700, "y": 520}],
       "marks": [{"color": "#ffd400", "width": 6, "points": [[0, 420], [1000, 400]]}],
       "crop_transform": {"aspect_ratio": "4:3", "zoom": 1.3, "offset_x": 0, "offset_y": 0}
     }
   Coordinates are 0-1000, x first, on the photo as it is. A photo with no
   .plan.json runs with no plan.
     python -m tools.scene_eval ../../referenceImg --style realistic
     python -m tools.scene_eval ../../referenceImg/bikes.jpg           # one photo
     python -m tools.scene_eval ../../referenceImg/bikes.jpg ../../referenceImg/statue.jpg

2. Real sketches from your database, by id. Uses the stored framed photo,
   focal points, marks and crop, so it matches the app exactly. Read only:
   nothing is written back to the sketch.
     python -m tools.scene_eval --list                    # recent sketches and their ids
     python -m tools.scene_eval --sketch <id> <id> --out ../../scene_eval_out

Results are saved per photo, and report.html is rebuilt each run from every
result in the output folder. So running one photo at a time still gives one
report with all of them. Rerunning a photo replaces its earlier result.

Other options:
  --labels labels.csv   two columns, no header: name,expected_scene_type
                        (name = photo filename, or sketch id)
  --redraw              reuse saved JSON, no API calls
"""
import argparse
import csv
import html
import json
from pathlib import Path
from types import SimpleNamespace

from PIL import Image, ImageDraw, ImageOps
import pillow_heif

from app.features.scene_analysis import service

pillow_heif.register_heif_opener()

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".webp"}
REGION_COLORS = ["#ffd400", "#00e5ff", "#ff4fd8"]
LINE_COLOR = "#ff3b30"
EXT_COLOR = "#ff9f0a"
VP_COLOR = "#34c759"
EYE_COLOR = "#ffffff"
PLAN_COLOR = "#ff073a"   # --focal-accent-user
AI_COLOR = "#39ff14"     # --focal-accent-ai
PAD = 0.4          # canvas padding on each side, as a fraction of image size
DRAW_WIDTH = 900   # width the photo is drawn at


def load_photo(path: Path) -> Image.Image:
    # Same steps the app takes: EXIF transpose on upload, then resize.
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    return service.resize_if_needed(im)


def draw_overlay(photo: Image.Image, result: dict, plan_points=None, plan_marks=None) -> Image.Image:
    w = DRAW_WIDTH
    h = round(photo.height * w / photo.width)
    px, py = round(w * PAD), round(h * PAD)
    canvas = Image.new("RGB", (w + 2 * px, h + 2 * py), "#2a2a2a")
    canvas.paste(photo.resize((w, h)), (px, py))
    d = ImageDraw.Draw(canvas)

    def to_canvas(x, y):
        return px + x / 1000 * w, py + y / 1000 * h

    d.rectangle([px, py, px + w, py + h], outline="#888888")

    for i, r in enumerate(result.get("focal_regions", [])):
        pts = r["contour_points"]
        poly = [to_canvas(pts[j], pts[j + 1]) for j in range(0, len(pts) - 1, 2)]
        color = REGION_COLORS[i % len(REGION_COLORS)]
        d.line(poly + [poly[0]], fill=color, width=3)
        cx = sum(p[0] for p in poly) / len(poly)
        cy = sum(p[1] for p in poly) / len(poly)
        d.rectangle([cx - 4, cy - 4, cx + 140, cy + 14], fill="#000000")
        d.text((cx, cy), f"{i + 1} {r['label'][:22]}", fill=color)

    persp = result.get("perspective") or {}
    eye = persp.get("eye_level_y")
    if eye is not None:
        ey = to_canvas(0, eye)[1]
        d.line([(0, ey), (canvas.width, ey)], fill=EYE_COLOR, width=2)
        d.text((6, ey - 14), f"eye level y={eye}", fill=EYE_COLOR)
    for n, vp in enumerate(persp.get("vanishing_points", []), 1):
        vx, vy = to_canvas(vp["x"], vp["y"])
        edges = vp.get("edges", [])
        for i in range(0, len(edges) - 3, 4):
            x1, y1, x2, y2 = edges[i:i + 4]
            a, b = to_canvas(x1, y1), to_canvas(x2, y2)
            far = a if (a[0] - vx) ** 2 + (a[1] - vy) ** 2 >= (b[0] - vx) ** 2 + (b[1] - vy) ** 2 else b
            d.line([far, (vx, vy)], fill=EXT_COLOR, width=1)   # extension to the point
            d.line([a, b], fill=LINE_COLOR, width=4)            # the traced edge
        d.ellipse([vx - 7, vy - 7, vx + 7, vy + 7], outline=VP_COLOR, width=3)
        d.text((vx + 9, vy - 7), f"VP{n} ({vp['x']}, {vp['y']})", fill=VP_COLOR)

    # The sketcher's plan: marks, then their focal points.
    for m in plan_marks or []:
        pts = [to_canvas(x, y) for x, y in m.get("points", [])]
        if len(pts) > 1:
            d.line(pts, fill=m.get("color", "#ffffff"), width=2)
    for p in plan_points or []:
        cx, cy = to_canvas(p["x"], p["y"])
        d.rectangle([cx - 12, cy - 12, cx + 12, cy + 12], outline=PLAN_COLOR, width=3)
    # The AI's missed-area suggestions, where the app draws its reticle.
    for sg in result.get("focal_suggestions", []):
        cx, cy = to_canvas(sg["x"], sg["y"])
        d.rectangle([cx - 12, cy - 12, cx + 12, cy + 12], outline=AI_COLOR, width=3)
        d.text((cx + 16, cy - 6), f"AI: {sg['label'][:24]}", fill=AI_COLOR)
    return canvas


def describe_perspective(persp: dict | None) -> str:
    if not persp:
        return "none returned"
    vps = "; ".join(
        f"VP{n} ({vp['x']}, {vp['y']}), {len(vp.get('edges', [])) // 4} edges"
        for n, vp in enumerate(persp.get("vanishing_points", []), 1)
    )
    return f"{persp.get('kind')}, eye level y={persp.get('eye_level_y')}" + (f"; {vps}" if vps else "")


def load_labels(path: Path | None) -> dict[str, str]:
    if not path:
        return {}
    with open(path, newline="") as f:
        return {row[0].strip(): row[1].strip() for row in csv.reader(f) if len(row) >= 2}


def photo_paths(paths: list[Path]) -> list[Path]:
    """Photo files as given, plus every photo directly inside a given folder."""
    found = []
    for p in paths:
        if p.is_dir():
            found += sorted(f for f in p.iterdir() if f.suffix.lower() in IMAGE_EXTS)
        elif p.suffix.lower() in IMAGE_EXTS:
            found.append(p)
    return found


def cases_from_files(paths: list[Path]):
    """(name, framed photo, sketch-like object) per photo, with its .plan.json if any."""
    for path in paths:
        plan_path = path.with_name(path.name + ".plan.json")
        if not plan_path.exists():
            plan_path = path.with_suffix(".plan.json")
        raw = json.loads(plan_path.read_text()) if plan_path.exists() else {}
        points = [{"source": "own", **p} for p in raw.get("focal_points", [])]
        sketch = SimpleNamespace(
            focal_points=points,
            marks=raw.get("marks", []),
            crop_transform=raw.get("crop_transform"),
        )
        yield path.name, path.stem, load_photo(path), sketch


def cases_from_db(sketch_ids: list[str]):
    """(name, framed photo, stored sketch) per id, read from the database."""
    from app.core.database import SessionLocal
    from app.core.models import Sketch
    from app.core.paths import UPLOAD_DIR

    db = SessionLocal()
    try:
        for sid in sketch_ids:
            sketch = db.query(Sketch).filter(Sketch.id == sid).first()
            if sketch is None or not sketch.reference_image_url:
                print(f"!! sketch {sid}: not found, or no reference photo")
                continue
            photo = load_photo(UPLOAD_DIR / Path(sketch.reference_image_url).name)
            db.expunge(sketch)  # read only from here on
            yield sid, sid, photo, sketch
    finally:
        db.close()


def write_report(out: Path, labels: dict[str, str]) -> tuple[int, int]:
    """
    Rebuilds report.html from every saved result in `out`, so photos run
    one at a time still end up in one report. Returns (matches, labelled).
    """
    cards, matches, labelled = [], 0, 0
    for json_path in sorted(out.glob("*.json")):
        try:
            result = json.loads(json_path.read_text())
        except ValueError:
            continue
        meta = result.get("_eval")
        if not meta:
            continue
        stem, name, style = json_path.stem, meta["name"], meta["style"]
        with_image = " (with planning image)" if meta.get("plan_image_sent") else ""

        expected = labels.get(name)
        verdict = ""
        if expected:
            labelled += 1
            ok = expected == result["scene_type"]
            matches += ok
            verdict = f" <b class={'ok' if ok else 'miss'}>{'match' if ok else 'miss, expected ' + expected}</b>"

        prompts = "".join(
            f"<li><code>{html.escape(p['key'])}</code> {html.escape(p['question'])}"
            f"<br><small>{html.escape(' | '.join(p['options']))}</small></li>"
            for p in result.get("prepared_prompts", [])
        )
        regions = "".join(
            f"<li>{html.escape(r['label'])}"
            f" <small>(Gemini: {'marked' if r.get('sketcher_marked') else 'not marked'})"
            f" {html.escape(r.get('reason') or '')}</small></li>"
            for r in result.get("focal_regions", [])
        )
        missed = ", ".join(html.escape(sg["label"]) for sg in result.get("focal_suggestions", [])) or "none"
        cards.append(f"""
<section>
  <img src="{stem}.overlay.png">
  <div>
    <h2>{html.escape(name)}</h2>
    <p><b>style:</b> {style} &nbsp; <b>scene_type:</b> {result['scene_type']}
       {('(dominant: ' + str(result.get('mixed_dominant_region')) + ')') if result['scene_type'] == 'mixed' else ''}{verdict}</p>
    <p><b>plan sent:</b> {html.escape(meta.get('plan_text', ''))}{with_image}</p>
    <p><b>title:</b> {html.escape(result.get('suggested_title') or '')}</p>
    <p><b>summary:</b> {html.escape(result.get('scene_summary') or '')}</p>
    <p><b>focal_regions:</b></p><ol>{regions or '<li>none</li>'}</ol>
    <p><b>missed, asked about (by geometry):</b> {missed}</p>
    <p><b>perspective:</b> {html.escape(describe_perspective(result.get('perspective')))}</p>
    <p><b>prepared_prompts:</b></p><ol>{prompts}</ol>
  </div>
</section>""")

    acc = f"<p>Scene type accuracy: {matches}/{labelled}</p>" if labelled else ""
    (out / "report.html").write_text(f"""<!doctype html><meta charset="utf-8">
<title>Scene analysis eval</title>
<style>
body{{font:14px system-ui;margin:24px;background:#fafafa}}
section{{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:20px;
  border-bottom:1px solid #ddd;padding:20px 0}}
img{{width:100%}} h2{{margin:0 0 8px;font-size:16px}}
.ok{{color:#1a7f37}} .miss{{color:#c62828}} small{{color:#666}}
</style>
<h1>Scene analysis eval</h1>{acc}
<p>Red squares and thin coloured lines = the sketcher's focal points and marks (what was sent).
Yellow/cyan/pink outlines = focal_regions, strongest first. Green squares = missed areas the app
asks about. White line = eye level. Red = edges Gemini traced (after the backend's convergence
check), orange = each edge extended to its vanishing point, green ring = vanishing point.
The planning image actually sent to Gemini is saved as &lt;name&gt;.plan.png.</p>
{''.join(cards)}""")
    return matches, labelled


def list_recent_sketches(limit: int = 20) -> None:
    """Prints the most recent sketches: id, date, title, style, and what plan each has."""
    from app.core.database import SessionLocal
    from app.core.models import Sketch

    db = SessionLocal()
    try:
        rows = db.query(Sketch).order_by(Sketch.created_at.desc()).limit(limit).all()
        if not rows:
            print("No sketches found.")
            return
        print(f"{'id':36}  {'created':16}  {'style':12}  {'points':>6}  {'marks':>5}  title")
        for sk in rows:
            created = sk.created_at.strftime("%Y-%m-%d %H:%M") if sk.created_at else ""
            print(
                f"{sk.id!s:36}  {created:16}  {(sk.style or '-'):12}  "
                f"{len(sk.focal_points or []):>6}  {len(sk.marks or []):>5}  {sk.title or '(untitled)'}"
            )
    finally:
        db.close()


def main():
    ap = argparse.ArgumentParser(description="Run the scene analysis call and draw what came back.")
    ap.add_argument("paths", type=Path, nargs="*", help="photo files and/or folders of photos")
    ap.add_argument("--sketch", nargs="+", metavar="ID", help="sketch ids to run from the database")
    ap.add_argument("--style", help="default: realistic, or the sketch's own style with --sketch")
    ap.add_argument("--labels", type=Path)
    ap.add_argument("--out", type=Path, help="default: scene_eval_out next to the first photo, or ./scene_eval_out")
    ap.add_argument("--redraw", action="store_true", help="reuse saved JSON, no API calls")
    ap.add_argument("--list", action="store_true", help="print your 20 most recent sketches and their ids, then stop")
    args = ap.parse_args()

    if args.list:
        list_recent_sketches()
        return

    if not args.paths and not args.sketch:
        ap.error("give photo files or folders, --sketch ids, or both")
    for p in args.paths:
        if not p.exists():
            ap.error(f"not found: {p.resolve()}")
    photos = photo_paths(args.paths)
    if args.paths and not photos:
        ap.error("no .jpg, .jpeg, .png, .heic or .webp photos in what you gave")

    if args.out:
        out = args.out
    elif photos:
        first = args.paths[0]
        out = (first if first.is_dir() else first.parent) / "scene_eval_out"
    else:
        out = Path("scene_eval_out")
    out.mkdir(parents=True, exist_ok=True)
    labels = load_labels(args.labels)

    cases = list(cases_from_files(photos))
    if args.sketch:
        cases += list(cases_from_db(args.sketch))

    for name, stem, photo, sketch in cases:
        style = args.style or getattr(sketch, "style", None) or "realistic"
        print(f"\n### {name}  (style: {style})")
        plan = service.build_plan(sketch, framed_image=photo)
        json_path = out / f"{stem}.json"
        if args.redraw and json_path.exists():
            result = json.loads(json_path.read_text())
        else:
            result, _raw = service.analyze(photo, style, sketch.crop_transform, plan=plan)
        # What was sent, kept with the result so the report can be rebuilt later.
        result["_eval"] = {
            "name": name,
            "style": style,
            "plan_text": plan.text,
            "plan_image_sent": plan.image is not None,
        }
        json_path.write_text(json.dumps(result, indent=2))

        draw_overlay(photo, result, sketch.focal_points, sketch.marks).save(out / f"{stem}.overlay.png")
        if plan.image is not None:
            plan.image.save(out / f"{stem}.plan.png")
        print(f"saved {stem}.json, {stem}.overlay.png")

    matches, labelled = write_report(out, labels)
    print(f"\nReport: {out / 'report.html'}")
    if labelled:
        print(f"Scene type accuracy: {matches}/{labelled}")


if __name__ == "__main__":
    main()
