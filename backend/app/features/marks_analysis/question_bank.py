"""
Loads and checks question_bank.json, the guided question bank for the
marks analysis call (design doc, Section 11, item 20). Element and
principle keys come from app/core/design_fundamentals.json.

The bank is data, so it lives in JSON. The prompt prose lives in
prompts/*.md. This file only loads, checks and formats the bank. The
scene analysis call keeps its own bank (features/scene_analysis/) during
the parallel run.

Like the other banks, the file is re-read whenever it changes on disk,
and every load is checked against the rules in the "Elements × Principles
Matrix" doc:
  - Every element and principle key exists in design_fundamentals.json.
  - Every mark_questions key is <element>_<principle>, and the pair is a
    matrix cell.
  - A mark_questions element has from_marks: true.
  - Every relationship type's principle is a principle. Its element is an
    element or null.
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


def _check(bank: dict) -> None:
    problems = []
    elements = set(df.element_keys())
    mark_elements = set(df.element_keys(from_marks=True))
    principles = set(df.principle_keys())
    actions = set(bank.get("actions") or {})
    undecided = {}  # section -> count of undecided_principle options

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
        if not _text(mm.get("question")):
            problems.append("mark_meaning: missing question text")
        opts("mark_meaning", mm.get("options"), 2, 2)
        opts("mark_meaning.fixed_options", mm.get("fixed_options"), 1, 1)
        fixed = (mm.get("fixed_options") or [{}])[-1]
        if isinstance(fixed, dict) and fixed.get("action") != "describe":
            problems.append("mark_meaning: the fixed option must have the action 'describe'")

    pi = bank.get("principle_intent")
    if not isinstance(pi, dict):
        problems.append("principle_intent is missing")
    else:
        if not _text(pi.get("question")):
            problems.append("principle_intent: missing question text")
        mp = pi.get("max_principles")
        if not isinstance(mp, int) or isinstance(mp, bool) or not 1 <= mp <= 3:
            problems.append("principle_intent: max_principles must be between 1 and 3")
        if not isinstance(pi.get("multi_select"), bool):
            problems.append("principle_intent: multi_select must be true or false")
        opts("principle_intent", pi.get("fixed_options"), 1, 1)
        if undecided.get("principle_intent") != 1:
            problems.append("principle_intent: its fixed option must be the one undecided_principle option")

    rel = bank.get("relationship")
    if not isinstance(rel, dict):
        problems.append("relationship is missing")
    else:
        if not _text(rel.get("question")):
            problems.append("relationship: missing question text")
        opts("relationship", rel.get("fixed_options"), 2, 2)
        types = rel.get("types")
        if "kinds" in rel:
            problems.append("relationship: 'kinds' is renamed 'types'")
        if not isinstance(types, dict) or not types:
            problems.append("relationship: needs at least one entry in 'types'")
        else:
            for name, t in types.items():
                where = f"relationship.types.{name}"
                if not isinstance(t, dict):
                    problems.append(f"{where}: must be an object")
                    continue
                element_ok(where, t.get("element"))
                principle_ok(where, t.get("principle"))
                for field in ("looks_for", "example"):
                    if not _text(t.get(field)):
                        problems.append(f"{where}: missing {field}")

    mq = bank.get("mark_questions")
    if not isinstance(mq, dict) or not mq:
        problems.append("mark_questions is missing")
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

    seeded = {q["principle"] for q in mq.values()}
    for p in sorted(principles - seeded):
        print(f"[marks question_bank] note: principle {p!r} has no seed question")
    for key, q in mq.items():
        if df.cell(q["element"], q["principle"])["strength"] != "strong":
            print(f"[marks question_bank] note: {key} is on a weak pair")


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


def relationship_types() -> list[str]:
    return list(load_bank()["relationship"]["types"])


def mark_question_keys() -> list[str]:
    return list(load_bank()["mark_questions"])


def seeds_for(principle: str) -> list[str]:
    """mark_questions keys for a principle, in bank order."""
    return [k for k, q in load_bank()["mark_questions"].items() if q["principle"] == principle]


def repeated_keys() -> set[str]:
    """Keys asked more than once per sketch (per shape, area or form), so
    the question text tells their answers apart (sketches/router.py)."""
    return {"mark_meaning", "principle_intent", "focal_suggestion", "unseen", *mark_question_keys()}


# ---------- prompt text ----------

def render_bank() -> str:
    """The bank sections Gemini writes for, as prompt text. Static between edits."""
    bank = load_bank()
    lines = ["Seed questions (mark_questions), one per key. Keep the option count and order:"]
    for key, q in bank["mark_questions"].items():
        labels = [o["label"] for o in q["options"]]
        shows = [f'option {i} {o["action"]}' for i, o in enumerate(q["options"], 1) if o.get("action")]
        lines.append(
            f'- {key} (needs {q["min_marks"]}+ marks): "{q["question"]}" options: {json.dumps(labels)}'
            + (f' ({"; ".join(shows)})' if shows else "")
        )
    lines.append(f'Seeing as (mark_meaning): "{bank["mark_meaning"]["question"]}"')
    lines.append(f'Seeing that (principle_intent): "{bank["principle_intent"]["question"]}"')
    lines.append(f'Unseen: "{bank["unseen"]["question"]}"')
    return "\n".join(lines)


def render_relationship_types() -> str:
    types = load_bank()["relationship"]["types"]
    return "\n".join(
        f'- {name} ({t["element"] or "no element"} > {t["principle"]}): {t["looks_for"]}. Example: {t["example"]}.'
        for name, t in types.items()
    )


# ---------- prepared prompts ----------

def _clean(text: str) -> str:
    return re.sub(r"\s{2,}", " ", (text or "")).strip()


def _fixed(section: dict) -> tuple[list[str], list]:
    fixed = section.get("fixed_options") or []
    return [o["label"] for o in fixed], [o.get("action") for o in fixed]


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


def relationship_prompt(question: str, rtype: str, subjects: list[str], mark_ids: list[str], focus: str) -> dict:
    t = load_bank()["relationship"]
    labels, actions = _fixed(t)
    info = t["types"][rtype]
    return {
        "key": "relationship",
        "focus": focus,
        "element": info["element"],
        "principle": info["principle"],
        "question": _clean(question) or t["question"],
        "options": labels,
        "option_actions": actions,
        "mark_ids": list(mark_ids),
        # "kind" is kept beside "type" while scene analysis and the
        # critique prompt still read it (parallel run).
        "relationship": {"type": rtype, "kind": rtype, "element": info["element"],
                         "principle": info["principle"], "subjects": subjects},
    }


def mark_meaning_prompt(question: str, readings: list[str], shape_id: str, mark_ids: list[str], focus: str) -> dict:
    t = load_bank()["mark_meaning"]
    labels, actions = _fixed(t)
    return {
        "key": "mark_meaning",
        "focus": focus,
        "shape_id": shape_id,
        "question": _clean(question) or t["question"],
        "options": [r.strip() for r in readings] + labels,
        "option_actions": [None] * len(readings) + actions,
        "mark_ids": list(mark_ids),
    }


def principle_intent_prompt(question: str, element: str, principles: list[str],
                            shape_id: str, mark_ids: list[str], focus: str) -> dict:
    """
    "What do you want these marks to do?" One option per offered principle,
    then the fixed "Not sure yet". One tap picks one and moves on
    (multi_select false in the bank). option_principles is
    parallel to options (None for "Not sure yet"); option_hints gives each
    principle's "what to look for" from the matrix cell.
    """
    t = load_bank()["principle_intent"]
    labels, actions = _fixed(t)
    undecided = next(i for i, o in enumerate(t["fixed_options"]) if o.get("undecided_principle"))
    return {
        "key": "principle_intent",
        "focus": focus,
        "element": element,
        "shape_id": shape_id,
        "question": _clean(question) or t["question"],
        "options": [df.principle_label(p) for p in principles] + labels,
        "option_actions": [None] * len(principles) + actions,
        "option_principles": list(principles) + [None] * len(labels),
        "option_hints": [df.cell(element, p)["looks_for"] for p in principles] + [None] * len(labels),
        "undecided_option": len(principles) + undecided,
        "multi_select": t["multi_select"],
        "max_principles": t["max_principles"],
        "mark_ids": list(mark_ids),
    }


def mark_question_prompt(key: str, question: str, options: list[str], shape_id: str | None,
                         mark_ids: list[str], focus: str) -> dict:
    """
    A seed question for one chosen principle. Asked only when the sketcher
    picked that principle for these marks (requires_principle): the app
    skips it otherwise. Gemini's option wording is used only when it kept
    the bank's option count, so each option keeps its action.
    """
    q = load_bank()["mark_questions"][key]
    bank_labels = [o["label"] for o in q["options"]]
    labels = [o.strip() for o in options] if len(options) == len(bank_labels) and all(_text(o) for o in options) else bank_labels
    return {
        "key": key,
        "focus": focus,
        "element": q["element"],
        "principle": q["principle"],
        "requires_principle": q["principle"],
        "shape_id": shape_id,
        "question": _clean(question) or q["question"],
        "options": labels,
        "option_actions": [o.get("action") for o in q["options"]],
        "mark_ids": list(mark_ids),
    }


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
