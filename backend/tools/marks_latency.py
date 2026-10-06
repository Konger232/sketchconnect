"""
Marks analysis latency check (dev only, not part of the app).

Runs the real marks analysis call for one saved sketch and writes what
went in and what came out, with timings, so the slow part can be found.
It does not write to the database: the sketch's cache is left as it is.

From backend/ (uses your .env, same as the app):
  python -m tools.marks_latency <sketch_id>
  python -m tools.marks_latency <sketch_id> --runs 2     # second run shows implicit cache hits

Writes to debug_out/latency_review/<sketch_id>/:
  1_request_prompt.md     the prompt text, as sent
  1_request_schema.json   the response schema, as sent
  1_image1_photo.jpg      Image 1, the framed photo
  1_image2_plan.jpg       Image 2, the marks with their ids
  2_response_raw.json     Gemini's answer, as returned
  3_guided_questions.md   the questions the sketcher sees, in guide order
  3_guided_questions.json the same, as the app sends them
  timing.json             seconds per step and token counts per run
"""
import argparse
import json
import time
from pathlib import Path

import google.generativeai as genai
from PIL import Image
import pillow_heif

from config import GEMINI_MODEL
from app.core.database import SessionLocal
from app.core.models import Sketch
from app.core.paths import UPLOAD_DIR
from app.core.gemini_service import _configure
from app.features.marks_analysis import service
from app.features.scene_analysis import service as scene_service

pillow_heif.register_heif_opener()
OUT = Path(__file__).resolve().parents[1] / "debug_out" / "latency_review"


def usage_of(response) -> dict:
    u = getattr(response, "usage_metadata", None)
    keys = ("prompt_token_count", "cached_content_token_count", "candidates_token_count",
            "thoughts_token_count", "total_token_count")
    return {k: getattr(u, k, None) for k in keys} if u else {}


def questions_md(result: dict) -> str:
    lines = ["# Guided questions", ""]
    for n, p in enumerate(result["prepared_prompts"], 1):
        lines.append(f"## {n}. {p['key']} ({p.get('focus')})")
        if p.get("default_names"):
            lines.append(f"Names: {json.dumps(p['default_names'])}")
        if p.get("question"):
            lines.append(f"**{p['question']}**")
            for i, o in enumerate(p.get("options") or []):
                tag = (p.get("option_types") or p.get("option_elements") or [None] * 9)[i]
                lines.append(f"- {o}" + (f"  `{tag}`" if tag else ""))
        for vtype, v in (p.get("variants") or {}).items():
            lines.append(f"After `{vtype}`: **{v['question']}**")
            for o, pr in zip(v["options"], v["option_principles"]):
                lines.append(f"- {o}  `{pr}`")
        lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sketch_id")
    ap.add_argument("--runs", type=int, default=1)
    args = ap.parse_args()

    db = SessionLocal()
    sketch = db.query(Sketch).filter(Sketch.id == args.sketch_id).first()
    if sketch is None or not sketch.cached_scene_analysis:
        raise SystemExit("Sketch not found, or no scene analysis cached yet. Run it in the app first.")
    scene = sketch.cached_scene_analysis
    out = OUT / args.sketch_id
    out.mkdir(parents=True, exist_ok=True)
    t = {}

    s = time.perf_counter()
    plan = service.build_plan(sketch)
    t["build_plan_s"] = round(time.perf_counter() - s, 2)

    s = time.perf_counter()
    photo = scene_service.resize_if_needed(
        Image.open(UPLOAD_DIR / Path(sketch.reference_image_url).name).convert("RGB"))
    t["load_photo_s"] = round(time.perf_counter() - s, 2)

    intents = service.intents_from_choices(sketch.session_choices)
    prompt = service.build_prompt(plan, scene, sketch, intents)
    schema = service.response_schema()
    (out / "1_request_prompt.md").write_text(prompt)
    (out / "1_request_schema.json").write_text(json.dumps(schema, indent=2))
    photo.save(out / "1_image1_photo.jpg", quality=85)
    if plan.image is not None:
        plan.image.convert("RGB").save(out / "1_image2_plan.jpg", quality=85)
    t["images_px"] = [list(photo.size), list(plan.image.size) if plan.image else None]
    t["prompt_chars"] = len(prompt)
    t["static_prefix_chars"] = prompt.index("# Session Input Data")

    _configure()
    model = genai.GenerativeModel(GEMINI_MODEL, generation_config={
        "response_mime_type": "application/json", "response_schema": schema})
    runs = []
    for r in range(args.runs):
        s = time.perf_counter()
        response = model.generate_content([prompt, photo, plan.image])
        runs.append({"gemini_s": round(time.perf_counter() - s, 1), **usage_of(response),
                     "output_chars": len(response.text)})
        print(f"run {r + 1}: {runs[-1]}")
    t["runs"] = runs
    raw_text = response.text.strip()
    (out / "2_response_raw.json").write_text(raw_text)

    s = time.perf_counter()
    cleaned = service.clean(json.loads(raw_text), plan, intents)
    result = service.assemble(cleaned, sketch, scene, plan.selected_ids)
    t["clean_assemble_s"] = round(time.perf_counter() - s, 3)
    (out / "3_guided_questions.json").write_text(json.dumps(result["prepared_prompts"], indent=2))
    (out / "3_guided_questions.md").write_text(questions_md(result))
    (out / "timing.json").write_text(json.dumps(t, indent=2))
    print(json.dumps(t, indent=2))
    print(f"Written to {out}")


if __name__ == "__main__":
    main()
