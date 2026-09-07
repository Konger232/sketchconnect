"""
Pydantic request/response models, one-to-one with gemini_call_schemas.md.
Keep these two files in sync — this is the enforcement layer that makes
Gemini's responseSchema config and FastAPI's validation agree.
"""
from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, Field

Style = Literal["ink_and_wash", "realistic", "minimalist", "reportage"]
SceneType = Literal[
    "architectural", "still_life_organic", "figure", "open_landscape", "mixed"
]


# --- 1. Scene Analysis call ---

class FocalRegion(BaseModel):
    label: str
    # Flat (x, y) pairs -- [x1, y1, x2, y2, ...] -- tracing the object's
    # actual visible outline, 0-1000 scale. Replaced the old rectangular
    # bounding_box after a real-world test (see parking-lot.md) showed
    # Gemini can trace a reasonable silhouette, not just a box -- the
    # design doc's Section 7 fallback criteria never had to trigger.
    contour_points: list[int] = Field(..., min_length=6)  # at least 3 points


class PreparedPrompt(BaseModel):
    key: str
    question: str
    options: list[str]


class SceneAnalysisRequest(BaseModel):
    sketch_id: str
    style: Style


class SceneAnalysisResponse(BaseModel):
    scene_type: SceneType
    mixed_dominant_region: Optional[Literal["architectural", "figure"]] = None
    scene_summary: str
    focal_regions: list[FocalRegion] = Field(default_factory=list, max_length=3)
    # Flat [x1, y1, x2, y2, ...] list, one 4-int group per dominant real
    # perspective/vanishing line Gemini finds in the photo (0-1000 scale,
    # same flat-array pattern as FocalRegion.contour_points -- see that
    # field's comment re: response_schema's lack of minItems/maxItems
    # support). Empty when the scene has no clear converging lines, or
    # for scene types where perspective isn't a meaningful question.
    # Only rendered on screen when the sketcher picks the option that
    # asks for it (see rules.py's "perspective_lines" prompt key) -- see
    # parking-lot.md for why this exists at all (prepared_prompts used to
    # offer this choice with nothing behind it).
    perspective_lines: list[int] = Field(default_factory=list)
    prepared_prompts: list[PreparedPrompt]
    # Dev-time only -- Gemini's raw response text before any parsing or
    # filtering, for on-screen debugging (see services/gemini_client.py's
    # call_gemini_json_with_raw). Not part of the "real" API contract;
    # drop this before this app ever has non-developer users.
    debug_raw_gemini_response: Optional[str] = None


# --- 2. AI Agent Persona Creation call ---

class PersonaCreateRequest(BaseModel):
    style: Style
    admired_artist_name: Optional[str] = None


class PersonaResponse(BaseModel):
    persona_source: Literal["sketcher_provided", "system_default"]
    persona_label: str
    voice: str
    priorities: list[str]
    tone: str


# --- 3. Critique Agent call ---

class SessionChoice(BaseModel):
    prompt: str
    response: str


class HelpQuestEntry(BaseModel):
    step_id: str
    question: str
    answer: str
    principle_reference: Optional[str] = None


class CritiqueRequest(BaseModel):
    sketch_id: str
    style: Style
    scene_type: SceneType
    persona: PersonaResponse
    session_choices: list[SessionChoice] = Field(default_factory=list)
    help_quest_log: list[HelpQuestEntry] = Field(default_factory=list)
    final_sketch_provided: bool = False
    prior_review_summary: Optional[str] = None


class DecisionTrace(BaseModel):
    carried_through: list[str] = Field(default_factory=list)
    shifted: list[str] = Field(default_factory=list)
    instinct_only: list[str] = Field(default_factory=list)


class CritiqueResponseOut(BaseModel):
    prior_review_summary: str
    decision_trace: DecisionTrace
    critique: str
    final_sketch_provided: bool


# --- 4. Help Quest ---

class HelpQuestRequest(BaseModel):
    sketch_id: str
    question: str
    style: Style
    scene_type: SceneType
    step_id: str


class HelpQuestResponse(BaseModel):
    answer: str
    principle_reference: str


# --- Profile (not a Gemini call -- plain CRUD on the profiles table) ---

class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    location: Optional[str] = None


# --- Sketch (not a Gemini call -- plain CRUD on the sketches table) ---

class LocationInput(BaseModel):
    lat: float
    lon: float


class SketchUpdateRequest(BaseModel):
    title: Optional[str] = None
    field_notes: Optional[str] = None
    location: Optional[LocationInput] = None
    # Both added for the capture wizard's Step 2 (title/style/location/
    # date-time in one form, per parking-lot.md) -- style was previously
    # only ever set inside scene_analysis.py's own endpoint; Step 2 needs
    # to persist it before navigating to Step 3, so SketchFlowPage's
    # existing "does this sketch already have a style?" resume check
    # skips straight past its now-dead style-picker step.
    style: Optional[Style] = None
    captured_at: Optional[datetime] = None
