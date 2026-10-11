"""
Marks analysis call request/response (design doc, Section 11, items 20 and 25).
Element and principle keys come from app/core/design_fundamentals.json.
"""
from typing import Optional, Literal

from pydantic import BaseModel, Field

from app.core.schemas import Relationship, SceneType, Spot
from app.features.scene_analysis.schemas import FocalSuggestion

Role = Literal["contour", "big_shape", "eye_level", "ground_line", "perspective_guide",
               "gesture", "unclear"]
Fit = Literal["close", "loose", "not_applicable"]


Depth = Literal["foreground", "middle", "background"]


class MarkReading(BaseModel):
    """What one stroke points at, read from the photo under it."""
    mark_id: str
    traces: str                      # the scene feature it follows
    element: str                     # a from_marks element
    role: Role
    fit: Fit
    depth: Optional[Depth] = None    # of what it points at (item 25)


class PlanTip(BaseModel):
    name: str                        # 3 words or fewer
    tip: str                         # 10 words or fewer, starts with a verb


class PlanPrinciple(BaseModel):
    """One principle in the plan read (design doc, item 25)."""
    principle: str
    group: Literal["strong", "moderate", "none"]
    mark_ids: list[str] = Field(default_factory=list)
    elements: list[str] = Field(default_factory=list)
    why: str = ""
    tips: list[PlanTip] = Field(default_factory=list)


class PlanRelationship(BaseModel):
    """A relationship inside a strong or moderate principle. The card shows
    only its tips; the type is kept for the critique."""
    type: str
    principle: str
    objects: list[str] = Field(default_factory=list)
    mark_ids: list[str] = Field(default_factory=list)
    why: str = ""
    tips: list[PlanTip] = Field(default_factory=list)


class PlanRead(BaseModel):
    principles: list[PlanPrinciple] = Field(default_factory=list)
    relationships: list[PlanRelationship] = Field(default_factory=list)


class MarksPrompt(BaseModel):
    """
    One guided question. The fields AIGuidance.jsx already reads (key,
    question, options, option_actions, focus, mark_ids, spot, suggestion)
    keep their scene analysis meaning, so the panel shows either call's
    questions.
    """
    key: str
    question: str
    options: list[str]
    option_actions: list[Optional[str]] = Field(default_factory=list)
    option_mark_ids: list[list[str]] = Field(default_factory=list)
    focus: Optional[Literal["selected", "unseen", "other"]] = None
    mark_ids: list[str] = Field(default_factory=list)
    spot: Optional[Spot] = None
    suggestion: Optional[FocalSuggestion] = None
    relationship: Optional[Relationship] = None
    # The question's cell in the matrix (unseen questions).
    element: Optional[str] = None
    principle: Optional[str] = None
    # Per option: its element, short name (mark_meaning), relationship type
    # and principle. Shown as tags only in debug mode.
    option_elements: list[Optional[str]] = Field(default_factory=list)
    option_names: list[str] = Field(default_factory=list)
    option_types: list[str] = Field(default_factory=list)
    option_principles: list[Optional[str]] = Field(default_factory=list)
    # mark_meaning: the object it asks about.
    shape_id: Optional[str] = None
    # relationship and principle_intent: {"A": shape_id, "B": shape_id}. The
    # app fills {A} and {B} with the sketcher's own names from mark_meaning,
    # else default_names.
    name_refs: dict[str, str] = Field(default_factory=dict)
    default_names: dict[str, str] = Field(default_factory=dict)
    # principle_intent: asked after the relationship question with these
    # refs, as the variant for the type the sketcher picked ("other" for a
    # tap or their own words).
    after_relationship: list[str] = Field(default_factory=list)
    variants: dict[str, dict] = Field(default_factory=dict)
    max_principles: Optional[int] = None
    # Answer by a tap on the photo, or in the sketcher's own words.
    tap_answer: bool = False
    own_words: bool = False
    own_words_placeholder: Optional[str] = None
    spot_placeholder: Optional[str] = None
    own_words_max: Optional[int] = None


class MarksAnalysisResponse(BaseModel):
    guide_source: Literal["marks_analysis"] = "marks_analysis"
    # DEBUG=true in backend/.env: the panel shows each option's tags.
    debug: bool = False
    scene_type: Optional[SceneType] = None
    marks: list[MarkReading] = Field(default_factory=list)
    # The plan read (item 25), checked and in card order.
    plan_read: PlanRead = Field(default_factory=PlanRead)
    # Strokes joined by area, in stroke order (core/mark_geometry.areas).
    areas: list[list[str]] = Field(default_factory=list)
    # The media card's picks the tips were written for.
    media: list[str] = Field(default_factory=list)
    stroke_order_note: Optional[str] = None
    focal_suggestions: list[FocalSuggestion] = Field(default_factory=list)
    # The one question left in New Sketch: a missed focal area.
    prepared_prompts: list[MarksPrompt] = Field(default_factory=list)
    debug_raw_gemini_response: Optional[str] = None
    # DEBUG=true only: a report page exists (GET /api/sketches/{id}/marks-report).
    debug_report: bool = False
