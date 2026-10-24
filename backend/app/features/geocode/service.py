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
    if len(parts) < 2 and a.get("country") and a["country"] not in parts:
        parts.append(a["country"])  # "Japan", not "Japan, Japan"
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


# Nominatim result types that name an area (a town, a city, a country...),
# not a single spot: generic search treats these as "sketches in this place".
AREA_TYPES = {
    "country", "state", "region", "province", "county", "municipality", "city", "town",
    "village", "city_district", "district", "borough", "suburb", "quarter", "island",
}


async def place_boxes(q: str, limit: int = 3) -> list[tuple[float, float, float, float]]:
    """
    Bounding boxes (south, north, west, east) of the areas a search text
    names, e.g. "Kyoto" or "Thailand", for the generic search (design doc,
    Search). Empty when the text names no area or Nominatim is unreachable:
    the search then matches by text only.
    """
    async with httpx.AsyncClient(timeout=8) as client:
        try:
            resp = await client.get(
                f"{NOMINATIM_BASE}/search",
                params={"q": q, "format": "jsonv2", "limit": limit, "accept-language": "en"},
                headers=HEADERS,
            )
        except httpx.HTTPError:
            return []
    if resp.status_code != 200:
        return []
    boxes = []
    for r in resp.json():
        if (r.get("addresstype") or r.get("type")) not in AREA_TYPES or not r.get("boundingbox"):
            continue
        s, n, w, e = (float(v) for v in r["boundingbox"])
        boxes.append((s, n, w, e))
    return boxes


# ---- forward search: Photon, with Nominatim as the fallback ----
#
# Photon (photon.komoot.io) is built on the same OpenStreetMap data and is
# made for search as you type; Nominatim's usage policy forbids that. No
# key. Results are kept for a day, so a place searched again comes back
# at once, and one connection is reused for every call.

import time

PHOTON_URL = "https://photon.komoot.io/api/"
CACHE_TTL = 24 * 3600
CACHE_MAX = 500
_cache: dict[tuple[str, bool], tuple[float, list[dict]]] = {}
_client: httpx.AsyncClient | None = None

# Areas first on Explore: a country, then a region, then a city, then a
# district such as Gion; streets, buildings and landmarks last.
AREA_RANK = {"country": 0, "state": 1, "region": 1, "city": 2, "town": 2, "county": 3,
             "district": 3, "locality": 3, "suburb": 3, "village": 3}


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=6, headers=HEADERS)
    return _client


def _photon_place(f: dict) -> dict | None:
    """One Photon feature -> {label, detail, lat, lon, bbox, kind}."""
    p = f.get("properties") or {}
    coords = (f.get("geometry") or {}).get("coordinates") or []
    if len(coords) != 2:
        return None
    kind = p.get("type") or p.get("osm_value")
    parts = []
    for v in (p.get("name"), p.get("district") or p.get("locality"), p.get("city"), p.get("state"), p.get("country")):
        if v and v not in parts:
            parts.append(v)
    # Short: the place and what it sits in, two or three names at most.
    label = ", ".join(parts[:2] if kind in ("country", "state") else parts[:3]) or None
    ext = p.get("extent")  # [west, north, east, south]
    bbox = [ext[3], ext[1], ext[0], ext[2]] if isinstance(ext, list) and len(ext) == 4 else None
    return {"label": label, "detail": ", ".join(parts), "lat": float(coords[1]), "lon": float(coords[0]),
            "bbox": bbox, "kind": kind}


async def _photon(q: str) -> list[dict] | None:
    try:
        resp = await _http().get(PHOTON_URL, params={"q": q, "limit": 8, "lang": "en"})
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None
    places = [x for x in (_photon_place(f) for f in resp.json().get("features") or []) if x and x["label"]]
    # The same name twice (Photon lists a city and its boundary): keep one.
    seen, out = set(), []
    for x in places:
        if x["label"] not in seen:
            seen.add(x["label"])
            out.append(x)
    return out


async def _nominatim(q: str) -> list[dict] | None:
    try:
        resp = await _http().get(f"{NOMINATIM_BASE}/search", params={
            "q": q, "format": "jsonv2", "limit": 5, "accept-language": "en", "addressdetails": 1})
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None
    out = []
    for r in resp.json():
        try:
            s, n, w, e = (float(v) for v in r.get("boundingbox") or [])
            bbox = [s, n, w, e]
        except (TypeError, ValueError):
            bbox = None
        out.append({"label": short_label(r), "detail": r["display_name"], "lat": float(r["lat"]),
                    "lon": float(r["lon"]), "bbox": bbox, "kind": r.get("addresstype") or r.get("type")})
    return out


async def search_places(q: str, areas_first: bool = False) -> list[dict] | None:
    """Up to 5 places for a search text; None when no service answers."""
    key = (" ".join(q.lower().split()), areas_first)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    places = await _photon(q)
    if places is None:
        places = await _nominatim(q)
    if places is None:
        return None
    if areas_first:
        places = sorted(places, key=lambda x: AREA_RANK.get(x.get("kind"), 9))  # stable: the service's order within a rank
    places = places[:5]
    if len(_cache) >= CACHE_MAX:
        _cache.pop(next(iter(_cache)))
    _cache[key] = (time.time(), places)
    return places
