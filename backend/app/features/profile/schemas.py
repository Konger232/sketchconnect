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
    username: Optional[str] = None
    bio: Optional[str] = Field(default=None, max_length=300)
    # {"instagram": url, "tiktok": url, "facebook": url, "website": url}
    links: Optional[dict[str, str]] = None
    # My favorite palette, as paint ids from the paint list (frontend
    # data/paints.js), and the featured sketches, in slideshow order.
    favorite_paints: Optional[list[str]] = None
    # My palette's pans, laid out like the sketcher's tin:
    # {"rows": 2, "cols": 6, "pans": [{"r", "c", "w", "h", "paint"}]}.
    # Cells with no pan entry are empty half pans (profile/router.py).
    palette_layout: Optional[dict] = None
    featured_sketch_ids: Optional[list[str]] = None
