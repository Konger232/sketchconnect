"""Where uploaded images live.

Local development keeps them in backend/uploads. With STORAGE_BUCKET set,
they live in a private Supabase Storage bucket, reached with the
backend's secret key (SUPABASE_SECRET_KEY). Either way the database keeps
"/uploads/<file>": only this module knows where the bytes are.

With the bucket, reads are kept in a scratch folder on the server's own
disk, so the display copies, the AI calls and the critique don't fetch the
same image twice. That folder can vanish at any restart; the bucket is the
record. Images still go out only through media.py's signed links and
teasers: the bucket itself is never public.
"""
import io
import os
import tempfile
import uuid
from pathlib import Path

import httpx
from PIL import Image
from starlette.concurrency import run_in_threadpool

import config  # noqa: F401  (loads backend/.env before the reads below)
from app.core.paths import UPLOAD_DIR

BUCKET = os.environ.get("STORAGE_BUCKET", "").strip()
REMOTE = bool(BUCKET)
_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
_KEY = os.environ.get("SUPABASE_SECRET_KEY", "").strip()

CACHE = (Path(os.environ.get("STORAGE_CACHE_DIR") or Path(tempfile.gettempdir()) / "sketchconnect-images")
         if REMOTE else UPLOAD_DIR)
CACHE.mkdir(parents=True, exist_ok=True)

_client: httpx.Client | None = None


def _http() -> httpx.Client:
    global _client
    if _client is None:
        if not (_URL and _KEY):
            raise RuntimeError("STORAGE_BUCKET is set, but SUPABASE_URL or SUPABASE_SECRET_KEY is missing.")
        headers = {"apikey": _KEY}
        if _KEY.startswith("eyJ"):  # the older service_role key is a JWT
            headers["Authorization"] = f"Bearer {_KEY}"
        _client = httpx.Client(base_url=f"{_URL}/storage/v1", headers=headers, timeout=30)
    return _client


def name_of(url: str) -> str:
    """"/uploads/<file>" (or a bare file name) -> "<file>". Drops any folder,
    so nothing outside the store can be named."""
    return Path(url).name


def _local(name: str) -> Path:
    return CACHE / name_of(name)


def _write_local(name: str, data: bytes) -> Path:
    path = _local(name)
    tmp = path.parent / f"{path.name}.{uuid.uuid4().hex}.part"
    tmp.write_bytes(data)
    tmp.replace(path)
    return path


def save_bytes(name: str, data: bytes, content_type: str = "image/jpeg") -> str:
    """Store one file; returns the "/uploads/<file>" the database keeps."""
    name = name_of(name)
    if REMOTE:
        r = _http().post(f"/object/{BUCKET}/{name}", content=data,
                         headers={"Content-Type": content_type, "x-upsert": "true"})
        r.raise_for_status()
    _write_local(name, data)
    return f"/uploads/{name}"


def save_image(img: Image.Image, name: str, quality: int = 90, **options) -> str:
    """Store a PIL image as a JPEG."""
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, **options)
    return save_bytes(name, buf.getvalue())


async def save_image_async(img: Image.Image, name: str, quality: int = 90, **options) -> str:
    """save_image, off the event loop (for async endpoints)."""
    return await run_in_threadpool(save_image, img, name, quality, **options)


def fetch(url: str | None) -> Path | None:
    """The file on this server's disk (downloaded once from the bucket),
    or None when it isn't stored."""
    if not url:
        return None
    path = _local(url)
    if path.exists():
        return path
    if not REMOTE:
        return None
    r = _http().get(f"/object/authenticated/{BUCKET}/{name_of(url)}")
    if r.status_code in (400, 404):  # Supabase answers 400 for a missing file
        return None
    r.raise_for_status()
    return _write_local(url, r.content)


def exists(url: str | None) -> bool:
    return fetch(url) is not None


def open_image(url: str | None) -> Image.Image | None:
    """Open a stored image, or None when it isn't stored."""
    path = fetch(url)
    return Image.open(path) if path else None


def delete(url: str | None) -> None:
    """Best effort: the file and the display and teaser copies media.py made
    of it. A file already gone is not an error."""
    if not url:
        return
    name = name_of(url)
    stem = name.rsplit(".", 1)[0]
    names = [name, f"{stem}.display.jpg", f"{stem}.teaser.jpg"]
    for n in names:
        try:
            _local(n).unlink(missing_ok=True)
        except OSError:
            pass
    if REMOTE:
        try:
            _http().request("DELETE", f"/object/{BUCKET}", json={"prefixes": names})
        except httpx.HTTPError:
            pass


def list_names(prefix: str) -> list[str]:
    """Stored file names that start with prefix (the seed tool's cleanup)."""
    if not REMOTE:
        return sorted(p.name for p in UPLOAD_DIR.glob(f"{prefix}*"))
    names, offset = [], 0
    while True:
        r = _http().post(f"/object/list/{BUCKET}",
                         json={"prefix": "", "search": prefix, "limit": 1000, "offset": offset})
        r.raise_for_status()
        page = [o["name"] for o in r.json() if o.get("name", "").startswith(prefix)]
        names += page
        if len(r.json()) < 1000:
            return names
        offset += 1000
