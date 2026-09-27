"""
Profile update request (plain CRUD on the profiles table, not a Gemini call).
"""
from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel, Field


class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    location: Optional[str] = None
