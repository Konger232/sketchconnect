"""
Marks analysis call (design doc, Section 11, item 20). Reads the
sketcher's marks through the Elements × Principles matrix
(app/core/design_fundamentals.json) and writes the guided questions.

Runs after the scene analysis call, beside it, during the parallel run.
config.GUIDE_SOURCE picks which of the two drives the guided questions.
Scene analysis still supplies the scene facts (scene type, summary, focal
areas); this call reads them from the sketch's cached scene analysis as
text. Perspective and proportions are not offered by any guided question
(decided October 2, 2026): measuring is read as the proportion principle
through the sketcher's own marks.

Images sent, in order:
  1. the clean framed reference photo. Every coordinate comes from this one.
  2. the planning image with each mark's id at its start (core/composite.py).

Guide order (Elements x Principles Matrix doc, "Guide sequence", Oct 3, 2026):
  1. mark_meaning: seeing as, once per object (a shape of marks). Two AI
     readings, each tied to an element, with a short name for later.
  2. relationship: seeing that, once per pair of objects or for a lone
     object. 2 or 3 relationship types in the AI's wording; {A} and {B}
     are filled in the app with the sketcher's own names from step 1.
  3. principle_intent: what to bring out, right after its relationship
     question. One variant per type offered there, plus "other"; the app
     shows the variant for the sketcher's pick. A pick saves the principle
     as an intent. Up to max_principles across the plan.
  4. unseen: focal areas no mark sits on (focal_suggestion), else one
     question about a form relationship with no marks (unseen).
Every step except unseen can be answered by a tap on the photo (a mark,
or a scene object the AI traced) or in the sketcher's own words.

The HTTP route, caching and database writes are in router.py.
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
from app.features.marks_analysis import question_bank
from app.features.scene_analysis import service as scene_service

PROMPTS = Path(__file__).parent / "prompts"

# Bump when the cleaned result changes shape. Part of the cache fingerprint.
ANALYSIS_VERSION = 4  # 4: three-step guide (objects, relationships, principle steps); 3: unseen reticle

ROLES = ["contour", "big_shape", "eye_level", "ground_line", "perspective_guide",
         "measurement", "alignment", "gesture", "unclear"]
FITS = ["close", "loose", "not_applicable"]
MAX_STEP_OPTIONS = 3
MIN_STEP_OPTIONS = 2
MAX_RELATIONSHIP_QUESTIONS = 2
MAX_SCENE_OBJECTS = 6
MAX_FORM_RELATIONSHIPS = 4
WEIGHTS = ["light", "medium", "heavy"]
SIDES = ["left", "right", "top", "bottom", "even"]
# A form point closer than this to a mark (square units, frame long side
# 1000) counts as marked, so the unseen question never points at it.
UNSEEN_MIN_DISTANCE = 40
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
    aspect: float = 1.0

    @property
    def visible_ids(self) -> set[str]:
        return {f["id"] for f in self.geo["marks"]}

    @property
    def selected_ids(self) -> set[str]:
        return {f["id"] for f in self.geo["marks"] if f.get("selected")}

    def shape(self, shape_id: str) -> dict | None:
        return next((g for g in self.geo["groups"] if g["id"] == shape_id), None)


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
    return MarksPlan(geo=geo, marks=marks, image=image,
                     selected_shapes=shapes[:MAX_MARK_MEANING_QUESTIONS], aspect=aspect)


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
    eye = (s.get("perspective") or {}).get("eye_level_y")
    if eye is not None:
        lines.append(f"- Eye level: y = {eye}")
    return "\n".join(lines)


def _intents_text(intents: list[dict]) -> str:
    if not intents:
        return "none yet"
    return "\n".join(f"- {i['principle']} on {', '.join(i['mark_ids']) or 'no marks'} ({i['source']})" for i in intents)


def build_prompt(style: str, plan: MarksPlan, cached_scene: dict | None, sketch, intents: list[dict]) -> str:
    return render_prompt(
        PROMPTS / "marks_analysis.md",
        fundamentals=df.render_text(),
        bank=question_bank.render_bank(),
        max_objects=MAX_MARK_MEANING_QUESTIONS,
        style=style,
        scene_facts=scene_facts(cached_scene, sketch),
        marks_table=mark_geometry.marks_table(plan.geo),
        groups=mark_geometry.groups_text(plan.geo),
        shapes="\n".join(f"- {s['id']}: {', '.join(s['mark_ids'])}" for s in plan.selected_shapes) or "none selected",
        intents=_intents_text(intents),
    )


def fingerprint(sketch, cached_scene: dict | None) -> str:
    """
    Changes when anything the call reads changes: the scene analysis it
    builds on, the style, or the marks (selection included). Prompted marks
    ("Yes, add it") come from this guide, so they are left out. Answers are
    left out too: every relationship type offered already has its principle
    step.
    """
    payload = {
        "version": ANALYSIS_VERSION,
        "scene": (cached_scene or {}).get("plan_fingerprint"),
        "style": sketch.style,
        "marks": [m for m in (sketch.marks or []) if m.get("source") != "prompted"],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16]


# ---------- response schema ----------

def response_schema() -> dict:
    """Built per call: the enums follow the JSON files, which can change on disk."""
    ids = {"type": "array", "items": {"type": "string"}}
    element = {"type": "string", "enum": df.element_keys(from_marks=True)}
    principle = {"type": "string", "enum": df.principle_keys()}
    rtype = {"type": "string", "enum": question_bank.relationship_types()}
    point = {
        "type": "object",
        "properties": {"label": {"type": "string"}, "x": {"type": "integer"}, "y": {"type": "integer"}},
        "required": ["label", "x", "y"],
    }
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
                    },
                    "required": ["mark_id", "traces", "element", "role", "fit"],
                },
            },
            "objects": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "shape_id": {"type": "string"},
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                        "element": element,
                        "weight": {"type": "string", "enum": WEIGHTS},
                        "question": {"type": "string"},
                        "readings": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {"text": {"type": "string"}, "name": {"type": "string"}, "element": element},
                                "required": ["text", "name", "element"],
                            },
                        },
                    },
                    "required": ["shape_id", "name", "description", "element", "weight", "question", "readings"],
                },
            },
            "scene_objects": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "description": {"type": "string"},
                        "element": element,
                        "contour_points": {"type": "array", "items": {"type": "integer"}},
                    },
                    "required": ["label", "description", "element", "contour_points"],
                },
            },
            "relationships": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "refs": ids,
                        "question": {"type": "string"},
                        "options": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {"type": rtype, "text": {"type": "string"}},
                                "required": ["type", "text"],
                            },
                        },
                        "principle_steps": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "type": {"type": "string", "enum": question_bank.relationship_types() + ["other"]},
                                    "question": {"type": "string"},
                                    "options": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {"principle": principle, "text": {"type": "string"}},
                                            "required": ["principle", "text"],
                                        },
                                    },
                                },
                                "required": ["type", "question", "options"],
                            },
                        },
                    },
                    "required": ["refs", "question", "options", "principle_steps"],
                },
            },
            "balance": {
                "type": "object",
                "properties": {"heavier": {"type": "string", "enum": SIDES}, "reason": {"type": "string"}},
                "required": ["heavier", "reason"],
            },
            "form_relationships": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"forms": {"type": "array", "items": point}, "mark_ids": ids,
                                   "element": element, "principle": principle,
                                   "observation": {"type": "string"}},
                    "required": ["forms", "mark_ids", "principle", "observation"],
                },
            },
            "unseen": {
                "type": "object",
                "properties": {"form_ref": {"type": "integer"}, "question": {"type": "string"}},
                "required": ["form_ref", "question"],
            },
            "stroke_order_note": {"type": "string"},
        },
        "required": ["marks", "objects", "scene_objects", "relationships", "balance",
                     "form_relationships", "stroke_order_note"],
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


def _contour(flat) -> list[list[int]] | None:
    """Flat [x1, y1, ...] in 0-1000 as [[x, y], ...], at least 3 points, at most 14."""
    if not isinstance(flat, list):
        return None
    nums = [max(0, min(1000, int(v))) for v in flat if isinstance(v, (int, float))][:28]
    pts = [[nums[k], nums[k + 1]] for k in range(0, len(nums) - 1, 2)]
    return pts if len(pts) >= 3 else None


def _fallback_options(element: str, first: str | None = None) -> list[dict]:
    """Principle options from an element's matrix row, in the bank's own
    words (the cell's looks_for), when Gemini left a step out."""
    row = df.row(element)
    order = ([first] if first in row else []) + [p for p in row if p != first]
    return [{"principle": p, "text": df.cell(element, p)["looks_for"].rstrip(".")} for p in order[:MAX_STEP_OPTIONS]]


def _principle_step(raw: dict | None, element: str, first: str | None, fallback_question: str) -> dict:
    """
    One what-to-bring-out step: 2 or 3 options from the element's matrix row,
    with `first` (the relationship type's own principle) first. Gemini's
    wording when it fits the matrix, the bank's otherwise.
    """
    raw = raw or {}
    row = df.row(element)
    opts, seen = [], set()
    for o in raw.get("options") or []:
        p, t = o.get("principle"), _safe(o.get("text"))
        if p in row and p not in seen and t:
            seen.add(p)
            opts.append({"principle": p, "text": t})
    if first and first not in seen:
        cell = df.cell(element, first)
        if cell:
            opts.insert(0, {"principle": first, "text": cell["looks_for"].rstrip(".")})
    elif first:
        opts.sort(key=lambda o: o["principle"] != first)
    opts = opts[:MAX_STEP_OPTIONS]
    if len(opts) < MIN_STEP_OPTIONS:
        opts = _fallback_options(element, first)
    return {"question": _safe(raw.get("question")) or fallback_question, "options": opts, "element": element}


def clean(raw: dict, plan: MarksPlan, intents: list[dict]) -> dict:
    """Gemini's answer, checked against the marks, the matrix and the bank."""
    visible = plan.visible_ids
    elements = set(df.element_keys(from_marks=True))
    principles = set(df.principle_keys())
    bank = question_bank.load_bank()

    readings = []
    for m in raw.get("marks") or []:
        if m.get("mark_id") in visible and m.get("element") in elements \
                and m.get("role") in ROLES and m.get("fit") in FITS \
                and m["mark_id"] not in {r["mark_id"] for r in readings}:
            readings.append({k: m[k] for k in ("mark_id", "traces", "element", "role", "fit")})
            readings[-1]["traces"] = _safe(readings[-1]["traces"]) or "a mark"
    element_of = {r["mark_id"]: r["element"] for r in readings}

    # Objects (step 1): the sketcher's selection wins. Otherwise Gemini's picks.
    selected = {s["id"]: s["mark_ids"] for s in plan.selected_shapes}
    raw_objects = {o.get("shape_id"): o for o in raw.get("objects") or [] if isinstance(o, dict)}
    order = list(selected) if selected else [k for k in raw_objects if plan.shape(k)]
    objects = []
    for sid in order[:MAX_MARK_MEANING_QUESTIONS]:
        g = plan.shape(sid)
        if g is None:
            continue
        mark_ids = selected.get(sid) or list(g["mark_ids"])
        o = raw_objects.get(sid) or {}
        element = o.get("element")
        if element not in elements:
            found = [element_of[i] for i in mark_ids if i in element_of]
            element = max(set(found), key=found.count) if found else "shape"
        rs = []
        for r in (o.get("readings") or [])[:2]:
            t, n = _safe(r.get("text")), _safe(r.get("name"))
            if t and n and r.get("element") in elements:
                rs.append({"text": t, "name": n, "element": r["element"]})
        objects.append({
            "shape_id": sid,
            "mark_ids": mark_ids,
            "selected": sid in selected,
            "name": _safe(o.get("name")) or (rs[0]["name"] if rs else "this part"),
            "description": _safe(o.get("description")),
            "element": element,
            "weight": o.get("weight") if o.get("weight") in WEIGHTS else None,
            "question": _safe(o.get("question")),
            "readings": rs if len(rs) == 2 else [],
        })
    by_id = {o["shape_id"]: o for o in objects}

    # Scene objects: what a tap on the photo can pick.
    scene_objects = []
    for o in raw.get("scene_objects") or []:
        pts = _contour(o.get("contour_points"))
        label = _safe(o.get("label"))
        if pts and label and o.get("element") in elements:
            scene_objects.append({"id": f"o{len(scene_objects) + 1}", "label": label,
                                  "description": _safe(o.get("description")) or label,
                                  "element": o["element"], "points": pts})
        if len(scene_objects) >= MAX_SCENE_OBJECTS:
            break

    # Relationships (step 2) and their principle steps (step 3).
    one_types = set(question_bank.one_object_types())
    q_two = bank["relationship"]["questions_two"][0]
    q_one = bank["relationship"]["questions_one"][0]
    q_bring = bank["principle_intent"]["questions"][0]
    relationships, pairs = [], set()
    for r in raw.get("relationships") or []:
        refs = list(dict.fromkeys(x for x in (r.get("refs") or []) if x in by_id))[:2]
        if not refs or tuple(sorted(refs)) in pairs:
            continue
        allowed = set(question_bank.relationship_types()) if len(refs) == 2 else one_types
        opts, seen = [], set()
        for o in r.get("options") or []:
            t, text = o.get("type"), _safe(o.get("text"))
            if t in allowed and t not in seen and text:
                if len(refs) == 1 and "{B}" in text:
                    continue
                seen.add(t)
                opts.append({"type": t, "text": text})
        opts = opts[:MAX_STEP_OPTIONS]
        if len(opts) < MIN_STEP_OPTIONS:
            if DEBUG:
                print(f"[marks_analysis] relationship dropped (too few usable options): {json.dumps(r)}")
            continue
        raw_steps = {st.get("type"): st for st in r.get("principle_steps") or [] if isinstance(st, dict)}
        steps = {}
        for o in opts:
            info = question_bank.type_info(o["type"])
            steps[o["type"]] = _principle_step(raw_steps.get(o["type"]), info["element"], info["principle"], q_bring)
        steps["other"] = _principle_step(raw_steps.get("other"), by_id[refs[0]]["element"], None, q_bring)
        question = _safe(r.get("question")) or (q_two if len(refs) == 2 else q_one)
        if len(refs) == 1:
            question = question.replace("{B}", "").strip()
        pairs.add(tuple(sorted(refs)))
        relationships.append({"refs": refs, "question": question, "options": opts, "principle_steps": steps})
        if len(relationships) >= MAX_RELATIONSHIP_QUESTIONS:
            break

    b = raw.get("balance") if isinstance(raw.get("balance"), dict) else {}
    balance = {"heavier": b["heavier"], "reason": _safe(b.get("reason"))} if b.get("heavier") in SIDES else None

    form_relationships = []
    for x in raw.get("form_relationships") or []:
        forms = [{"label": _text(f.get("label")), "x": max(0, min(1000, int(f.get("x", 0)))),
                  "y": max(0, min(1000, int(f.get("y", 0))))}
                 for f in (x.get("forms") or []) if isinstance(f, dict) and _text(f.get("label"))][:3]
        if len(forms) < 2 or x.get("principle") not in principles or not _text(x.get("observation")):
            form_relationships.append(None)  # keeps form_ref indexes lined up
            continue
        element = x.get("element") if df.cell(x.get("element"), x["principle"]) else None
        form_relationships.append({"forms": forms, "mark_ids": [i for i in (x.get("mark_ids") or []) if i in visible],
                                   "element": element, "principle": x["principle"],
                                   "observation": _text(x["observation"])})

    unseen = None
    u = raw.get("unseen")
    if isinstance(u, dict):
        ref = u.get("form_ref")
        fr = form_relationships[ref] if isinstance(ref, int) and 0 <= ref < len(form_relationships) else None
        if fr and not fr["mark_ids"] and _no_ids(_text(u.get("question"))):
            # Point the reticle at the form no mark sits on, measured
            # against the marks, not at whichever form Gemini listed first.
            # When every form has a mark on or near it, nothing is unseen.
            far = max(fr["forms"], key=lambda f: mark_geometry.distance_to_marks((f["x"], f["y"]), plan.marks, plan.aspect))
            if mark_geometry.distance_to_marks((far["x"], far["y"]), plan.marks, plan.aspect) >= UNSEEN_MIN_DISTANCE:
                unseen = {"question": _text(u["question"]), "element": fr["element"], "principle": fr["principle"],
                          "x": far["x"], "y": far["y"], "label": far["label"]}
            elif DEBUG:
                print(f"[marks_analysis] unseen dropped: every form in {json.dumps(fr['forms'])} has a mark on it")

    return {
        "marks": readings,
        "objects": objects,
        "scene_objects": scene_objects,
        "relationships": relationships,
        "balance": balance,
        "form_relationships": [f for f in form_relationships if f],
        "unseen": unseen,
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


def assemble(cleaned: dict, sketch, cached_scene: dict | None, selected_ids: set[str]) -> dict:
    """The response: the cleaned readings plus the questions in guide order.
    Run on every request, cached or not, so the unseen questions follow the
    sketch's current marks (an adopted area is not asked again)."""
    intents = intents_from_choices(sketch.session_choices)
    focus = lambda ids: "selected" if set(ids) & selected_ids else "other"
    objects = {o["shape_id"]: o for o in cleaned.get("objects") or []}
    prompts = []

    # 1. Seeing as, one per object.
    for o in objects.values():
        if o["readings"]:
            prompts.append(question_bank.mark_meaning_prompt(o["question"], o["readings"], o, focus(o["mark_ids"])))
    # 2 and 3. Seeing that, each followed by what to bring out.
    for conn in cleaned.get("relationships") or []:
        if not all(r in objects for r in conn["refs"]):
            continue
        ids = [m for r in conn["refs"] for m in objects[r]["mark_ids"]]
        prompts.append(question_bank.relationship_prompt(conn, objects, focus(ids)))
        prompts.append(question_bank.principle_prompt(conn, objects, focus(ids)))

    # Unseen: focal areas no mark sits on, from the scene analysis.
    scene = cached_scene or {}
    adopted = _adopted_regions(sketch)
    suggestions = [
        sg for sg in scene_service.build_focal_suggestions(
            scene.get("focal_regions") or [], sketch.focal_points, sketch.marks, scene.get("frame_aspect", 1.0))
        if sg["region_ref"] not in adopted
    ][:MAX_FOCAL_SUGGESTIONS]
    for sg in suggestions:
        prompts.append({**question_bank.focal_suggestion_prompt(sg["label"], sg.get("reason")), "suggestion": sg})
    un = cleaned.get("unseen")
    if not suggestions and un:
        prompts.append({**question_bank.unseen_prompt(un["question"], un["element"], un["principle"]),
                        "spot": {"x": un["x"], "y": un["y"], "mark_ids": []}})

    return {
        "guide_source": "marks_analysis",
        "debug": DEBUG,
        "scene_type": scene.get("scene_type"),
        "marks": cleaned.get("marks") or [],
        "objects": [{k: o[k] for k in ("shape_id", "mark_ids", "name", "description", "element", "weight", "readings", "selected")}
                    for o in objects.values()],
        "scene_objects": cleaned.get("scene_objects") or [],
        "balance": cleaned.get("balance"),
        "form_relationships": cleaned.get("form_relationships") or [],
        "stroke_order_note": cleaned.get("stroke_order_note"),
        "intents": intents,
        "max_principles": question_bank.max_principles(),
        "focal_suggestions": suggestions,
        "prepared_prompts": prompts,
    }


# ---------- the call ----------

def analyze(pil_image: Image.Image, sketch, cached_scene: dict | None, style: str,
            plan: MarksPlan | None = None) -> tuple[dict, str | None]:
    """
    Returns (cleaned result, raw Gemini text). With no visible marks there
    is nothing to read, so no call is made. Raises GeminiQuotaExceededError
    unchanged for the router to turn into a 429.
    """
    plan = plan or build_plan(sketch)
    intents = intents_from_choices(sketch.session_choices)
    if not plan.marks:
        return clean({}, plan, intents), None
    raw, raw_text = call_gemini_json_with_raw(
        build_prompt(style, plan, cached_scene, sketch, intents), response_schema(),
        [pil_image, plan.image], mock_name="marks_analysis",
    )
    cleaned = clean(raw, plan, intents)
    if DEBUG:
        print("\n--- Marks Analysis decision ---")
        for m in cleaned["marks"]:
            print(f"  {m['mark_id']}: {m['traces']} ({m['element']}, {m['role']}, fit {m['fit']})")
        for o in cleaned["objects"]:
            print(f"  object {o['shape_id']} {o['mark_ids']} '{o['name']}' ({o['element']}, {o['weight']}): "
                  f"{[(r['text'], r['element']) for r in o['readings']]}")
        print(f"  scene objects: {[(o['label'], o['element']) for o in cleaned['scene_objects']]}")
        for r in cleaned["relationships"]:
            print(f"  relationship {r['refs']}: {r['question']} {[(o['type'], o['text']) for o in r['options']]}")
            for t, st in r["principle_steps"].items():
                print(f"    {t}: {[(o['principle'], o['text']) for o in st['options']]}")
        print(f"  balance: {json.dumps(cleaned['balance'])}")
        print(f"  unseen: {json.dumps(cleaned['unseen'])}")
        print("--- end Marks Analysis decision ---\n")
    return cleaned, raw_text
