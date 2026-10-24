"""
Thin proxy over OpenStreetMap's Nominatim geocoding service: forward
search (place name -> candidate matches) and reverse lookup (lat/lon ->
a human-readable label), backing the sketch location editor's search box
and "matched location" display.

Proxied through the backend rather than called from the browser for two
reasons: Nominatim's usage policy
(https://operations.osmfoundation.org/policies/nominatim/) requires a
descriptive User-Agent identifying the calling application, which is
awkward to set reliably from browser fetch/XHR; and centralizing the call
here gives one place to add caching later if this ever needs more than
light, one-request-at-a-time interactive use -- the public Nominatim
instance is free (no API key) but rate-limited to roughly 1 request/second
and isn't meant for bulk or production-scale traffic. Swap this for a
paid geocoder before this app has real concurrent users, same caveat as
the local-disk upload storage in sketches.py.

Search results and a sketcher's own map interactions are never
persisted here -- callers resolve/display those live. scene_analysis.py
is the one exception: it calls reverse_geocode() directly (not the route
below) to store a label on Sketch.location_label the first time a
sketch's EXIF coordinates are read, so the location editor
(LocationSearchField.jsx) doesn't need to re-resolve one on every visit.
"""
from fastapi import APIRouter, HTTPException

from app.features.geocode.service import reverse_geocode, search_places

router = APIRouter(prefix="/api/geocode", tags=["geocode"])

@router.get("/search")
async def search(q: str, areas: bool = False):
    """
    Forward geocoding: a typed place name -> up to 5 places (Photon, with
    Nominatim as the fallback; geocode/service.py search_places). areas:
    countries, regions and cities before districts and streets (Explore).
    """
    if not q or not q.strip():
        return []
    places = await search_places(q.strip(), areas_first=areas)
    if places is None:
        raise HTTPException(502, "Location search is temporarily unavailable")
    return places


@router.get("/reverse")
async def reverse(lat: float, lon: float):
    """Reverse geocoding: a lat/lon (from EXIF, a map click, or a drag) -> a label."""
    label = await reverse_geocode(lat, lon)
    if label is None:
        raise HTTPException(502, "Location lookup is temporarily unavailable")
    return {"label": label}
