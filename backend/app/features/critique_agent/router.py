"""
Critique agent call (schema: gemini_call_schemas.md #3) -- HTTP layer.

Runs in the background. It starts on its own when the sketcher uploads a
final sketch (POST /api/sketches/{id}/final-sketch), or on demand via
POST /api/critique (e.g. a retry after a failure). The frontend polls the
sketch's `critique_status` ('pending' | 'done' | 'failed') for the result.

What the call reads and sends, and its prompt, are in features/critique_agent/service.py
and prompts/critique_agent.md.
"""
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.auth import get_current_sketcher_id
from app.core.models import Sketch
from app.features.critique_agent.service import run_critique

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["critique"])


def start_critique(db: Session, sketch: Sketch, background_tasks: BackgroundTasks) -> None:
    """Mark the sketch as pending and queue the critique call."""
    sketch.critique_status = "pending"
    db.commit()
    background_tasks.add_task(_run_critique_in_background, sketch.id)


def _run_critique_in_background(sketch_id: str) -> None:
    """
    Runs after the response is sent, in FastAPI's threadpool (plain def).
    Opens its own DB session, since the request's session is already closed.
    """
    db = SessionLocal()
    try:
        sketch = db.query(Sketch).filter(Sketch.id == sketch_id).first()
        if sketch is None:
            return  # deleted while queued
        try:
            run_critique(db, sketch)
            sketch.critique_status = "done"
        except Exception:
            logger.exception("Critique call failed for sketch %s", sketch_id)
            db.rollback()
            sketch.critique_status = "failed"
        db.commit()
    finally:
        db.close()


@router.post("/critique")
async def critique(
    background_tasks: BackgroundTasks,
    sketch_id: str = Form(...),
    db: Session = Depends(get_db),
    sketcher_id: str = Depends(get_current_sketcher_id),
):
    """Start (or retry) the critique call for a sketch. Returns right away."""
    sketch = db.query(Sketch).filter(
        Sketch.id == sketch_id, Sketch.sketcher_id == sketcher_id
    ).first()
    if sketch is None:
        raise HTTPException(404, "Sketch not found")
    if sketch.critique_status == "pending":
        return {"critique_status": "pending"}
    start_critique(db, sketch, background_tasks)
    return {"critique_status": "pending"}
