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
from fastapi.staticfiles import StaticFiles

from config import ALLOWED_ORIGINS, ALLOWED_ORIGIN_REGEX, DEBUG
from app.core.debug import DebugTrafficMiddleware
# One folder per feature under app/features/ (router, service, schemas,
# prompts); shared code in app/core/.
from app.features.scene_analysis import router as scene_analysis
from app.features.persona import router as persona
from app.features.critique_agent import router as critique
from app.features.help_quest import router as help_quest
from app.features.sketches import router as sketches
from app.features.profile import router as profile
from app.features.geocode import router as geocode

app = FastAPI(title="SketchConnect middle server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
)

# DEBUG=true in .env: print every browser request and every response in
# the terminal (app/core/debug.py). Added last, so it sits outermost.
if DEBUG:
    app.add_middleware(DebugTrafficMiddleware)

UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.include_router(scene_analysis.router)
app.include_router(persona.router)
app.include_router(critique.router)
app.include_router(help_quest.router)
app.include_router(sketches.router)
app.include_router(profile.router)
app.include_router(geocode.router)


@app.get("/health")
def health():
    return {"status": "ok"}
