"""
Scene analysis call request/response (gemini_call_schemas.md #1).
"""
from typing import Optional, Literal

from pydantic import BaseModel, Field

from app.core.schemas import FocalRegion, Relationship, SceneType, Spot, Style


class FocalSuggestion(BaseModel):
    """
    A focal area the sketcher did not mark (a focal_regions entry that no
    stored focal point pairs with). Asked about as a guided question, with
    the AI's reticle drawn at (x, y). Design doc, Section 11, item 13.
    """
    region_ref: int          # index into focal_regions
    label: str
    reason: Optional[str] = None
    x: int                   # a point inside the region's outline, 0-1000
    y: int


class ProportionSpan(BaseModel):
    label: str
    line: list[int]          # [x1, y1, x2, y2], 0-1000
    # Length measured against the unit by the backend (the unit itself is
    # 1.0). Quarters below 1, halves above. Never estimated by Gemini.
    ratio: float


class Proportions(BaseModel):
    """Shown by the "proportions" overlay (question bank option action)."""
    # Every span measures this one direction: "vertical" (heights) or
    # "horizontal" (widths), set by the unit.
    axis: Literal["vertical", "horizontal"] = "vertical"
    unit: ProportionSpan
    comparisons: list[ProportionSpan] = Field(default_factory=list)


class PreparedPrompt(BaseModel):
    key: str
    question: str
    options: list[str]
    # Parallel to options: the overlay each option shows when picked, or
    # None. From question_bank.json, matched by position (design doc,
    # Section 11, item 14).
    option_actions: list[Optional[str]] = Field(default_factory=list)
    # Parallel to options: the sketcher's marks each option refers to
    # (empty when it names none). Picking an option highlights its marks,
    # and tapping one of those marks on the photo picks the option.
    option_mark_ids: list[list[str]] = Field(default_factory=list)
    # Set only on "There is the ... here" questions (key
    # "focal_suggestion"). The first option adds it as a focal point.
    suggestion: Optional[FocalSuggestion] = None
    # Question order (design doc, items 15 and 17): "selected" (about the
    # marks the sketcher selected), "unseen" ("There is the ... here"),
    # "other". Saved with each answer, so the critique can tell a
    # prompted choice from the sketcher's own plan.
    focus: Optional[Literal["selected", "unseen", "other"]] = None
    # The marks this question is about. The app highlights them while the
    # question shows. Ids are never shown to the sketcher.
    mark_ids: list[str] = Field(default_factory=list)
    # A spot where the sketcher's lines meet, shown with a reticle while
    # the question shows. None when the question points at no spot.
    spot: Optional[Spot] = None
    # Set only on the relationship question (key "relationship"): how the
    # marked subjects connect. Saved with the answer for the critique.
    relationship: Optional[Relationship] = None


class VanishingPoint(BaseModel):
    # 0-1000 frame coordinates, but may sit far outside the frame
    # (service.py VP_MIN / VP_MAX), e.g. well above it when looking up.
    x: int
    y: int
    # Flat [x1, y1, x2, y2, ...], the real edges in the photo that run
    # toward this point, 0-1000. Same flat-array pattern as
    # FocalRegion.contour_points.
    edges: list[int] = Field(default_factory=list)


class Perspective(BaseModel):
    # Horizontal eye level as a y value; may be above (< 0) or below
    # (> 1000) the frame. None only if Gemini gave nothing usable.
    eye_level_y: Optional[int] = None
    kind: Literal["one_point", "two_point", "three_point", "none"] = "none"
    vanishing_points: list[VanishingPoint] = Field(default_factory=list)


class SceneAnalysisRequest(BaseModel):
    sketch_id: str
    style: Style


class SceneAnalysisResponse(BaseModel):
    # Which call drives the guided questions (config.GUIDE_SOURCE, design
    # doc item 20). "marks_analysis": the app calls /api/marks-analysis next
    # and shows its prepared_prompts instead of these.
    guide_source: Literal["scene_analysis", "marks_analysis"] = "scene_analysis"
    scene_type: SceneType
    mixed_dominant_region: Optional[Literal["architectural", "figure"]] = None
    scene_summary: str
    # Short, Gemini-suggested title for the sketch scene itself (not the
    # sketching process) -- at most 8-10 words. Only applied to the sketch
    # row when the sketch doesn't already have a title.
    suggested_title: Optional[str] = None
    focal_regions: list[FocalRegion] = Field(default_factory=list, max_length=3)
    # Eye level plus vanishing points, each with the real edges that run
    # toward it (replaced the flat perspective_lines list, design doc
    # Section 11, item 11). Checked against its own edges in service.py.
    # None when the scene has nothing usable. Shown only when the sketcher
    # turns on the Perspective lines toggle.
    perspective: Optional[Perspective] = None
    # Which grid the guidance shows by default: "grid" (square, for the
    # grid method) or "rule_of_thirds". Set per style in question_bank.json
    # style_actions.
    grid: Literal["grid", "rule_of_thirds"] = "rule_of_thirds"
    # One unit and 2-3 spans measured against it, or None.
    proportions: Optional[Proportions] = None
    # Missed focal areas, strongest first (at most config.MAX_FOCAL_SUGGESTIONS).
    # Each also appears as a question at the front of prepared_prompts.
    focal_suggestions: list[FocalSuggestion] = Field(default_factory=list)
    prepared_prompts: list[PreparedPrompt]
    # Dev-time only -- Gemini's raw response text before any parsing or
    # filtering, for on-screen debugging (see core/gemini_service.py's
    # call_gemini_json_with_raw). Not part of the "real" API contract;
    # drop this before this app ever has non-developer users.
    debug_raw_gemini_response: Optional[str] = None
