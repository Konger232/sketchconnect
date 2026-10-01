"""
Loads and checks question_bank.json, the guided question bank for the
scene analysis call (design doc, Section 11, items 12 and 13), including
the focal_suggestion template the app fills in for each missed focal area,
and the relationship kinds Gemini picks from (design doc, item 17).

The bank is data, so it lives in JSON. The prompt prose lives in
prompts/*.md. This file only loads, checks and formats the bank.

Like prompt_loader.py, the file is re-read whenever it changes on disk,
so an edit to the JSON applies on the next call without a restart. Every
load is checked. A broken bank raises ValueError, so a typo fails loudly
instead of sending Gemini a half-empty question list. The first load
happens at import, so a broken bank also stops the server at startup.
"""
import json
import re
from pathlib import Path
from string import Template

from config import SCENE_TYPES, STYLES

BANK_PATH = Path(__file__).parent / "question_bank.json"
MIN_OPTIONS, MAX_OPTIONS = 2, 4

_cache: tuple[float, dict] | None = None


def _option_problems(where: str, opts, actions: set[str], lo: int, hi: int) -> list[str]:
    """Each option is {"label": str, "action": optional name from 'actions'}."""
    if not isinstance(opts, list) or not (lo <= len(opts) <= hi):
        return [f"{where}: needs {lo}-{hi} options"]
    problems = []
    for i, o in enumerate(opts, 1):
        if not isinstance(o, dict) or not isinstance(o.get("label"), str) or not o["label"].strip():
            problems.append(f"{where}: option {i} needs a non-empty label")
        elif "action" in o and o["action"] not in actions:
            problems.append(f"{where}: option {i} has unknown action {o['action']!r} (see 'actions')")
    return problems


def _check(bank: dict) -> None:
    problems = []
    principles = set(bank.get("principles", []))
    actions = set(bank.get("actions", {}))
    questions = bank.get("questions", {})
    scene_types = bank.get("scene_types", {})

    suggestion = bank.get("focal_suggestion")
    if not isinstance(suggestion, dict):
        problems.append("focal_suggestion is missing")
    else:
        text = suggestion.get("question", "")
        for var in ("$label", "$reason"):
            if var not in text:
                problems.append(f"focal_suggestion: question must contain {var}")
        problems += _option_problems("focal_suggestion", suggestion.get("options"), actions, 2, 3)
        if suggestion.get("principle") not in principles:
            problems.append("focal_suggestion: principle is not in 'principles'")

    meaning = bank.get("mark_meaning")
    if not isinstance(meaning, dict):
        problems.append("mark_meaning is missing")
    else:
        if not isinstance(meaning.get("question"), str) or not meaning["question"].strip():
            problems.append("mark_meaning: missing question text")
        problems += _option_problems("mark_meaning", meaning.get("options"), actions, 3, 3)
        opts = meaning.get("options") or []
        if opts and isinstance(opts[-1], dict) and opts[-1].get("action") != "describe":
            problems.append("mark_meaning: the last option must have the action 'describe'")
        if meaning.get("principle") not in principles:
            problems.append("mark_meaning: principle is not in 'principles'")

    rel = bank.get("relationship")
    if not isinstance(rel, dict):
        problems.append("relationship is missing")
    else:
        if not isinstance(rel.get("question"), str) or not rel["question"].strip():
            problems.append("relationship: missing question text")
        problems += _option_problems("relationship", rel.get("options"), actions, 2, 3)
        if rel.get("principle") not in principles:
            problems.append("relationship: principle is not in 'principles'")
        kinds = rel.get("kinds")
        if not isinstance(kinds, dict) or not kinds:
            problems.append("relationship: needs at least one entry in 'kinds'")
        else:
            for name, k in kinds.items():
                if not isinstance(k, dict):
                    problems.append(f"relationship.kinds.{name}: must be an object")
                    continue
                if k.get("principle") not in principles:
                    problems.append(f"relationship.kinds.{name}: principle {k.get('principle')!r} is not in 'principles'")
                for field in ("looks_for", "example"):
                    if not isinstance(k.get(field), str) or not k[field].strip():
                        problems.append(f"relationship.kinds.{name}: missing {field}")

    for key, q in questions.items():
        if q.get("principle") not in principles:
            problems.append(f"{key}: principle {q.get('principle')!r} is not in 'principles'")
        if not isinstance(q.get("question"), str) or not q["question"].strip():
            problems.append(f"{key}: missing question text")
        problems += _option_problems(key, q.get("options"), actions, MIN_OPTIONS, MAX_OPTIONS)

    for style, swaps in bank.get("style_actions", {}).items():
        if style not in STYLES:
            problems.append(f"style_actions: unknown style {style!r} (see config.STYLES)")
        for a, b in (swaps or {}).items():
            if a not in actions or b not in actions:
                problems.append(f"style_actions.{style}: {a!r} -> {b!r} uses an unknown action")

    missing = set(SCENE_TYPES) - set(scene_types)
    extra = set(scene_types) - set(SCENE_TYPES)
    if missing:
        problems.append(f"scene_types is missing {sorted(missing)}")
    if extra:
        problems.append(f"scene_types has unknown {sorted(extra)} (see config.SCENE_TYPES)")
    for scene_type, keys in scene_types.items():
        for key in keys:
            if key not in questions:
                problems.append(f"scene_types.{scene_type}: unknown question {key!r}")
        if len(keys) != len(set(keys)):
            problems.append(f"scene_types.{scene_type}: a question is listed twice")

    if problems:
        raise ValueError("question_bank.json is invalid:\n  " + "\n  ".join(problems))

    used = {k for keys in scene_types.values() for k in keys}
    for key in sorted(set(questions) - used):
        print(f"[question_bank] note: {key!r} is not used by any scene type")


def load_bank() -> dict:
    global _cache
    mtime = BANK_PATH.stat().st_mtime
    if _cache and _cache[0] == mtime:
        return _cache[1]
    bank = json.loads(BANK_PATH.read_text(encoding="utf-8"))
    _check(bank)
    _cache = (mtime, bank)
    return bank


def all_keys() -> list[str]:
    """Every question key. Used as the enum in the response schema."""
    return sorted(load_bank()["questions"])


def eligible_keys(scene_type: str) -> list[str]:
    return load_bank()["scene_types"].get(scene_type, [])


def option_actions(key: str, style: str | None = None) -> list[str | None]:
    """
    The action (or None) for each of a question's options, in order, after
    the style's swaps in style_actions (e.g. realistic: rule_of_thirds -> grid).
    """
    bank = load_bank()
    q = bank["questions"].get(key)
    if not q:
        return []
    swaps = bank.get("style_actions", {}).get(style or "", {})
    return [swaps.get(o.get("action"), o.get("action")) for o in q["options"]]


def grid_action(style: str | None) -> str:
    """Which grid the guidance shows by default for this style."""
    return load_bank().get("style_actions", {}).get(style or "", {}).get("rule_of_thirds", "rule_of_thirds")


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z]+", (text or "").lower())) - {"the", "a", "an", "it", "and", "as", "you", "go", "for", "of"}


def _match_by_words(options: list[str], bank_labels: list[str], actions: list[str | None]) -> list[str | None]:
    """
    Gemini changed the option count, so positions can't be trusted. Give
    each returned option the action of the bank option it shares the most
    words with, when it shares at least half of that bank option's words.
    """
    matched = []
    for opt in options:
        words = _words(opt)
        best, best_score = None, 0.0
        for label, action in zip(bank_labels, actions):
            bank_words = _words(label)
            score = len(words & bank_words) / len(bank_words) if bank_words else 0.0
            if score > best_score:
                best, best_score = action, score
        matched.append(best if best_score >= 0.5 else None)
    return matched


def attach_option_actions(
    prompts: list[dict],
    style: str | None = None,
    available: dict[str, bool] | None = None,
) -> list[dict]:
    """
    Adds option_actions to each prepared prompt, matched to Gemini's
    reworded options by position. Gemini is told to keep the options' order
    and count. If the count still differs, options are matched to the bank
    by shared words instead (_match_by_words).

    `available` says which overlays have data for this photo (e.g.
    {"proportions": False} when no unit came back). A question whose overlay
    has nothing to draw is dropped, so "Check proportions first" never
    leads to an empty photo.
    """
    bank = load_bank()
    out = []
    for p in prompts:
        if p.get("key") == "relationship":
            # Fixed yes/no options from the bank, so a bank edit applies to cached results too.
            t = bank["relationship"]["options"]
            out.append({**p, "options": [o["label"] for o in t], "option_actions": [o.get("action") for o in t]})
            continue
        if p.get("suggestion") or p.get("key") == "mark_meaning":  # filled from their own templates
            out.append(p)
            continue
        key = p.get("key", "")
        actions = option_actions(key, style)
        if available and any(a and available.get(a) is False for a in actions):
            print(f"[question_bank] {key}: its overlay has no data for this photo; question dropped")
            continue
        options = p.get("options") or []
        if len(actions) != len(options):
            if any(actions):
                labels = [o["label"] for o in bank["questions"].get(key, {}).get("options", [])]
                actions = _match_by_words(options, labels, actions)
                print(f"[question_bank] {key}: {len(options)} options back, "
                      f"{len(labels)} in the bank; matched by wording: {actions}")
            else:
                actions = [None] * len(options)
        out.append({**p, "option_actions": actions})
    return out


def overlay_data(result: dict) -> dict[str, bool]:
    """Which data-backed overlays this analysis result can draw."""
    return {
        "proportions": bool((result.get("proportions") or {}).get("unit")),
        "perspective": bool(result.get("perspective")),
        "focal_shapes": bool(result.get("focal_regions")),
    }


def focal_suggestion_prompt(label: str, reason: str | None) -> dict:
    """
    The "There is the ... here" question for one missed focal area, filled from
    the focal_suggestion template. Options stay as written: the frontend
    treats the first one as "add it".
    """
    t = load_bank()["focal_suggestion"]
    reason = (reason or "").strip()
    if reason and reason[-1] not in ".!?":
        reason += "."
    question = Template(t["question"]).safe_substitute(label=label.strip(), reason=reason)
    return {
        "key": "focal_suggestion",
        "question": re.sub(r"\s{2,}", " ", question).strip(),
        "options": [o["label"] for o in t["options"]],
        "option_actions": [o.get("action") for o in t["options"]],
    }


def mark_meaning_prompt(question: str, options: list[str], mark_ids: list[str]) -> dict:
    """
    "What do you see these marks as?" for one selected shape (design doc,
    item 17). Gemini wrote the question and the first two options; the
    last option comes from the mark_meaning template and lets the sketcher
    type their own answer (action "describe").
    """
    t = load_bank()["mark_meaning"]
    fixed = t["options"][-1]
    return {
        "key": "mark_meaning",
        "focus": "selected",
        "question": re.sub(r"\s{2,}", " ", question).strip() or t["question"],
        "options": [o.strip() for o in options] + [fixed["label"]],
        "option_actions": [None] * len(options) + [fixed.get("action")],
        "mark_ids": list(mark_ids),
    }


def relationship_kinds() -> list[str]:
    """Every relationship kind. Used as the enum in the response schema."""
    return list(load_bank()["relationship"]["kinds"])


def relationship_prompt(question: str, kind: str,
                        subjects: list[str], mark_ids: list[str], focus: str) -> dict:
    """
    The one question about how two or more marked subjects connect
    (design doc, item 17). Gemini wrote the question, a yes/no check; the
    options are the template's fixed Yes and No. The kind
    and its principle travel with the question, so the saved answer
    carries them to the critique.
    """
    t = load_bank()["relationship"]
    return {
        "key": "relationship",
        "focus": focus,
        "question": re.sub(r"\s{2,}", " ", question).strip() or t["question"],
        "options": [o["label"] for o in t["options"]],
        "option_actions": [o.get("action") for o in t["options"]],
        "mark_ids": list(mark_ids),
        "relationship": {
            "kind": kind,
            "principle": t["kinds"][kind]["principle"],
            "subjects": [s.strip() for s in subjects if s.strip()],
        },
    }


def render_relationship_kinds() -> str:
    """The relationship kinds as prompt text, one line each."""
    kinds = load_bank()["relationship"]["kinds"]
    return "\n".join(
        f'- {name} ({k["principle"]}): {k["looks_for"]}. Example: {k["example"]}.'
        for name, k in kinds.items()
    )


def render_guide() -> str:
    """
    The bank as prompt text, grouped by scene type. The scene type isn't
    known until Gemini classifies the photo in the same call, so every
    scene type's questions go in; Gemini picks from the matching list.
    """
    bank = load_bank()
    lines = []
    for scene_type in SCENE_TYPES:
        lines.append(f"- {scene_type}:")
        for key in bank["scene_types"].get(scene_type, []):
            q = bank["questions"][key]
            labels = [o["label"] for o in q["options"]]
            shows = [
                f'option {i} shows the {o["action"].replace("_", " ")} overlay'
                for i, o in enumerate(q["options"], 1) if o.get("action")
            ]
            lines.append(
                f'  - {key} ({q["principle"]}): "{q["question"]}" options: {json.dumps(labels)}'
                + (f' ({"; ".join(shows)})' if shows else "")
            )
    return "\n".join(lines)


load_bank()  # check at startup
