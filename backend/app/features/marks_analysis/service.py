"""
Marks analysis call (design doc, Section 11, items 20 and 25). Reads the
sketcher's plan (their strokes) through the Elements x Principles matrix
(app/core/design_fundamentals.json) and reads it back (item 25, the plan
read): every principle in a group (strong, moderate, none), with its
strokes, elements, a why and tips, and relationships inside the principles
they belong to. Also one reading per stroke (what it traces, element, role,
fit, depth). The question flow of items 17 to 20 (mark_meaning,
relationship, principle_intent, unseen) left New Sketch on October 11,
2026; only the missed focal area question stays, from the scene analysis.

Runs after the strokes and the media card. The scene analysis call (photo
only) has usually finished by then. This call reads its scene facts as
text. Images sent, in order:
  1. the clean cropped reference photo. Every coordinate comes from this one.
  2. the planning image with each stroke's id at its start (core/composite.py).

After the call, the backend joins the strokes into areas with the depths
Gemini read (core/mark_geometry.areas) and checks the plan read
(plan_read.clean). The HTTP route, caching and database writes are in
router.py.
"""
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from config import DEBUG, MAX_FOCAL_SUGGESTIONS, MAX_MARK_MEANING_QUESTIONS
from app.core import composite, debug, mark_geometry
from app.core import design_fundamentals as df
from app.core.gemini_service import call_gemini_json_with_raw
from app.core.prompt_loader import render_prompt
from app.features.marks_analysis import plan_read, question_bank
from app.features.scene_analysis import service as scene_service

PROMPTS = Path(__file__).parent / "prompts"

# Bump when the cleaned result changes shape. Part of the cache fingerprint.
ANALYSIS_VERSION = 16  # 16: the plan read replaces the question flow (item 25), depth per stroke, areas, media; 15: line strong on rhythm and variety, form matches shape on every principle; 14: contrast split by element (value, color, texture, space; size is scale), color > balance strong; 13: three subjects (MAX_MARK_MEANING_QUESTIONS); 12: stroke roles defined in the prompt, measurement and alignment dropped; 11: with nothing selected, the guide asks about the shapes drawn first; 10: depth (foreground, middle, background) on objects and scene objects; 9: strokes that continue each other join one shape (JOIN_GAP); 8: AI writes all wording, bank sets types only, readings without names; 7: no style, photo-only scene facts; 6: 6: word limits; 5: subject kind, plain readings; 4: three-step guide (objects, relationships, principle steps); 3: unseen reticle

ROLES = ["perspective_guide", "eye_level", "ground_line", "contour", "big_shape",
         "gesture", "unclear"]
FITS = ["close", "loose", "not_applicable"]
# How far back a stroke's subject sits in the scene (October 10, 2026).
DEPTHS = ["foreground", "middle", "background"]
# An id written into text the sketcher reads (m3, s1). Ids are never shown.
_ID_IN_TEXT = re.compile(r"\b[ms]\d+\b", re.IGNORECASE)


# ---------- intents ----------

def intents_from_choices(choices: list[dict] | None) -> list[dict]:
    """
    The principles the sketcher works toward, from their saved answers:
    principle_intent picks (source "intended"), and on answers saved before
    October 3, 2026 a Yes to the old relationship question (source
    "prompted", answer_to "relationship").
    "Not sure yet" adds none. In answer order, one per principle and mark set.
    """
    out, seen = [], set()

    def add(principle, mark_ids, source, answer_to=None):
        k = (principle, tuple(sorted(mark_ids or [])))
        if principle and k not in seen:
            seen.add(k)
            item = {"principle": principle, "mark_ids": list(mark_ids or []), "source": source}
            if answer_to:
                item["answer_to"] = answer_to
            out.append(item)

    for c in choices or []:
        if c.get("key") == "principle_intent" and not c.get("undecided_principle"):
            for p in c.get("principles") or []:
                add(p, c.get("mark_ids"), "intended")
        # Answers saved before October 3, 2026: a Yes to the old yes/no
        # relationship question was an intent. The new relationship step
        # only names the connection; its principle step records the intent.
        rel = c.get("relationship") or {}
        if c.get("key") == "relationship" and c.get("response") == "Yes" and rel.get("principle"):
            add(rel["principle"], c.get("mark_ids"), "prompted", "relationship")
    return out


def chosen_principles(intents: list[dict]) -> list[str]:
    """Distinct principles across the plan, in the order first chosen."""
    return list(dict.fromkeys(i["principle"] for i in intents))


# ---------- inputs ----------

@dataclass
class MarksPlan:
    geo: dict
    marks: list[dict]                              # visible marks, stroke order
    image: Image.Image | None                      # Image 2, ids labelled
    selected_shapes: list[dict] = field(default_factory=list)  # [{id, mark_ids}] selected marks only
    # With nothing selected: the shapes of the strokes drawn first, in
    # stroke order, at most MAX_MARK_MEANING_QUESTIONS. What a sketcher
    # sets down first is what they set out to plan.
    first_shapes: list[dict] = field(default_factory=list)       # [{id, mark_ids}]
    aspect: float = 1.0

    @property
    def visible_ids(self) -> set[str]:
        return {f["id"] for f in self.geo["marks"]}

    @property
    def selected_ids(self) -> set[str]:
        return {f["id"] for f in self.geo["marks"] if f.get("selected")}

    def shape(self, shape_id: str) -> dict | None:
        return next((g for g in self.geo["groups"] if g["id"] == shape_id), None)


def selected_mark_ids(sketch) -> set[str]:
    """The selected visible marks' ids, without measuring or drawing
    anything: a cache hit only needs these (router.py)."""
    return {mark_geometry.mark_id(m, i) for i, m in enumerate(mark_geometry.visible_marks(sketch.marks))
            if m.get("selected")}


def build_plan(sketch, framed_image: Image.Image | None = None) -> MarksPlan:
    marks = composite.visible_marks(sketch.marks)
    aspect = scene_service.frame_aspect(sketch, framed_image)
    debug.print_marks("marks_analysis", getattr(sketch, "id", None), sketch.marks, aspect)
    geo = mark_geometry.analyse(marks, aspect)
    image = None
    if marks:
        image = (
            composite.draw_plan(framed_image, sketch.focal_points or [], marks, label_ids=True)
            if framed_image is not None else composite.render_composite(sketch, label_ids=True)
        )
    selected = {f["id"] for f in geo["marks"] if f.get("selected")}
    shapes = []
    for g in geo["groups"]:
        ids = [i for i in g["mark_ids"] if i in selected]
        if ids:
            shapes.append({"id": g["id"], "mark_ids": ids})
    first = []
    if not shapes:
        shape_of = {m: g for g in geo["groups"] for m in g["mark_ids"]}
        for f in geo["marks"]:  # stroke order
            g = shape_of.get(f["id"])
            if g and all(x["id"] != g["id"] for x in first):
                first.append({"id": g["id"], "mark_ids": list(g["mark_ids"])})
            if len(first) >= MAX_MARK_MEANING_QUESTIONS:
                break
    return MarksPlan(geo=geo, marks=marks, image=image,
                     selected_shapes=shapes[:MAX_MARK_MEANING_QUESTIONS], first_shapes=first, aspect=aspect)


def scene_facts(cached_scene: dict | None, sketch) -> str:
    """The cached scene analysis as text: what this call needs, not the overlays."""
    s = cached_scene or {}
    lines = [f"- Scene type: {s.get('scene_type') or 'unknown'}"]
    if s.get("scene_summary"):
        lines.append(f"- Summary: {s['scene_summary']}")
    regions = s.get("focal_regions") or []
    unmarked = {sg["region_ref"] for sg in scene_service.build_focal_suggestions(
        regions, sketch.focal_points, sketch.marks, s.get("frame_aspect", 1.0))} if regions else set()
    for i, r in enumerate(regions):
        state = "no mark sits on it" if i in unmarked else "marked"
        lines.append(f"- Focal area: {r.get('label')} ({state}). {r.get('reason') or ''}".rstrip())
    return "\n".join(lines)


def media_of(sketch) -> list[str]:
    """The media card's picks (item 25), saved with the answers as one
    entry with key "media"."""
    for c in sketch.session_choices or []:
        if c.get("key") == "media":
            return plan_read.clean_media(c.get("media"))
    return []


def build_prompt(plan: MarksPlan, cached_scene: dict | None, sketch, media: list[str] | None = None) -> str:
    return render_prompt(
        PROMPTS / "marks_analysis.md",
        fundamentals=df.render_text(),
        types=question_bank.render_types(),
        scene_facts=scene_facts(cached_scene, sketch),
        marks_table=mark_geometry.marks_table(plan.geo),
        groups=mark_geometry.groups_text(plan.geo),
        media=plan_read.media_text(media if media is not None else media_of(sketch)),
    )


def fingerprint(sketch, cached_scene: dict | None) -> str:
    """
    Changes when anything the call reads changes: the scene analysis it
    builds on (photo and crop), the strokes (selection included), or the
    media picks, which the tips follow. Prompted strokes ("Yes, add it")
    come after the plan read, so they are left out: adopting a focal area
    never starts a new read.
    """
    payload = {
        "version": ANALYSIS_VERSION,
        "scene": (cached_scene or {}).get("photo_fingerprint"),
        "marks": [m for m in (sketch.marks or []) if m.get("source") != "prompted"],
        "media": media_of(sketch),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16]


# ---------- response schema ----------

def response_schema() -> dict:
    """Built per call: the enums follow the JSON files, which can change on disk."""
    ids = {"type": "array", "items": {"type": "string"}}
    element = {"type": "string", "enum": df.element_keys(from_marks=True)}
    tip = {"type": "object", "properties": {"name": {"type": "string"}, "tip": {"type": "string"}},
           "required": ["name", "tip"]}
    return {
        "type": "object",
        "properties": {
            "marks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "mark_id": {"type": "string"},
                        "traces": {"type": "string"},
                        "element": element,
                        "role": {"type": "string", "enum": ROLES},
                        "fit": {"type": "string", "enum": FITS},
                        "depth": {"type": "string", "enum": DEPTHS},
                    },
                    "required": ["mark_id", "traces", "element", "role", "fit", "depth"],
                },
            },
            "plan_read": {
                "type": "object",
                "properties": {
                    "principles": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "principle": {"type": "string", "enum": df.principle_keys()},
                                "group": {"type": "string", "enum": plan_read.GROUPS},
                                "mark_ids": ids,
                                "elements": {"type": "array", "items": {"type": "string", "enum": df.element_keys()}},
                                "why": {"type": "string"},
                                "tips": {"type": "array", "items": tip},
                            },
                            "required": ["principle", "group", "mark_ids", "elements", "why", "tips"],
                        },
                    },
                    "relationships": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {"type": "string", "enum": question_bank.relationship_types()},
                                "principle": {"type": "string", "enum": df.principle_keys()},
                                "objects": {"type": "array", "items": {"type": "string"}},
                                "mark_ids": ids,
                                "why": {"type": "string"},
                                "tips": {"type": "array", "items": tip},
                            },
                            "required": ["type", "principle", "objects", "mark_ids", "why", "tips"],
                        },
                    },
                },
                "required": ["principles", "relationships"],
            },
            "stroke_order_note": {"type": "string"},
        },
        "required": ["marks", "plan_read", "stroke_order_note"],
    }


# ---------- cleaning ----------

def _text(v) -> str:
    return v.strip() if isinstance(v, str) else ""


def _no_ids(text: str) -> bool:
    return bool(text) and not _ID_IN_TEXT.search(text)


def _safe(text) -> str:
    """Text the sketcher will read, or "" when it is empty or names an id."""
    t = _text(text)
    return t if _no_ids(t) else ""


def clean(raw: dict, plan: MarksPlan, media: list[str]) -> dict:
    """Gemini's answer, checked against the strokes, the matrix and the bank.
    The areas are built here, from the depths Gemini read for each stroke."""
    raw = raw if isinstance(raw, dict) else {}
    visible = plan.visible_ids
    elements = set(df.element_keys(from_marks=True))

    readings = []
    for m in raw.get("marks") or []:
        if isinstance(m, dict) and m.get("mark_id") in visible and m.get("element") in elements \
                and m.get("role") in ROLES and m.get("fit") in FITS \
                and m["mark_id"] not in {r["mark_id"] for r in readings}:
            readings.append({k: m[k] for k in ("mark_id", "traces", "element", "role", "fit")})
            readings[-1]["traces"] = _safe(readings[-1]["traces"]) or "a stroke"
            readings[-1]["depth"] = m.get("depth") if m.get("depth") in DEPTHS else None

    depth = {r["mark_id"]: r["depth"] for r in readings if r["depth"]}
    area_list, joins = mark_geometry.areas(plan.geo, plan.marks, plan.aspect, depth)
    stroke_order = [f["id"] for f in plan.geo["marks"]]
    return {
        "marks": readings,
        "plan_read": plan_read.clean(raw.get("plan_read"), visible, media, stroke_order, area_list),
        "areas": area_list,
        "area_joins": joins,
        "media": media,
        "stroke_order_note": _safe(raw.get("stroke_order_note")) or None,
    }


# ---------- prepared prompts ----------

def _adopted_regions(sketch) -> set:
    return {
        p.get("region_ref") for p in (sketch.focal_points or [])
        if p.get("source") in ("adopted", "prompted") and p.get("region_ref") is not None
    } | {
        m.get("adopted_region") for m in (sketch.marks or [])
        if m.get("adopted_region") is not None and not m.get("erased")
    }


def focal_list(sketch, cached_scene: dict | None) -> list[dict]:
    """
    "You might want to consider adding these to your sketch" (design doc,
    item 25): the focal areas from the scene analysis that none of the
    sketcher's own strokes marks, strongest first, at most
    MAX_FOCAL_SUGGESTIONS. One added from this list (a prompted stroke along
    its outline) stays listed, with adopted True, so it can be taken off.
    """
    scene = cached_scene or {}
    own = [m for m in (sketch.marks or []) if m.get("source") != "prompted"]
    adopted = _adopted_regions(sketch)
    return [
        {**sg, "adopted": sg["region_ref"] in adopted}
        for sg in scene_service.build_focal_suggestions(
            scene.get("focal_regions") or [], sketch.focal_points, own, scene.get("frame_aspect", 1.0))
    ][:MAX_FOCAL_SUGGESTIONS]


def assemble(cleaned: dict, sketch, cached_scene: dict | None, selected_ids: set[str] | None = None) -> dict:
    """The response: the plan read, the stroke readings, and the focal areas
    to consider (item 25). No questions: the card is one scroll. Run on every
    request, cached or not, so the areas follow the sketch's current strokes."""
    scene = cached_scene or {}
    return {
        "guide_source": "marks_analysis",
        "debug": DEBUG,
        "scene_type": scene.get("scene_type"),
        "marks": cleaned.get("marks") or [],
        "plan_read": cleaned.get("plan_read") or {"principles": [], "relationships": []},
        "areas": cleaned.get("areas") or [],
        "media": cleaned.get("media") or [],
        "stroke_order_note": cleaned.get("stroke_order_note"),
        "focal_suggestions": focal_list(sketch, scene),
        "prepared_prompts": [],
    }


# ---------- the call ----------

def analyze(pil_image: Image.Image, sketch, cached_scene: dict | None,
            plan: MarksPlan | None = None) -> tuple[dict, str | None]:
    """
    Returns (cleaned result, raw Gemini text). With no visible marks there
    is nothing to read, so no call is made. Raises GeminiQuotaExceededError
    unchanged for the router to turn into a 429.
    """
    plan = plan or build_plan(sketch)
    media = media_of(sketch)
    if not plan.marks:
        return clean({}, plan, media), None
    raw, raw_text = call_gemini_json_with_raw(
        build_prompt(plan, cached_scene, sketch, media), response_schema(),
        [pil_image, plan.image], mock_name="marks_analysis",
    )
    cleaned = clean(raw, plan, media)
    if DEBUG:
        print("\n--- Marks Analysis: plan read ---")
        for m in cleaned["marks"]:
            print(f"  {m['mark_id']}: {m['traces']} ({m['element']}, {m['role']}, fit {m['fit']}, {m['depth']})")
        print(f"  areas: {cleaned['areas']}")
        for j in cleaned["area_joins"]:
            print(f"    {j}")
        for pr in cleaned["plan_read"]["principles"]:
            print(f"  {pr['group']:8} {pr['principle']:10} {pr['mark_ids']} {[t['name'] + ': ' + t['tip'] for t in pr['tips']]}")
        for r in cleaned["plan_read"]["relationships"]:
            print(f"    {r['principle']} > {r['type']} {r['mark_ids']} {[t['tip'] for t in r['tips']]}")
        print("--- end plan read ---\n")
    return cleaned, raw_text
