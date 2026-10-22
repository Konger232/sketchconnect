"""
My kit request bodies (design doc, item 28). Plain CRUD on kit_items, not
a Gemini call. The router cleans and checks every field (kit/router.py).
"""
from typing import Literal, Optional

from pydantic import BaseModel, Field

Kind = Literal["line", "ink", "color", "brush", "paper", "extra"]


class KitItemRequest(BaseModel):
    kind: Kind
    label: str = Field(min_length=1, max_length=80)
    details: dict = Field(default_factory=dict)
    pigment_codes: list[str] = Field(default_factory=list)
    medium: Optional[Literal["watercolor", "gouache"]] = None
    opacity: Optional[Literal["transparent", "opaque"]] = None
    pinned: bool = False
    hidden: bool = False
    # Its pin on a bag photo (item 44): {photo, x, y}, or none.
    spot: Optional[dict] = None


class KitReadRequest(BaseModel):
    photo: int = Field(ge=0, le=2)
