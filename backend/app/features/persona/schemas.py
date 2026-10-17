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


class AdmiredAddRequest(BaseModel):
    """A name for the admired sketchers list (design doc, item 36), with an
    optional link to their page and where they sketch."""
    name: str = Field(min_length=1, max_length=80)
    link: Optional[str] = None
    location: Optional[str] = None


class AdmiredUpdateRequest(BaseModel):
    link: Optional[str] = None
    location: Optional[str] = None


class PersonaResponse(BaseModel):
    persona_source: Literal["sketcher_provided", "system_default"]
    persona_label: str
    voice: str
    priorities: list[str]
    tone: str
