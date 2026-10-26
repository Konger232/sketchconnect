"""
Events request bodies (design doc, item 49). The router checks the rules:
who may set one up, the caps, the hashtag.
"""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class InstructorIn(BaseModel):
    # A sketcher on SketchConnect (they confirm), or a plain name.
    username: Optional[str] = Field(default=None, max_length=40)
    name: Optional[str] = Field(default=None, max_length=80)


class EventRequest(BaseModel):
    kind: Literal["crawl", "organised"]
    event_type: Literal["crawl", "workshop", "symposium", "festival"] = "crawl"
    title: str = Field(min_length=1, max_length=150)
    description: Optional[str] = Field(default=None, max_length=4000)
    theme: Optional[str] = Field(default=None, max_length=120)
    hashtag: str = Field(min_length=3, max_length=41)
    starts_at: datetime
    ends_at: datetime
    time_zone: str = Field(default="UTC", max_length=64)
    place_name: str = Field(min_length=1, max_length=200)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    spot_id: Optional[str] = None
    org_name: Optional[str] = Field(default=None, max_length=150)
    org_url: Optional[str] = Field(default=None, max_length=300)
    website_url: Optional[str] = Field(default=None, max_length=300)
    ticket_url: Optional[str] = Field(default=None, max_length=300)
    instructors: list[InstructorIn] = Field(default_factory=list, max_length=20)


class ReportRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


class CommentRequest(BaseModel):
    body: str = Field(min_length=1, max_length=1000)
