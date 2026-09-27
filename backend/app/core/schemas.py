"""
Pydantic shapes shared by more than one feature. Feature-specific request
and response models live in each feature's own schemas.py. Keep these in
sync with gemini_call_schemas.md.
"""
from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel, Field


Style = Literal["ink_and_wash", "realistic", "minimalist", "reportage"]
SceneType = Literal[
    "architectural", "still_life_organic", "figure", "open_landscape", "mixed"
]


# Scene analysis focal region; also read by sketches (focal-point pairing).
class FocalRegion(BaseModel):
    label: str
    # Flat (x, y) pairs -- [x1, y1, x2, y2, ...] -- tracing the object's
    # actual visible outline, 0-1000 scale. Replaced the old rectangular
    # bounding_box after a real-world test (see parking-lot.md) showed
    # Gemini can trace a reasonable silhouette, not just a box -- the
    # design doc's Section 7 fallback criteria never had to trigger.
    contour_points: list[int] = Field(..., min_length=6)  # at least 3 points


# One guided-question answer; written by sketches, read by critique_agent.
class SessionChoice(BaseModel):
    prompt: str
    response: str
