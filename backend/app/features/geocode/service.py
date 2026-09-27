"""
Nominatim (OpenStreetMap) lookups used outside the geocode routes too:
reverse_geocode() is called by scene_analysis and sketches to store a short
place name. See router.py for the proxy endpoints and usage-policy notes.
"""
import httpx

NOMINATIM_BASE = "https://nominatim.openstreetmap.org"
HEADERS = {"User-Agent": "SketchConnect-Capstone/1.0 (Harvard precapstone project, non-commercial)"}

def short_label(r: dict) -> str | None:
    """'Place, Area, City' from Nominatim's address parts instead of the
    full display_name (house number, district, postcode, country...)."""
    a = r.get("address") or {}
    candidates = [
        r.get("name"),                                           # a landmark/POI name, if the pin is on one
        a.get("suburb") or a.get("quarter") or a.get("neighbourhood") or a.get("village"),
        a.get("city") or a.get("town") or a.get("county") or a.get("state"),
    ]
    parts = []
    for p in candidates:
        if p and p not in parts:
            parts.append(p)
    if len(parts) < 2 and a.get("country"):
        parts.append(a["country"])
    return ", ".join(parts) or r.get("display_name")


async def reverse_geocode(lat: float, lon: float) -> str | None:
    """
    Core reverse-geocode call, factored out so scene_analysis.py can reuse
    it directly (rather than asking Gemini to guess a city/country from
    bare coordinates, which it briefly did -- see parking-lot.md) instead
    of going through the /reverse route below. Returns None on any
    failure rather than raising -- a geocode hiccup during scene analysis
    shouldn't block the sketch from being created; the /reverse endpoint
    below is what turns a None into a proper 502 for its own caller.
    """
    async with httpx.AsyncClient(timeout=8) as client:
        try:
            resp = await client.get(
                f"{NOMINATIM_BASE}/reverse",
                # accept-language=en -- same reasoning as /search above; this
                # is the call that resolves a sketch's EXIF-detected GPS
                # coordinates to a readable place name, so it's the one that
                # actually produced the Japanese-script "Kyoto" label.
                params={"lat": lat, "lon": lon, "format": "jsonv2", "accept-language": "en"},
                headers=HEADERS,
            )
        except httpx.HTTPError:
            return None
    if resp.status_code != 200:
        return None
    return short_label(resp.json())
