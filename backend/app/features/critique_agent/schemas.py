"""
Critique agent call request/response (gemini_call_schemas.md #3).
"""
from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel, Field

from app.core.schemas import SceneType, SessionChoice, Style
from app.features.help_quest.schemas import HelpQuestEntry
from app.features.persona.schemas import PersonaResponse

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
