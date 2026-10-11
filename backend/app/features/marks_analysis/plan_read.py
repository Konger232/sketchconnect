"""
Plan read (design doc, Section 11, item 25). The sketcher plans with
strokes; the marks analysis call reads the plan back: every principle in a
group (strong, moderate, none), with its strokes, elements, a why and
tips, and relationships inside the principles they belong to. This module
holds the media picks and the checks on Gemini's answer (clean). The call
itself, the prompt and the cache are in service.py.
"""
import copy
import re

from app.core import design_fundamentals as df
from app.features.marks_analysis import question_bank

GROUPS = ["strong", "moderate", "none"]
# At most this many strong: Gemini's strongest. The rest become moderate.
MAX_STRONG = 3
# Relationships under one principle; no cap across the scene.
MAX_RELATIONSHIPS_PER_PRINCIPLE = 2
MAX_TIPS = 2
# Word limits (item 25, "Tips"). Over them, a tip is dropped.
TIP_NAME_WORDS = 3
TIP_WORDS = 10
WHY_WORDS = 12
# Two tips repeat each other when half or more of their words are shared.
REPEAT_OVERLAP = 0.5

# The media card (item 25). A tip may name only what the sketcher picked.
MEDIA = {
    "line": {"fineliner": "waterproof fineliner", "fountain_pen": "fountain pen", "pencil": "pencil"},
    "color": {"watercolor": "watercolor", "gouache": "gouache", "markers": "markers",
              "watercolor_pencils": "watercolor pencils", "pastels": "pastels"},
}
MEDIA_NAMES = {k: v for group in MEDIA.values() for k, v in group.items()}
TOOL_WORDS = {"ink", "pen", "pens", "marker", "markers", "brush", "brushes", "pencil", "pencils",
              "fineliner", "fineliners", "watercolor", "watercolors", "watercolour", "watercolours",
              "gouache", "pastel", "pastels", "crayon", "crayons", "charcoal"}

_WORD = re.compile(r"[a-z]+")
_ID_IN_TEXT = re.compile(r"\b[ms]\d+\b", re.IGNORECASE)


def clean_media(picks) -> list[str]:
    """Known media keys, in the card's order, each once."""
    wanted = set(picks or [])
    return [k for k in MEDIA_NAMES if k in wanted]


def media_text(media: list[str]) -> str:
    """The media line in the prompt."""
    if not media:
        return "The sketcher has not said what they draw with. Do not name any tool or medium."
    names = ", ".join(MEDIA_NAMES[k] for k in media)
    return (f"The sketcher draws with: {names}. Name a medium only when the technique depends on "
            "it (a wash, a dry edge, pressing harder with a pen), and in at most one tip per "
            "principle. Most tips name no medium. Never name a tool or medium not listed.")


def _words(text: str) -> int:
    return len((text or "").split())


def _tools_named(text: str) -> set[str]:
    return {w for w in _WORD.findall((text or "").lower()) if w in TOOL_WORDS}


def _text(v) -> str:
    t = v.strip() if isinstance(v, str) else ""
    return "" if _ID_IN_TEXT.search(t) else t


def clean(raw: dict | None, visible: set[str], media: list[str], stroke_order: list[str],
          area_list: list[list[str]] | None = None) -> dict:
    """
    Gemini's plan read, checked (item 25, "Checks in FastAPI"):
      - all 8 principles, each once; a missing one is added as none
      - known strokes only; strong or moderate with no strokes moves to none
      - at most MAX_STRONG strong, Gemini's strongest
      - in Gemini's order (its read of strength), a principle whose strokes
        are all used by one ranked above it moves to none
      - an element weak or skipped for its principle switches to one the
        matrix marks strong or medium on that principle
      - tips: no medium the sketcher did not pick, within the word limits,
        a medium named in one tip at most per principle
      - relationships: under their type's principle, only when it is strong
        or moderate, at most MAX_RELATIONSHIPS_PER_PRINCIPLE each, a tip that
        repeats the principle's tip is dropped
      - order: strong, then moderate, each by the earliest stroke in its
        strokes' areas, Gemini's order breaking ties; none in Gemini's order
    """
    raw = raw if isinstance(raw, dict) else {}
    allowed = {w + s for k in media for w in MEDIA_NAMES[k].lower().split() for s in ("", "s")}
    pos = {m: i for i, m in enumerate(stroke_order)}
    lead = dict(pos)
    for a in area_list or []:
        lo = min(pos.get(m, 10 ** 6) for m in a)
        for m in a:
            lead[m] = lo
    keys = df.principle_keys()

    def ok_tip(t) -> dict | None:
        if not isinstance(t, dict):
            return None
        name, tip = _text(t.get("name")), _text(t.get("tip"))
        if not name or not tip or _words(name) > TIP_NAME_WORDS or _words(tip) > TIP_WORDS:
            return None
        if _tools_named(f"{name} {tip}") - allowed:
            return None
        return {"name": name, "tip": tip}

    # One entry per principle, in Gemini's order.
    principles, seen = [], set()
    for p in raw.get("principles") or []:
        if not isinstance(p, dict) or p.get("principle") not in keys or p["principle"] in seen:
            continue
        seen.add(p["principle"])
        principles.append(copy.deepcopy(p))
    for k in keys:
        if k not in seen:
            principles.append({"principle": k, "group": "none", "tips": []})
    gem = {p["principle"]: n for n, p in enumerate(principles)}

    def to_none(p):
        p.update(group="none", mark_ids=[], elements=[], why="")

    for p in principles:
        if p.get("group") not in GROUPS:
            p["group"] = "none"
        p["mark_ids"] = list(dict.fromkeys(i for i in p.get("mark_ids") or [] if i in visible))
        if p["group"] != "none" and not p["mark_ids"]:
            to_none(p)
        good = [e for e in df.element_keys() if (df.cell(e, p["principle"]) or {}).get("strength") in ("strong", "medium")]
        els = [e for e in p.get("elements") or [] if e in good]
        if p["group"] != "none" and not els and good:
            els = [good[0]]
        p["elements"] = els if p["group"] != "none" else []
        p["why"] = _text(p.get("why")) if p["group"] != "none" and _words(p.get("why")) <= WHY_WORDS else ""
        tips, named = [], False
        for t in p.get("tips") or []:
            t = ok_tip(t)
            if not t:
                continue
            has = bool(_tools_named(f"{t['name']} {t['tip']}"))
            if has and named:
                continue
            named = named or has
            tips.append(t)
        p["tips"] = tips[:1] if p["group"] == "none" else tips[:MAX_TIPS]

    # Which stand: Gemini's order decides.
    principles.sort(key=lambda p: (GROUPS.index(p["group"]), gem[p["principle"]]))
    for p in [p for p in principles if p["group"] == "strong"][MAX_STRONG:]:
        p["group"] = "moderate"
    principles.sort(key=lambda p: (GROUPS.index(p["group"]), gem[p["principle"]]))
    used = set()
    for p in principles:
        if p["group"] == "none":
            continue
        if set(p["mark_ids"]) <= used:
            to_none(p)
            p["tips"] = p["tips"][:1]
        else:
            used |= set(p["mark_ids"])

    # Which leads: stroke order, by area.
    def first(p):
        return min((lead[i] for i in p["mark_ids"] if i in lead), default=10 ** 6)

    principles.sort(key=lambda p: (GROUPS.index(p["group"]), first(p) if p["group"] != "none" else 0, gem[p["principle"]]))

    shown = {p["principle"]: p for p in principles if p["group"] != "none"}
    types = question_bank.load_bank()["relationship"]["types"]
    relationships, per = [], {}
    for r in raw.get("relationships") or []:
        if not isinstance(r, dict) or r.get("type") not in types:
            continue
        home = types[r["type"]]["principle"]  # a relationship sits under its type's principle
        p = shown.get(home)
        if not p or per.get(home, 0) >= MAX_RELATIONSHIPS_PER_PRINCIPLE:
            continue
        own = [set(_WORD.findall(t["tip"].lower())) for t in p["tips"]]

        def repeats(t):
            w = set(_WORD.findall(t["tip"].lower()))
            return any(len(w & o) / max(1, len(w | o)) >= REPEAT_OVERLAP for o in own)

        tips = [t for t in (ok_tip(t) for t in r.get("tips") or []) if t and not repeats(t)][:1]
        if not tips:
            continue
        per[home] = per.get(home, 0) + 1
        relationships.append({
            "type": r["type"],
            "principle": home,
            "objects": [o for o in (_text(o) for o in r.get("objects") or []) if o][:3],
            "mark_ids": list(dict.fromkeys(i for i in r.get("mark_ids") or [] if i in visible)),
            "why": _text(r.get("why")) if _words(r.get("why")) <= WHY_WORDS else "",
            "tips": tips,
        })

    return {
        "principles": [{k: p.get(k) for k in ("principle", "group", "mark_ids", "elements", "why", "tips")}
                       for p in principles],
        "relationships": relationships,
    }
