"""
Scene analysis call response (gemini_call_schemas.md #1). Photo only:
the scene facts, no guided questions (scene-photo-only branch, Oct 6, 2026).
"""
from typing import Optional

from pydantic import BaseModel, Field

from app.core.schemas import FocalRegion, SceneType


class FocalSuggestion(BaseModel):
    """
    A focal area the sketcher did not mark (a focal_regions entry no mark
    or stored focal point pairs with). The marks analysis call asks about it
    as a guided question, with the AI's reticle drawn at (x, y). Design doc,
    Section 11, item 13.
    """
    region_ref: int          # index into focal_regions
    label: str
    reason: Optional[str] = None
    x: int                   # a point inside the region's outline, 0-1000
    y: int


class SceneAnalysisResponse(BaseModel):
    scene_type: SceneType
    scene_summary: str
    # Short, Gemini-suggested title for the sketch scene itself. Only applied
    # to the sketch row when the sketch doesn't already have a title.
    suggested_title: Optional[str] = None
    focal_regions: list[FocalRegion] = Field(default_factory=list, max_length=3)
    # Dev-time only: Gemini's raw response text, for the debug panel.
    debug_raw_gemini_response: Optional[str] = None
