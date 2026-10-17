"""
Sketcher handles: the short address of a sketcher page, /@handle (design
doc, item 36). Every profile gets one, made from the display name (or the
email before the @) the first time the profile is read, and the sketcher
can change it in Edit Profile.

A handle is 3 to 30 characters: lowercase letters, numbers, dots and
underscores, starting with a letter or number. A few words the app uses
as page names are reserved.
"""
import re
import unicodedata

from sqlalchemy.orm import Session

HANDLE = re.compile(r"^[a-z0-9][a-z0-9._]{2,29}$")
RESERVED = {
    "admin", "api", "capture", "edit", "explore", "help", "kit", "login",
    "logout", "me", "profile", "register", "search", "settings", "sketch",
    "sketchconnect", "sketcher", "sketchers", "sketches", "support", "uploads",
    "workshops",
}
MIN_LEN, MAX_LEN = 3, 30


def slugify(text: str | None) -> str:
    """A handle-shaped version of a name: 'Ping Kong' -> 'pingkong'."""
    ascii_text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9._]", "", ascii_text.lower())
    slug = slug.lstrip("._")[:MAX_LEN]
    return slug


def problem(handle: str) -> str | None:
    """Why a handle the sketcher typed can't be used, or None when it can."""
    if not HANDLE.match(handle):
        return "Use 3 to 30 lowercase letters, numbers, dots or underscores, starting with a letter or number."
    if handle in RESERVED:
        return f'"{handle}" is reserved. Try another.'
    return None


def is_taken(db: Session, handle: str, except_id: str | None = None) -> bool:
    from app.core.models import Profile  # avoid an import cycle with models
    q = db.query(Profile).filter(Profile.handle == handle)
    if except_id:
        q = q.filter(Profile.id != except_id)
    return db.query(q.exists()).scalar()


def make_unique(db: Session, base: str, except_id: str | None = None) -> str:
    """A free handle from `base`: 'pingkong', then 'pingkong2', 'pingkong3'..."""
    base = slugify(base)
    if len(base) < MIN_LEN or base in RESERVED:
        base = (base + "sketcher")[:MAX_LEN] if len(base) < MIN_LEN else base + "_"
    candidate, n = base, 1
    while is_taken(db, candidate, except_id) or problem(candidate):
        n += 1
        suffix = str(n)
        candidate = base[: MAX_LEN - len(suffix)] + suffix
    return candidate
