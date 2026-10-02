"""
Loads and checks design_fundamentals.json: the elements and principles
from the UC Berkeley design guide (guides.lib.berkeley.edu/design), and
the matrix of which element and principle pairs a sketcher can work with
through marks (design doc, Section 11, item 20; "Elements × Principles
Matrix" doc).

Elements are what a mark is made of. Principles are what marks do
together. matrix[element][principle] is a pair the sketcher can work with.
A pair left out of the matrix is skipped. Strong pairs get seed questions
in the marks analysis question bank. Weak pairs are used only when the AI
sees them clearly.

Shared by the marks analysis call and the critique agent call. Like the
question banks, the file is re-read whenever it changes on disk, and every
load is checked. A broken file raises ValueError at startup.
"""
import json
from pathlib import Path

PATH = Path(__file__).parent / "design_fundamentals.json"
STRENGTHS = ("strong", "weak")

_cache: tuple[float, dict] | None = None


def _check(data: dict) -> None:
    problems = []
    elements = data.get("elements")
    principles = data.get("principles")
    matrix = data.get("matrix")
    if not isinstance(elements, dict) or not elements:
        problems.append("elements is missing")
        elements = {}
    if not isinstance(principles, dict) or not principles:
        problems.append("principles is missing")
        principles = {}
    if not isinstance(matrix, dict):
        problems.append("matrix is missing")
        matrix = {}

    for key, e in elements.items():
        if not isinstance(e, dict) or not str(e.get("definition", "")).strip():
            problems.append(f"elements.{key}: missing definition")
        elif not isinstance(e.get("from_marks"), bool):
            problems.append(f"elements.{key}: from_marks must be true or false")
    for key, p in principles.items():
        if not isinstance(p, dict) or not str(p.get("definition", "")).strip():
            problems.append(f"principles.{key}: missing definition")

    for element, row in matrix.items():
        if element not in elements:
            problems.append(f"matrix.{element}: not an element")
            continue
        if not elements[element].get("from_marks"):
            problems.append(f"matrix.{element}: element is not read from marks (from_marks is false)")
        if not isinstance(row, dict):
            problems.append(f"matrix.{element}: must be an object")
            continue
        for principle, cell in row.items():
            where = f"matrix.{element}.{principle}"
            if principle not in principles:
                problems.append(f"{where}: not a principle")
            if not isinstance(cell, dict):
                problems.append(f"{where}: must be an object")
                continue
            if cell.get("strength") not in STRENGTHS:
                problems.append(f"{where}: strength must be one of {STRENGTHS}")
            if not str(cell.get("looks_for", "")).strip():
                problems.append(f"{where}: missing looks_for")
    for element, e in elements.items():
        if e.get("from_marks") and element not in matrix:
            problems.append(f"elements.{element}: read from marks but has no matrix row")

    if problems:
        raise ValueError("design_fundamentals.json is invalid:\n  " + "\n  ".join(problems))


def load() -> dict:
    global _cache
    mtime = PATH.stat().st_mtime
    if _cache and _cache[0] == mtime:
        return _cache[1]
    data = json.loads(PATH.read_text(encoding="utf-8"))
    _check(data)
    _cache = (mtime, data)
    return data


def element_keys(from_marks: bool | None = None) -> list[str]:
    """Element keys in file order. from_marks=True: only those read from marks."""
    els = load()["elements"]
    return [k for k, e in els.items() if from_marks is None or e["from_marks"] == from_marks]


def principle_keys() -> list[str]:
    return list(load()["principles"])


def principle_label(key: str) -> str:
    p = load()["principles"].get(key, {})
    return p.get("label") or key.replace("_", " ").capitalize()


def cell(element: str | None, principle: str) -> dict | None:
    """The matrix cell for a pair, or None when the pair is skipped."""
    return (load()["matrix"].get(element or "") or {}).get(principle)


def row(element: str) -> list[str]:
    """The principles an element can work toward, strong pairs first, in file order."""
    cells = load()["matrix"].get(element) or {}
    return sorted(cells, key=lambda p: cells[p]["strength"] != "strong")


def render_text() -> str:
    """Definitions and the matrix as prompt text. Static between edits, so it
    sits in the cached opening of the prompt."""
    data = load()
    lines = ["Elements (what a mark is made of):"]
    for k, e in data["elements"].items():
        note = "" if e["from_marks"] else " Not read from marks: photo and final sketch only."
        lines.append(f"- {k}: {e['definition']}{note}")
    lines.append("Principles (what marks do together):")
    for k, p in data["principles"].items():
        lines.append(f"- {k}: {p['definition']}")
    lines.append("Matrix (element > principle: what to look for in the marks). "
                 "A pair not listed is skipped. Use weak pairs only when you see them clearly:")
    for element, cells in data["matrix"].items():
        for principle, c in cells.items():
            lines.append(f"- {element} > {principle} ({c['strength']}): {c['looks_for']}")
    return "\n".join(lines)


load()  # check at startup
