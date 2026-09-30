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


# Scenarios per value: design doc, Section 11, item 15, "Evidence".
Evidence = Literal["plan", "prompted", "instinct", "stages"]


class TraceItem(BaseModel):
    """One habit or opportunity (design doc, Section 11, item 15)."""
    observation: str
    principle: str  # a name from question_bank.json "principles"
    evidence: Evidence


class DecisionTrace(BaseModel):
    """
    Persona-free process record. Rows stored before item 15 have the old
    shape instead: carried_through, shifted, instinct_only (lists of text).
    """
    habits: list[TraceItem] = Field(default_factory=list)          # up to 3
    opportunities: list[TraceItem] = Field(default_factory=list)   # 1 or 2


class CritiqueResponseOut(BaseModel):
    prior_review_summary: str
    decision_trace: DecisionTrace
    critique: str
    final_sketch_provided: bool
