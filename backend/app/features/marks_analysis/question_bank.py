"""
Loads and checks question_bank.json, the guided question bank for the
marks analysis call (design doc, Section 11, item 20; Elements x Principles
Matrix doc, "Guide sequence", October 3, 2026). Element and principle keys
come from app/core/design_fundamentals.json.

The guide has three steps, each with 2 or 3 versions of its question:
  mark_meaning      seeing as: what a mark points at
  relationship      seeing that: how two objects connect, or what one does
  principle_intent  what the sketcher wants to bring out
plus focal_suggestion and unseen, about something no mark sits on. Every
step also takes a tap on the photo or the sketcher's own words (own_words).

The bank is data, so it lives in JSON. The prompt prose lives in
prompts/*.md. This file only loads, checks and formats the bank. Every
load is checked against the rules in the matrix doc:
  - Every element and principle key exists in design_fundamentals.json.
  - Every mark_questions key is <element>_<principle>, and the pair is a
    matrix cell.
  - A mark_questions element has from_marks: true.
  - Every relationship type's principle is a principle, its element is an
    element, and the pair is a matrix cell.
  - max_principles is between 1 and 3.
  - Each option action is listed in actions.
  - At most one undecided_principle option, and only in principle_intent.
A broken bank raises ValueError, so a typo fails loudly at startup.
"""
import json
import re
from pathlib import Path
from string import Template

from app.core import design_fundamentals as df

BANK_PATH = Path(__file__).parent / "question_bank.json"
MIN_OPTIONS, MAX_OPTIONS = 2, 4

_cache: tuple[float, dict] | None = None


def _text(v) -> bool:
    return isinstance(v, str) and bool(v.strip())


def _options(where: str, opts, actions: set[str], lo: int, hi: int) -> tuple[list[str], int]:
    """Problems with an option list, and how many undecided_principle options it has."""
    if not isinstance(opts, list) or not (lo <= len(opts) <= hi):
        return [f"{where}: needs {lo}-{hi} options"], 0
    problems, undecided = [], 0
    for i, o in enumerate(opts, 1):
        if not isinstance(o, dict) or not _text(o.get("label")):
            problems.append(f"{where}: option {i} needs a non-empty label")
            continue
        if "action" in o and o["action"] not in actions:
            problems.append(f"{where}: option {i} has unknown action {o['action']!r} (see 'actions')")
        if o.get("undecided_principle"):
            undecided += 1
    return problems, undecided


def _versions(where: str, qs, lo: int = 1, hi: int = 3) -> list[str]:
    if not isinstance(qs, list) or not (lo <= len(qs) <= hi) or not all(_text(q) for q in qs):
        return [f"{where}: needs {lo}-{hi} question versions"]
    return []


def _check(bank: dict) -> None:
    problems = []
    elements = set(df.element_keys())
    mark_elements = set(df.element_keys(from_marks=True))
    principles = set(df.principle_keys())
    actions = set(bank.get("actions") or {})
    undecided = {}

    def opts(where, lst, lo, hi):
        p, u = _options(where, lst, actions, lo, hi)
        problems.extend(p)
        undecided[where] = undecided.get(where, 0) + u

    def element_ok(where, e, allow_null=True):
        if e is None and allow_null:
            return
        if e not in elements:
            problems.append(f"{where}: element {e!r} is not in design_fundamentals.json")

    def principle_ok(where, p):
        if p not in principles:
            problems.append(f"{where}: principle {p!r} is not in design_fundamentals.json")

    if not actions:
        problems.append("actions is missing")

    ow = bank.get("own_words")
    if not isinstance(ow, dict) or not _text(ow.get("placeholder")) or not _text(ow.get("spot_placeholder")):
        problems.append("own_words: needs placeholder and spot_placeholder")
    elif not isinstance(ow.get("max_length"), int) or not 1 <= ow["max_length"] <= 500:
        problems.append("own_words: max_length must be a whole number from 1 to 500")

    fs = bank.get("focal_suggestion")
    if not isinstance(fs, dict):
        problems.append("focal_suggestion is missing")
    else:
        if "$label" not in (fs.get("question") or ""):
            problems.append("focal_suggestion: question must contain $label")
        element_ok("focal_suggestion", fs.get("element"))
        principle_ok("focal_suggestion", fs.get("principle"))
        opts("focal_suggestion", fs.get("fixed_options"), 2, 3)

    mm = bank.get("mark_meaning")
    if not isinstance(mm, dict):
        problems.append("mark_meaning is missing")
    else:
        problems += _versions("mark_meaning.questions", mm.get("questions"))

    rel = bank.get("relationship")
    if not isinstance(rel, dict):
        problems.append("relationship is missing")
    else:
        problems += _versions("relationship.questions_two", rel.get("questions_two"))
        problems += _versions("relationship.questions_one", rel.get("questions_one"))
        if "kinds" in rel:
            problems.append("relationship: 'kinds' is renamed 'types'")
        types = rel.get("types")
        if not isinstance(types, dict) or not types:
            problems.append("relationship: needs at least one entry in 'types'")
        else:
            for name, t in types.items():
                where = f"relationship.types.{name}"
                if not isinstance(t, dict):
                    problems.append(f"{where}: must be an object")
                    continue
                element_ok(where, t.get("element"), allow_null=False)
                principle_ok(where, t.get("principle"))
                if t.get("element") in elements and t.get("principle") in principles \
                        and df.cell(t["element"], t["principle"]) is None:
                    problems.append(f"{where}: {t['element']} > {t['principle']} is not a matrix cell")
                for field in ("looks_for", "example", "option"):
                    if not _text(t.get(field)):
                        problems.append(f"{where}: missing {field}")
                if "option_one" in t and not _text(t["option_one"]):
                    problems.append(f"{where}: option_one must be text when present")

    pi = bank.get("principle_intent")
    if not isinstance(pi, dict):
        problems.append("principle_intent is missing")
    else:
        problems += _versions("principle_intent.questions", pi.get("questions"))
        mp = pi.get("max_principles")
        if not isinstance(mp, int) or isinstance(mp, bool) or not 1 <= mp <= 3:
            problems.append("principle_intent: max_principles must be between 1 and 3")
        if not isinstance(pi.get("multi_select"), bool):
            problems.append("principle_intent: multi_select must be true or false")
        if "fixed_options" in pi:
            opts("principle_intent", pi.get("fixed_options"), 1, 1)
            if undecided.get("principle_intent", 0) > 1:
                problems.append("principle_intent: at most one undecided_principle option")

    mq = bank.get("mark_questions") or {}
    if not isinstance(mq, dict):
        problems.append("mark_questions must be an object")
        mq = {}
    for key, q in mq.items():
        where = f"mark_questions.{key}"
        if not isinstance(q, dict):
            problems.append(f"{where}: must be an object")
            continue
        e, p = q.get("element"), q.get("principle")
        element_ok(where, e, allow_null=False)
        principle_ok(where, p)
        if key != f"{e}_{p}":
            problems.append(f"{where}: key must be <element>_<principle>, here {e}_{p}")
        if e in elements and e not in mark_elements:
            problems.append(f"{where}: element {e!r} is not read from marks (from_marks is false)")
        elif e in mark_elements and p in principles and df.cell(e, p) is None:
            problems.append(f"{where}: {e} > {p} is a skipped pair in the matrix")
        mn = q.get("min_marks")
        if not isinstance(mn, int) or isinstance(mn, bool) or mn < 1:
            problems.append(f"{where}: min_marks must be a whole number of 1 or more")
        if not _text(q.get("question")):
            problems.append(f"{where}: missing question text")
        opts(where, q.get("options"), MIN_OPTIONS, MAX_OPTIONS)

    un = bank.get("unseen")
    if not isinstance(un, dict):
        problems.append("unseen is missing")
    else:
        if not _text(un.get("question")):
            problems.append("unseen: missing question text")
        opts("unseen", un.get("fixed_options"), 2, 3)

    for where, n in undecided.items():
        if n and where != "principle_intent":
            problems.append(f"{where}: undecided_principle is allowed only in principle_intent")

    if problems:
        raise ValueError("marks_analysis/question_bank.json is invalid:\n  " + "\n  ".join(problems))


def load_bank() -> dict:
    global _cache
    mtime = max(BANK_PATH.stat().st_mtime, df.PATH.stat().st_mtime)
    if _cache and _cache[0] == mtime:
        return _cache[1]
    bank = json.loads(BANK_PATH.read_text(encoding="utf-8"))
    _check(bank)
    _cache = (mtime, bank)
    return bank


# ---------- lookups ----------

def max_principles() -> int:
    return load_bank()["principle_intent"]["max_principles"]


def own_words() -> dict:
    return load_bank()["own_words"]


def relationship_types() -> list[str]:
    return list(load_bank()["relationship"]["types"])


def one_object_types() -> list[str]:
    return [k for k, t in load_bank()["relationship"]["types"].items() if t.get("option_one")]


def type_info(rtype: str) -> dict:
    return load_bank()["relationship"]["types"][rtype]


def mark_question_keys() -> list[str]:
    return list(load_bank().get("mark_questions") or {})


def repeated_keys() -> set[str]:
    """Keys asked more than once per sketch (per object, pair or area), so
    the question text tells their answers apart (sketches/router.py)."""
    return {"mark_meaning", "relationship", "principle_intent", "focal_suggestion", "unseen", *mark_question_keys()}


# ---------- prompt text ----------

def render_bank() -> str:
    """The three steps and the relationship types as prompt text. Static between edits."""
    bank = load_bank()
    rel = bank["relationship"]
    lines = [
        "Seeing as (mark_meaning) question versions: " + json.dumps(bank["mark_meaning"]["questions"]),
        "Seeing that (relationship), two objects: " + json.dumps(rel["questions_two"]),
        "Seeing that (relationship), one object: " + json.dumps(rel["questions_one"]),
        "What to bring out (principle_intent): " + json.dumps(bank["principle_intent"]["questions"]),
        "",
        "Relationship types (type: element > principle. What to look for. Option wording.):",
    ]
    for name, t in rel["types"].items():
        one = f' One object: "{t["option_one"]}".' if t.get("option_one") else " Two objects only."
        lines.append(f'- {name}: {t["element"]} > {t["principle"]}. {t["looks_for"].rstrip(".")}. '
                     f'Example: {t["example"]}. Two objects: "{t["option"]}".{one}')
    return "\n".join(lines)


# ---------- prepared prompts ----------

def _clean(text: str) -> str:
    return re.sub(r"\s{2,}", " ", (text or "")).strip()


def _fixed(section: dict) -> tuple[list[str], list]:
    fixed = section.get("fixed_options") or []
    return [o["label"] for o in fixed], [o.get("action") for o in fixed]


def _answer_by_tap(prompt: dict) -> dict:
    """Every guide step can be answered by a tap on the photo or in the
    sketcher's own words (the pencil row)."""
    ow = own_words()
    return {**prompt, "tap_answer": True, "own_words": True,
            "own_words_placeholder": ow["placeholder"], "spot_placeholder": ow["spot_placeholder"],
            "own_words_max": ow["max_length"]}


def focal_suggestion_prompt(label: str, reason: str | None) -> dict:
    t = load_bank()["focal_suggestion"]
    reason = (reason or "").strip()
    if reason and reason[-1] not in ".!?":
        reason += "."
    labels, actions = _fixed(t)
    return {
        "key": "focal_suggestion",
        "focus": "unseen",
        "element": t.get("element"),
        "principle": t["principle"],
        "question": _clean(Template(t["question"]).safe_substitute(label=label.strip(), reason=reason)),
        "options": labels,
        "option_actions": actions,
    }


def mark_meaning_prompt(question: str, readings: list[dict], obj: dict, focus: str) -> dict:
    """Seeing as, for one object: the AI's two readings, each with its
    element and a short name (used as {A} or {B} later)."""
    return _answer_by_tap({
        "key": "mark_meaning",
        "focus": focus,
        "shape_id": obj["shape_id"],
        "question": _clean(question) or load_bank()["mark_meaning"]["questions"][0],
        "options": [r["text"] for r in readings],
        "option_elements": [r["element"] for r in readings],
        "option_names": [r["name"] for r in readings],
        "option_actions": [None] * len(readings),
        "mark_ids": list(obj["mark_ids"]),
    })


def relationship_prompt(conn: dict, objects: dict, focus: str) -> dict:
    """
    Seeing that, for one pair (or one lone object). Options are relationship
    types in the AI's wording, with {A} and {B} left in: the app fills them
    with the sketcher's own names from mark_meaning (name_refs).
    """
    refs = conn["refs"]
    types = [o["type"] for o in conn["options"]]
    names = {k: objects[sid]["name"] for k, sid in zip("AB", refs)}
    mark_ids = [m for sid in refs for m in objects[sid]["mark_ids"]]
    return _answer_by_tap({
        "key": "relationship",
        "focus": focus,
        "question": _clean(conn["question"]),
        "options": [o["text"] for o in conn["options"]],
        "option_types": types,
        "option_elements": [type_info(t)["element"] for t in types],
        "option_principles": [type_info(t)["principle"] for t in types],
        "option_actions": [None] * len(types),
        "name_refs": dict(zip("AB", refs)),
        "default_names": names,
        "mark_ids": mark_ids,
    })


def principle_prompt(conn: dict, objects: dict, focus: str) -> dict:
    """
    What to bring out, after one relationship question. One variant per type
    offered there, plus "other" for an answer by tap or in the sketcher's own
    words. The app shows the variant for the type the sketcher picked
    (after_relationship points at the relationship question by its refs).
    """
    refs = conn["refs"]
    variants = {}
    for vtype, step in conn["principle_steps"].items():
        element = type_info(vtype)["element"] if vtype != "other" else step["element"]
        variants[vtype] = {
            "question": _clean(step["question"]),
            "options": [o["text"] for o in step["options"]],
            "option_principles": [o["principle"] for o in step["options"]],
            "option_elements": [element] * len(step["options"]),
        }
    return _answer_by_tap({
        "key": "principle_intent",
        "focus": focus,
        "question": "",
        "options": [],
        "after_relationship": list(refs),
        "variants": variants,
        "name_refs": dict(zip("AB", refs)),
        "default_names": {k: objects[sid]["name"] for k, sid in zip("AB", refs)},
        "max_principles": max_principles(),
        "mark_ids": [m for sid in refs for m in objects[sid]["mark_ids"]],
    })


def unseen_prompt(question: str, element: str | None, principle: str) -> dict:
    t = load_bank()["unseen"]
    labels, actions = _fixed(t)
    return {
        "key": "unseen",
        "focus": "unseen",
        "element": element,
        "principle": principle,
        "question": _clean(question) or t["question"],
        "options": labels,
        "option_actions": actions,
    }


load_bank()  # check at startup
