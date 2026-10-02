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

Guide order (item 20):
  1. relationship: at most once. A Yes saves the type's principle as an
     intent (source "prompted", answer_to "relationship").
  2. mark_meaning: seeing as, once per shape the relationship does not cover.
  3. principle_intent: seeing that, once per shape. Multi-select, plus
     "Not sure yet". Up to max_principles across the whole plan.
  4. mark_questions: one seed per offered principle per shape. The app
     asks one only when the sketcher picked its principle
     (requires_principle), so a change of intent needs no new call.
  5. unseen: focal areas no mark sits on (focal_suggestion), else one
     question about a form relationship with no marks (unseen). Counted
     on its own, so intents never crowd it out.

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
ANALYSIS_VERSION = 3  # 3: unseen reticle on the form no mark sits on

ROLES = ["contour", "big_shape", "eye_level", "ground_line", "perspective_guide",
         "measurement", "alignment", "gesture", "unclear"]
FITS = ["close", "loose", "not_applicable"]
MAX_OFFERED_PRINCIPLES = 3
MIN_OFFERED_PRINCIPLES = 2
MAX_MARK_RELATIONSHIPS = 5
MAX_FORM_RELATIONSHIPS = 4
# A form point closer than this to a mark (square units, frame long side
# 1000) counts as marked, so the unseen question never points at it.
UNSEEN_MIN_DISTANCE = 40
# An id written into text the sketcher reads (m3, s1). Ids are never shown.
_ID_IN_TEXT = re.compile(r"\b[ms]\d+\b", re.IGNORECASE)


# ---------- intents ----------

def intents_from_choices(choices: list[dict] | None) -> list[dict]:
    """
    The principles the sketcher works toward, from their saved answers:
    principle_intent picks (source "intended") and a Yes to the
    relationship question (source "prompted", answer_to "relationship").
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
        rel = c.get("relationship") or {}
        if c.get("key") == "relationship" and c.get("option_index") == 0 and rel.get("principle"):
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
        relationship_types=question_bank.render_relationship_types(),
        max_shapes=MAX_MARK_MEANING_QUESTIONS,
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
    ("Yes, add it") come from this guide, so they are left out. Intents are
    left out too: every offered principle already has its question.
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
            "shapes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "shape_id": {"type": "string"},
                        "element": element,
                        "question": {"type": "string"},
                        "readings": {"type": "array", "items": {"type": "string"}},
                        "intent_question": {"type": "string"},
                        "principles": {"type": "array", "items": principle},
                    },
                    "required": ["shape_id", "element", "question", "readings", "intent_question", "principles"],
                },
            },
            "mark_questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "enum": question_bank.mark_question_keys()},
                        "shape_id": {"type": "string"},
                        "question": {"type": "string"},
                        "options": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["key", "shape_id", "question", "options"],
                },
            },
            "relationship": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": question_bank.relationship_types()},
                    "subjects": {"type": "array", "items": {"type": "string"}},
                    "mark_ids": ids,
                    "question": {"type": "string"},
                },
                "required": ["type", "subjects", "mark_ids", "question"],
            },
            "mark_relationships": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"mark_ids": ids, "element": element, "principle": principle,
                                   "observation": {"type": "string"}},
                    "required": ["mark_ids", "element", "principle", "observation"],
                },
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
        "required": ["marks", "shapes", "mark_questions", "mark_relationships",
                     "form_relationships", "stroke_order_note"],
    }


# ---------- cleaning ----------

def _text(v) -> str:
    return v.strip() if isinstance(v, str) else ""


def _no_ids(text: str) -> bool:
    return bool(text) and not _ID_IN_TEXT.search(text)


def _offered(element: str, raw: list, keep: list[str]) -> list[str]:
    """2-3 principles from the element's matrix row: the sketcher's earlier
    picks on these marks first, then Gemini's, then strong pairs to fill."""
    row = df.row(element)
    out = []
    for p in list(keep) + list(raw or []) + [p for p in row if df.cell(element, p)["strength"] == "strong"]:
        if p in row and p not in out:
            out.append(p)
        if len(out) >= MAX_OFFERED_PRINCIPLES:
            break
    return out if len(out) >= MIN_OFFERED_PRINCIPLES else []


def clean(raw: dict, plan: MarksPlan, intents: list[dict]) -> dict:
    """Gemini's answer, checked against the marks, the matrix and the bank."""
    visible = plan.visible_ids
    mark_elements = set(df.element_keys(from_marks=True))
    principles = set(df.principle_keys())
    by_id = {f["id"]: f for f in plan.geo["marks"]}

    readings = []
    for m in raw.get("marks") or []:
        if m.get("mark_id") in visible and m.get("element") in mark_elements \
                and m.get("role") in ROLES and m.get("fit") in FITS:
            if m["mark_id"] not in {r["mark_id"] for r in readings}:
                readings.append({k: m[k] for k in ("mark_id", "traces", "element", "role", "fit")})
    element_of = {r["mark_id"]: r["element"] for r in readings}

    # Shapes: the sketcher's selection wins. Otherwise Gemini's picks.
    selected = {s["id"]: s["mark_ids"] for s in plan.selected_shapes}
    raw_shapes = {s.get("shape_id"): s for s in raw.get("shapes") or [] if isinstance(s, dict)}
    order = list(selected) if selected else [k for k in raw_shapes if plan.shape(k)]
    shapes = []
    for sid in order[:MAX_MARK_MEANING_QUESTIONS]:
        g = plan.shape(sid)
        if g is None:
            continue
        mark_ids = selected.get(sid) or list(g["mark_ids"])
        r = raw_shapes.get(sid) or {}
        element = r.get("element")
        if element not in mark_elements:
            found = [element_of[i] for i in mark_ids if i in element_of]
            element = max(set(found), key=found.count) if found else "shape"
        keep = [i["principle"] for i in intents if set(i["mark_ids"]) & set(mark_ids)]
        offered = _offered(element, r.get("principles"), keep)
        texts = [_text(x) for x in (r.get("readings") or [])][:2]
        shapes.append({
            "shape_id": sid,
            "mark_ids": mark_ids,
            "element": element,
            "selected": sid in selected,
            "readings": texts if len(texts) == 2 and all(_no_ids(t) for t in texts) else [],
            "principles": offered,
            "question": _text(r.get("question")) if _no_ids(_text(r.get("question"))) else "",
            "intent_question": _text(r.get("intent_question")) if _no_ids(_text(r.get("intent_question"))) else "",
        })

    # Seed questions, one per shape and offered principle.
    bank_q = question_bank.load_bank()["mark_questions"]
    mark_questions = []
    taken = set()
    for q in raw.get("mark_questions") or []:
        key, sid = q.get("key"), q.get("shape_id")
        shape = next((s for s in shapes if s["shape_id"] == sid), None)
        if key not in bank_q or shape is None:
            continue
        p = bank_q[key]["principle"]
        if p not in shape["principles"] or (sid, p) in taken or len(shape["mark_ids"]) < bank_q[key]["min_marks"]:
            continue
        options = [_text(o) for o in (q.get("options") or [])]
        if not all(_no_ids(o) for o in options):
            options = []
        taken.add((sid, p))
        mark_questions.append({"key": key, "shape_id": sid, "mark_ids": shape["mark_ids"],
                               "question": _text(q.get("question")) if _no_ids(_text(q.get("question"))) else "",
                               "options": options})
    # Fill an offered principle Gemini skipped with the bank's own wording,
    # when a seed on the shape's own element fits. A seed on another
    # element reads wrong unadapted ("This line..." about a shape).
    for s in shapes:
        for p in s["principles"]:
            if (s["shape_id"], p) in taken:
                continue
            seed = next((k for k in question_bank.seeds_for(p)
                         if bank_q[k]["element"] == s["element"] and len(s["mark_ids"]) >= bank_q[k]["min_marks"]), None)
            if seed:
                taken.add((s["shape_id"], p))
                mark_questions.append({"key": seed, "shape_id": s["shape_id"], "mark_ids": s["mark_ids"],
                                       "question": "", "options": []})

    relationship = None
    r = raw.get("relationship")
    if isinstance(r, dict):
        subjects = [_text(x) for x in (r.get("subjects") or []) if _text(x)][:3]
        mark_ids = [i for i in (r.get("mark_ids") or []) if i in visible]
        question = _text(r.get("question"))
        if r.get("type") in question_bank.relationship_types() and len(subjects) >= 2 and mark_ids and _no_ids(question):
            relationship = {"type": r["type"], "subjects": subjects, "mark_ids": mark_ids, "question": question}
        elif DEBUG:
            print(f"[marks_analysis] relationship dropped: {json.dumps(r)}")

    mark_relationships = []
    for x in raw.get("mark_relationships") or []:
        ids = [i for i in (x.get("mark_ids") or []) if i in visible]
        if len(ids) >= 2 and df.cell(x.get("element"), x.get("principle")) and _no_ids(_text(x.get("observation"))):
            mark_relationships.append({"mark_ids": ids, "element": x["element"], "principle": x["principle"],
                                       "observation": _text(x["observation"])})
    mark_relationships = mark_relationships[:MAX_MARK_RELATIONSHIPS]

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
        "shapes": shapes,
        "mark_questions": mark_questions,
        "relationship": relationship,
        "mark_relationships": mark_relationships,
        "form_relationships": [f for f in form_relationships if f],
        "unseen": unseen,
        "stroke_order_note": _text(raw.get("stroke_order_note")) or None,
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
    prompts = []

    rel = cleaned.get("relationship")
    if rel:
        prompts.append(question_bank.relationship_prompt(
            rel["question"], rel["type"], rel["subjects"], rel["mark_ids"], focus(rel["mark_ids"])))
    covered = set(rel["mark_ids"]) if rel else set()

    shapes = cleaned.get("shapes") or []
    for s in shapes:
        if s["readings"] and not covered & set(s["mark_ids"]):
            prompts.append(question_bank.mark_meaning_prompt(
                s["question"], s["readings"], s["shape_id"], s["mark_ids"], focus(s["mark_ids"])))
    for s in shapes:
        if s["principles"]:
            prompts.append(question_bank.principle_intent_prompt(
                s["intent_question"], s["element"], s["principles"], s["shape_id"], s["mark_ids"], focus(s["mark_ids"])))
    for q in cleaned.get("mark_questions") or []:
        prompts.append(question_bank.mark_question_prompt(
            q["key"], q["question"], q["options"], q["shape_id"], q["mark_ids"], focus(q["mark_ids"])))
    # A Yes to the relationship is an intent too. Give its principle a seed
    # on the relationship's marks, unless a shape question already covers it.
    if rel:
        principle = question_bank.load_bank()["relationship"]["types"][rel["type"]]["principle"]
        asked = any(q["principle"] == principle and covered & set(q["mark_ids"])
                    for q in prompts if q.get("requires_principle"))
        seed = next(iter(question_bank.seeds_for(principle)), None)
        if seed and not asked and len(rel["mark_ids"]) >= question_bank.load_bank()["mark_questions"][seed]["min_marks"]:
            prompts.append(question_bank.mark_question_prompt(seed, "", [], None, rel["mark_ids"], focus(rel["mark_ids"])))

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
        "scene_type": scene.get("scene_type"),
        "marks": cleaned.get("marks") or [],
        "shapes": [{k: s[k] for k in ("shape_id", "mark_ids", "element", "readings", "principles", "selected")}
                   for s in shapes],
        "mark_relationships": cleaned.get("mark_relationships") or [],
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
        for s in cleaned["shapes"]:
            print(f"  shape {s['shape_id']} {s['mark_ids']} as {s['element']}: readings {s['readings']} principles {s['principles']}")
        print(f"  relationship: {json.dumps(cleaned['relationship'])}")
        print(f"  mark_questions: {[(q['shape_id'], q['key']) for q in cleaned['mark_questions']]}")
        print(f"  unseen: {json.dumps(cleaned['unseen'])}")
        print("--- end Marks Analysis decision ---\n")
    return cleaned, raw_text
