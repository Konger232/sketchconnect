"""
Pydantic shapes shared by more than one feature. Feature-specific request
and response models live in each feature's own schemas.py. Keep these in
sync with gemini_call_schemas.md.
"""
from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel, Field


Style = Literal["ink_and_wash", "realistic", "minimalist", "reportage"]
SceneType = Literal[
    "architectural", "still_life_organic", "figure", "open_landscape", "mixed"
]


# Scene analysis focal region; also read by sketches (focal-point pairing).
class FocalRegion(BaseModel):
    label: str
    # Flat (x, y) pairs -- [x1, y1, x2, y2, ...] -- tracing the object's
    # actual visible outline, 0-1000 scale. Replaced the old rectangular
    # bounding_box after a real-world test (see parking-lot.md) showed
    # Gemini can trace a reasonable silhouette, not just a box -- the
    # design doc's Section 7 fallback criteria never had to trigger.
    contour_points: list[int] = Field(..., min_length=6)  # at least 3 points
    # The same outline in the marks' shape (design doc, item 17): "a1",
    # "a2", ... strongest first, and [[x, y], ...] in 0-1000 frame units.
    # Added by FastAPI from contour_points, which Gemini still returns as a
    # flat list (nested arrays broke its response schema). Results cached
    # before this change have neither; read them with region_points().
    id: Optional[str] = None
    points: Optional[list[list[float]]] = None
    # Why the eye lands here, one short sentence (scene analysis prompt).
    reason: Optional[str] = None
    # Gemini's own read of whether the sketcher marked this area. Kept for
    # debugging only: which areas count as missed is decided by geometry
    # against the stored focal points (scene_analysis/service.py).
    sketcher_marked: Optional[bool] = None


def region_points(region) -> list[list[float]]:
    """A focal area's outline as [[x, y], ...], from `points` or, for
    results cached before item 17, from the flat contour_points."""
    get = region.get if isinstance(region, dict) else lambda k: getattr(region, k, None)
    pts = get("points")
    if pts:
        return [list(p) for p in pts]
    flat = get("contour_points") or []
    return [[flat[k], flat[k + 1]] for k in range(0, len(flat) - 1, 2)]


# One guided-question answer; written by sketches, read by critique_agent.
class Spot(BaseModel):
    """A spot on the sketcher's lines: where two marks meet, or a point on
    one mark (design doc, item 17). 0-1000 frame units."""
    x: float
    y: float
    mark_ids: list[str] = Field(default_factory=list)


class Relationship(BaseModel):
    """How two or more marked subjects connect (design doc, item 17). kind
    is one of question_bank.json relationship.kinds; principle is that
    kind's principle; subjects are short noun phrases, e.g. "stop sign"."""
    kind: str
    principle: Optional[str] = None
    subjects: list[str] = Field(default_factory=list)


class SessionChoice(BaseModel):
    """
    One guided-question answer. key, focus and mark_ids are optional so
    answers saved before they existed still load. focus tells the critique
    whether the question was about the sketcher's own plan ("selected",
    "other") or about something they had not marked ("unseen"); a "yes"
    to an unseen question is "prompted" evidence (design doc, item 15).
    """
    prompt: str
    response: str
    key: Optional[str] = None
    focus: Optional[Literal["selected", "unseen", "other"]] = None
    option_index: Optional[int] = None
    mark_ids: list[str] = Field(default_factory=list)
    # The spot the question pointed at (ai_spot), and the spot the sketcher
    # marked while answering (spot), if any.
    ai_spot: Optional[Spot] = None
    spot: Optional[Spot] = None
    # Set on the answer to the relationship question: the connection the
    # AI read, which the sketcher confirmed, changed or put in their words.
    relationship: Optional[Relationship] = None
