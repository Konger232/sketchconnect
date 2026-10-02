"""
Marks analysis call request/response (design doc, Section 11, item 20).
Element and principle keys come from app/core/design_fundamentals.json.
"""
from typing import Optional, Literal

from pydantic import BaseModel, Field

from app.core.schemas import Relationship, SceneType, Source, Spot
from app.features.scene_analysis.schemas import FocalSuggestion

Role = Literal["contour", "big_shape", "eye_level", "ground_line", "perspective_guide",
               "measurement", "alignment", "gesture", "unclear"]
Fit = Literal["close", "loose", "not_applicable"]


class MarkReading(BaseModel):
    """What one mark is, read by the AI (seeing as, before the sketcher says)."""
    mark_id: str
    traces: str                      # the scene feature it follows, or "nothing in the scene"
    element: str                     # a from_marks element
    role: Role
    fit: Fit


class ShapeReading(BaseModel):
    """One shape the guide asks about: the sketcher's selected shapes first,
    else the shapes the AI picked. Its element sets the matrix row the
    principle options come from."""
    shape_id: str
    mark_ids: list[str]
    element: str
    readings: list[str]              # the AI's best and next reading
    principles: list[str]            # offered in principle_intent, from the element's row
    selected: bool = False           # the sketcher selected these marks


class MarkRelationship(BaseModel):
    mark_ids: list[str]
    element: str
    principle: str
    observation: str


class FormPoint(BaseModel):
    label: str
    x: int
    y: int


class FormRelationship(BaseModel):
    """How forms in the scene relate, marked or not. mark_ids is empty when
    no mark sits on them; those feed the unseen question."""
    forms: list[FormPoint]
    mark_ids: list[str] = Field(default_factory=list)
    element: Optional[str] = None
    principle: str
    observation: str


class Intent(BaseModel):
    """A principle the sketcher works toward, on the marks it applies to."""
    principle: str
    mark_ids: list[str] = Field(default_factory=list)
    source: Source
    answer_to: Optional[str] = None


class MarksPrompt(BaseModel):
    """
    One guided question. The fields AIGuidance.jsx already reads (key,
    question, options, option_actions, focus, mark_ids, spot, suggestion,
    relationship) keep their scene analysis meaning, so the panel shows
    either call's questions.
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
    # The question's cell in the matrix.
    element: Optional[str] = None
    principle: Optional[str] = None
    # Per-shape questions: the shape they are about.
    shape_id: Optional[str] = None
    # principle_intent: multi-select principles, then "Not sure yet".
    multi_select: bool = False
    max_principles: Optional[int] = None
    option_principles: list[Optional[str]] = Field(default_factory=list)
    option_hints: list[Optional[str]] = Field(default_factory=list)
    undecided_option: Optional[int] = None
    # mark_questions: asked only when the sketcher picked this principle
    # for this shape (principle_intent) or said Yes to a relationship of
    # that principle on these marks. The app skips it otherwise.
    requires_principle: Optional[str] = None


class MarksAnalysisResponse(BaseModel):
    guide_source: Literal["marks_analysis"] = "marks_analysis"
    scene_type: Optional[SceneType] = None
    marks: list[MarkReading] = Field(default_factory=list)
    shapes: list[ShapeReading] = Field(default_factory=list)
    mark_relationships: list[MarkRelationship] = Field(default_factory=list)
    form_relationships: list[FormRelationship] = Field(default_factory=list)
    stroke_order_note: Optional[str] = None
    # Intents saved so far (from the sketch's answers), at most max_principles.
    intents: list[Intent] = Field(default_factory=list)
    max_principles: int = 3
    focal_suggestions: list[FocalSuggestion] = Field(default_factory=list)
    prepared_prompts: list[MarksPrompt] = Field(default_factory=list)
    debug_raw_gemini_response: Optional[str] = None
