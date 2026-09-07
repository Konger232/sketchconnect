"""
SketchConnect middle server.

Current architecture (ai_sketch_mentor_design_doc.md): three scoped,
on-demand Gemini calls plus persona creation, profile CRUD, and plain
sketch CRUD, all returning structured JSON so the frontend can highlight
specific spots on the photo rather than parsing narrative text.

The Phase-0 OpenCV prototype (deterministic perspective/value-study,
no AI) lives on under /legacy -- preserved for reference, not part of the
current design.
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import ALLOWED_ORIGINS
from app.routers import scene_analysis, persona, critique, help_quest, sketches, profile, geocode
from legacy.perspective_analyze import router as legacy_router

app = FastAPI(title="SketchConnect middle server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
app.include_router(legacy_router, prefix="/legacy", tags=["legacy"])


@app.get("/health")
def health():
    return {"status": "ok"}
