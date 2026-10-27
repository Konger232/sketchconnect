"""
SketchConnect middle server.

Current architecture (ai_sketch_mentor_design_doc.md): three scoped,
on-demand Gemini calls plus persona creation, profile CRUD, and plain
sketch CRUD, all returning structured JSON so the frontend can highlight
specific spots on the photo rather than parsing narrative text.

The Phase-0 OpenCV prototype this server used to also expose under /legacy
(deterministic perspective/value-study, no AI) has been fully superseded --
perspective lines by Gemini's real traced-line detection in
features/scene_analysis/, value-study by app/core/value_study.py -- and was
removed along with its endpoints (see parking-lot.md).
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import ALLOWED_ORIGINS, ALLOWED_ORIGIN_REGEX, DEBUG
from app.core.debug import DebugTrafficMiddleware
from app.core import media
# One folder per feature under app/features/ (router, service, schemas,
# prompts); shared code in app/core/.
from app.features.scene_analysis import router as scene_analysis
from app.features.marks_analysis import router as marks_analysis
from app.features.persona import router as persona
from app.features.critique_agent import router as critique
from app.features.help_quest import router as help_quest
from app.features.sketches import router as sketches
from app.features.profile import router as profile
from app.features.geocode import router as geocode
from app.features.kit import router as kit
from app.features.paints import router as paints
from app.features.events import router as events
from app.features.spots import router as spots
from app.features.sketchers import router as sketchers
from app.features.community import router as community

app = FastAPI(title="SketchConnect middle server")


@app.on_event("startup")
def warm_up() -> None:
    """Best effort, in the background: fetch Supabase's signing keys and open
    a few database connections, so the first requests after a restart do not
    pay for the TLS handshakes (each is several round trips to the database
    region)."""
    import threading

    def run():
        from sqlalchemy import text
        from app.core.auth import warm_jwks
        from app.core.database import engine
        try:
            warm_jwks()
        except Exception as exc:  # noqa: BLE001 - a warm-up must never stop the server
            print(f"warm-up: signing keys not fetched ({exc.__class__.__name__})")
        if engine is None:
            return
        conns = []
        try:
            for _ in range(4):
                c = engine.connect()
                c.execute(text("select 1"))
                conns.append(c)
        except Exception as exc:  # noqa: BLE001
            print(f"warm-up: database not reached ({exc.__class__.__name__})")
        finally:
            for c in conns:
                c.close()  # back to the pool, still open

    threading.Thread(target=run, daemon=True).start()

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Images: "/uploads/<file>" in API responses becomes a signed, expiring
# /media link for a signed-in sketcher, or a /teaser link for a visitor
# (app/core/media.py).
app.add_middleware(media.MediaLinkMiddleware)

# DEBUG=true in .env: print every browser request and every response in
# the terminal (app/core/debug.py). Added last, so it sits outermost.
if DEBUG:
    app.add_middleware(DebugTrafficMiddleware)

# The uploads folder is not served as is: images go out through
# /media (signed-in sketchers) and /teaser (visitors) only.
UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
app.include_router(media.router)

app.include_router(scene_analysis.router)
app.include_router(marks_analysis.router)
app.include_router(persona.router)
app.include_router(critique.router)
app.include_router(help_quest.router)
app.include_router(sketches.router)
app.include_router(profile.router)
app.include_router(geocode.router)
app.include_router(kit.router)
app.include_router(paints.router)
app.include_router(events.router)
app.include_router(spots.router)
app.include_router(sketchers.router)
app.include_router(community.router)


@app.get("/health")
def health():
    return {"status": "ok"}
