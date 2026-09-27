"""
Help Quest call request/response (gemini_call_schemas.md #4).
"""
from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel, Field

from app.core.schemas import SceneType, Style

class HelpQuestEntry(BaseModel):
    step_id: str
    question: str
    answer: str
    principle_reference: Optional[str] = None


class HelpQuestRequest(BaseModel):
    sketch_id: str
    question: str
    style: Style
    scene_type: SceneType
    step_id: str


class HelpQuestResponse(BaseModel):
    answer: str
    principle_reference: str
