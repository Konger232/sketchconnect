"""
Sketch requests (plain CRUD on the sketches table, not a Gemini call),
including focal-point input for the focal-frame save.
"""
from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel, Field

from app.core.schemas import Style

class LocationInput(BaseModel):
    lat: float
    lon: float
    # Human-readable label to store alongside the coordinates --
    # sent by the frontend's LocationSearchField whenever it already
    # has one on hand (a search result's own label, or the label
    # already showing from Gemini's EXIF reading), so update_sketch
    # never has to resolve one itself.
    label: Optional[str] = None


class SketchUpdateRequest(BaseModel):
    title: Optional[str] = None
    field_notes: Optional[str] = None
    location: Optional[LocationInput] = None
    # Both added for the capture wizard's Step 2 (title/style/location/
    # date-time in one form, per parking-lot.md) -- style was previously
    # only ever set inside scene_analysis.py's own endpoint; Step 2 needs
    # to persist it before navigating to Step 3, so SketchFlowPage's
    # existing "does this sketch already have a style?" resume check
    # skips straight past its now-dead style-picker step.
    style: Optional[Style] = None
    captured_at: Optional[datetime] = None


# --- Focal-point marking (prototype-stage — not yet wired to an endpoint;
# see claude/parking-lot.md, "Focal-area marking: sketcher-marks-first +
# Gemini-suggests interaction"). These shapes exist so features/sketches/focal_pairing.py
# has something concrete to type against ahead of the real capture-flow build. ---

PairingMethod = Literal["region_ref", "contains", "nearest", "unmatched"]


class SketcherFocalPointInput(BaseModel):
    """
    One point as it comes off the marking/crop/refine UI — either the
    sketcher's own free placement, or a Gemini `focal_regions` suggestion
    they adopted. 0-1000 scale, same convention as `FocalRegion.contour_points`.
    """
    x: int
    y: int
    source: Literal["own", "adopted"]
    # Only meaningful when source == "adopted". This is a *positional*
    # index into that sketch's cached `focal_regions` list, not a stored
    # id — FocalRegion has no id field today. Stable for one sketch's
    # lifetime since `cached_scene_analysis` is written once and never
    # reordered (see models.py's Sketch.cached_scene_analysis comment),
    # but a real id should replace this if focal_regions ever becomes
    # independently editable.
    region_ref: Optional[int] = None


class PairedFocalPoint(SketcherFocalPointInput):
    """SketcherFocalPointInput plus what focal_pairing.py resolved it to."""
    paired_label: Optional[str] = None
    paired_region_ref: Optional[int] = None
    pairing_method: PairingMethod
    # Distance (0-1000 scale) from the point to the paired region's
    # boundary. 0 for "region_ref"/"contains" (already inside or already
    # known); set for "nearest"; None for "unmatched".
    pairing_distance: Optional[float] = None
