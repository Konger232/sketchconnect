"""
What's in my bag request bodies (design doc, items 28 and 44). The router
cleans and checks every field (kit/router.py).
"""
from typing import Literal, Optional

from pydantic import BaseModel, Field

Category = Literal["pen", "ink", "brush", "paper", "sketchbook", "palette", "clips", "easel", "bag", "other"]


class KitItemRequest(BaseModel):
    category: Category
    label: str = Field(min_length=1, max_length=80)
    note: Optional[str] = Field(default=None, max_length=300)  # up to 30 words
    link: Optional[str] = Field(default=None, max_length=300)
    # Its pin on a bag photo: {photo, x, y}, or none.
    spot: Optional[dict] = None


class KitReadRequest(BaseModel):
    photo: int = Field(ge=0, le=2)
