"""
Profile update request (plain CRUD on the profiles table, not a Gemini call).
"""
from typing import Optional

from pydantic import BaseModel, Field


class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=80)
    avatar_url: Optional[str] = None
    location: Optional[str] = Field(default=None, max_length=120)
    # The sketcher page (design doc, item 36).
    handle: Optional[str] = None
    bio: Optional[str] = Field(default=None, max_length=300)
    # {"instagram": url, "tiktok": url, "facebook": url, "website": url}
    links: Optional[dict[str, str]] = None
    # My favorite palette, as paint ids from the paint list (frontend
    # data/paints.js), and the featured sketches, in slideshow order.
    favorite_paints: Optional[list[str]] = None
    featured_sketch_ids: Optional[list[str]] = None
