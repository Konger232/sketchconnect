"""
Paint library and My palette request bodies (design doc, item 46). The
router cleans and checks every field (paints/router.py).
"""
from typing import Optional

from pydantic import BaseModel, Field


class NewPaintRequest(BaseModel):
    brand: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=60)
    pigment_codes: list[str] = Field(min_length=1, max_length=4)
    hex: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    lean: Optional[str] = Field(default=None, max_length=80)
    # A pigment code we don't know: saved only once the sketcher says the
    # tube really says so.
    confirm_unknown: bool = False


class FlagRequest(BaseModel):
    note: Optional[str] = Field(default=None, max_length=300)


class PaletteRequest(BaseModel):
    paints: list[str] = Field(max_length=48)
    # {"rows", "cols", "pans": [{"r", "c", "w", "h", "paint"}]}
    layout: Optional[dict] = None
