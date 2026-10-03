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


class Reading(BaseModel):
    """One AI reading of what an object's marks point at (seeing as)."""
    text: str                        # the option the sketcher sees
    name: str                        # short noun phrase, fills {A} or {B} later
    element: str


class GuideObject(BaseModel):
    """One object the guide asks about: a shape of the sketcher's marks."""
    shape_id: str
    mark_ids: list[str]
    # What the subject is. People and animals are never read as shapes.
    kind: Optional[Literal["person", "animal", "vehicle", "building", "object", "plant", "landscape", "sky", "water"]] = None
    name: str
    description: str = ""
    element: str
    weight: Optional[Literal["light", "medium", "heavy"]] = None
    readings: list[Reading] = Field(default_factory=list)
    selected: bool = False           # the sketcher selected these marks


class SceneObject(BaseModel):
    """A part of the scene a tap on the photo can pick, marked or not."""
    id: str                          # o1, o2, ...
    kind: Optional[Literal["person", "animal", "vehicle", "building", "object", "plant", "landscape", "sky", "water"]] = None
    label: str
    description: str
    element: str
    points: list[list[int]]          # outline, [[x, y], ...] in 0-1000


class Balance(BaseModel):
    heavier: Literal["left", "right", "top", "bottom", "even"]
    reason: str = ""


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


class PrincipleVariant(BaseModel):
    """What to bring out, for one relationship type (or "other")."""
    question: str
    options: list[str]
    option_principles: list[str]
    option_elements: list[str] = Field(default_factory=list)


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
    variants: dict[str, PrincipleVariant] = Field(default_factory=dict)
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
    objects: list[GuideObject] = Field(default_factory=list)
    scene_objects: list[SceneObject] = Field(default_factory=list)
    balance: Optional[Balance] = None
    form_relationships: list[FormRelationship] = Field(default_factory=list)
    stroke_order_note: Optional[str] = None
    # Intents saved so far (from the sketch's answers), at most max_principles.
    intents: list[Intent] = Field(default_factory=list)
    max_principles: int = 3
    focal_suggestions: list[FocalSuggestion] = Field(default_factory=list)
    prepared_prompts: list[MarksPrompt] = Field(default_factory=list)
    debug_raw_gemini_response: Optional[str] = None
