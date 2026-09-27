"""
Persona creation call request/response (gemini_call_schemas.md #2).
"""
from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel, Field

from app.core.schemas import Style

class PersonaCreateRequest(BaseModel):
    style: Style
    admired_artist_name: Optional[str] = None


class PersonaResponse(BaseModel):
    persona_source: Literal["sketcher_provided", "system_default"]
    persona_label: str
    voice: str
    priorities: list[str]
    tone: str
