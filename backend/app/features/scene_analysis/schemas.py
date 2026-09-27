"""
Scene analysis call request/response (gemini_call_schemas.md #1).
"""
from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel, Field

from app.core.schemas import FocalRegion, SceneType, Style

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
    # Short, Gemini-suggested title for the sketch scene itself (not the
    # sketching process) -- at most 8-10 words, e.g. "Sunset Over the Old
    # Harbor Bridge". scene_analysis.py only applies it to the sketch row
    # when the sketch doesn't already have a title, so it's a convenience
    # default, never something that overwrites a sketcher's own edit.
    # Optional: absent/blank is treated as "no suggestion" rather than an
    # error, same defensive posture as perspective_lines below.
    suggested_title: Optional[str] = None
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
    # filtering, for on-screen debugging (see core/gemini_service.py's
    # call_gemini_json_with_raw). Not part of the "real" API contract;
    # drop this before this app ever has non-developer users.
    debug_raw_gemini_response: Optional[str] = None
