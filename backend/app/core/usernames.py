"""
Sketcher usernames: the short address of a sketcher page, /@username (design
doc, item 36). Every profile gets one, made from the display name (or the
email before the @) the first time the profile is read, and the sketcher
can change it in Edit Profile.

A username is 3 to 30 characters: lowercase letters, numbers, dots and
underscores, starting with a letter or number. A few words the app uses
as page names are reserved.
"""
import re
import unicodedata

from sqlalchemy.orm import Session

USERNAME = re.compile(r"^[a-z0-9][a-z0-9._]{2,29}$")
RESERVED = {
    "admin", "api", "capture", "edit", "explore", "help", "kit", "login",
    "logout", "me", "profile", "register", "search", "settings", "sketch",
    "sketchconnect", "sketcher", "sketchers", "sketches", "support", "uploads",
    "workshops",
}
MIN_LEN, MAX_LEN = 3, 30


def slugify(text: str | None) -> str:
    """A username-shaped version of a name: 'Ping Kong' -> 'pingkong'."""
    ascii_text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9._]", "", ascii_text.lower())
    slug = slug.lstrip("._")[:MAX_LEN]
    return slug


def problem(username: str) -> str | None:
    """Why a username the sketcher typed can't be used, or None when it can."""
    if not USERNAME.match(username):
        return "Use 3 to 30 lowercase letters, numbers, dots or underscores, starting with a letter or number."
    if username in RESERVED:
        return f'"{username}" is reserved. Try another.'
    return None


def is_taken(db: Session, username: str, except_id: str | None = None) -> bool:
    from app.core.models import Profile  # avoid an import cycle with models
    q = db.query(Profile).filter(Profile.username == username)
    if except_id:
        q = q.filter(Profile.id != except_id)
    return db.query(q.exists()).scalar()


def make_unique(db: Session, base: str, except_id: str | None = None) -> str:
    """A free username from `base`: 'pingkong', then 'pingkong2', 'pingkong3'..."""
    base = slugify(base)
    if len(base) < MIN_LEN or base in RESERVED:
        base = (base + "sketcher")[:MAX_LEN] if len(base) < MIN_LEN else base + "_"
    candidate, n = base, 1
    while is_taken(db, candidate, except_id) or problem(candidate):
        n += 1
        suffix = str(n)
        candidate = base[: MAX_LEN - len(suffix)] + suffix
    return candidate
