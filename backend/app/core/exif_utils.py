"""
Server-side EXIF extraction (design doc, Section 3, "Location capture").
Runs at upload time, before the scene analysis call fires, and never
depends on browser EXIF support — React stays scoped to capture-and-display.
Both fields stay nullable: not every photo carries GPS (privacy settings,
camera type, screenshots).
"""
from datetime import datetime
from typing import Optional
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS


def _convert_to_degrees(value):
    d, m, s = value
    return float(d) + float(m) / 60.0 + float(s) / 3600.0


def extract_location_and_time(pil_image: Image.Image) -> tuple[Optional[dict], Optional[datetime]]:
    """Returns ({"lat": .., "lon": ..} or None, captured_at datetime or None)."""
    try:
        exif = pil_image.getexif()
        if not exif:
            return None, None
    except Exception:
        return None, None

    tags = {TAGS.get(k, k): v for k, v in exif.items()}

    captured_at = None
    for key in ("DateTimeOriginal", "DateTime"):
        raw = tags.get(key)
        if raw:
            try:
                captured_at = datetime.strptime(raw, "%Y:%m:%d %H:%M:%S")
                break
            except ValueError:
                continue

    location = None
    gps_ifd = exif.get_ifd(0x8825) if hasattr(exif, "get_ifd") else tags.get("GPSInfo")
    if gps_ifd:
        gps = {GPSTAGS.get(k, k): v for k, v in gps_ifd.items()}
        lat = gps.get("GPSLatitude")
        lat_ref = gps.get("GPSLatitudeRef")
        lon = gps.get("GPSLongitude")
        lon_ref = gps.get("GPSLongitudeRef")
        if lat and lon and lat_ref and lon_ref:
            lat_deg = _convert_to_degrees(lat)
            lon_deg = _convert_to_degrees(lon)
            if lat_ref != "N":
                lat_deg = -lat_deg
            if lon_ref != "E":
                lon_deg = -lon_deg
            location = {"lat": lat_deg, "lon": lon_deg}

    return location, captured_at
