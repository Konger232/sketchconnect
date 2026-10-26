"""Scouted spots request bodies (design doc, item 50)."""
from typing import Literal, Optional

from pydantic import BaseModel, Field


class SpotRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    note: Optional[str] = Field(default=None, max_length=1000)
    place_name: Optional[str] = Field(default=None, max_length=200)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lon: Optional[float] = Field(default=None, ge=-180, le=180)
    visibility: Literal["private", "followers"] = "private"
