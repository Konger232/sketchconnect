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

Nothing here is persisted -- Sketch.location stays lat/lon-only (see
models.py); the human-readable label is resolved live whenever it's
needed rather than stored, so no schema change was needed to add this.
"""
import httpx
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/geocode", tags=["geocode"])

NOMINATIM_BASE = "https://nominatim.openstreetmap.org"
HEADERS = {"User-Agent": "SketchConnect-Capstone/1.0 (Harvard precapstone project, non-commercial)"}


@router.get("/search")
async def search(q: str):
    """Forward geocoding: a typed place name/address -> up to 5 candidates."""
    if not q or not q.strip():
        return []
    async with httpx.AsyncClient(timeout=8) as client:
        try:
            resp = await client.get(
                f"{NOMINATIM_BASE}/search",
                params={"q": q, "format": "jsonv2", "limit": 5},
                headers=HEADERS,
            )
        except httpx.HTTPError:
            raise HTTPException(502, "Location search is temporarily unavailable")
    if resp.status_code != 200:
        raise HTTPException(502, "Location search is temporarily unavailable")
    return [
        {"label": r["display_name"], "lat": float(r["lat"]), "lon": float(r["lon"])}
        for r in resp.json()
    ]


@router.get("/reverse")
async def reverse(lat: float, lon: float):
    """Reverse geocoding: a lat/lon (from EXIF, a map click, or a drag) -> a label."""
    async with httpx.AsyncClient(timeout=8) as client:
        try:
            resp = await client.get(
                f"{NOMINATIM_BASE}/reverse",
                params={"lat": lat, "lon": lon, "format": "jsonv2"},
                headers=HEADERS,
            )
        except httpx.HTTPError:
            raise HTTPException(502, "Location lookup is temporarily unavailable")
    if resp.status_code != 200:
        raise HTTPException(502, "Location lookup is temporarily unavailable")
    data = resp.json()
    return {"label": data.get("display_name")}
