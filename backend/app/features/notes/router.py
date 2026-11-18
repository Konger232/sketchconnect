"""
The sketcher's own notes on a sketch (November 18, 2026): voice notes and
short clips recorded on location, for what a sketch and a photo can't hold
(the noise, the people, the light changing, a thought).

Only the sketcher sees them. They are never shared, never on the public
page, and not part of the critique. Files live in storage (core/storage.py)
like the photos, and are sent only to their owner, through this router.

  GET    /api/sketches/<id>/notes        the notes, oldest first
  POST   /api/sketches/<id>/notes        upload one (multipart: kind, file, duration_s)
  GET    /api/notes/<note id>/file       the recording itself
  PATCH  /api/notes/<note id>            fix the text version
  DELETE /api/notes/<note id>            delete the note and its file

A voice note gets a text version: the voice note transcription call sends
the recording to Gemini in the background (prompts/transcribe.md).
"""
import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import storage
from app.core.auth import get_current_sketcher_id
from app.core.database import SessionLocal, get_db
from app.core.models import Sketch, SketchNote
from app.core.prompt_loader import render_prompt

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["notes"])

PROMPTS = __import__("pathlib").Path(__file__).parent / "prompts"
MAX_BYTES = {"voice": 15 * 1024 * 1024, "clip": 28 * 1024 * 1024}  # under Cloud Run's 32 MB a request
MAX_SECONDS = {"voice": 5 * 60, "clip": 30}
EXT = {"audio/mp4": "m4a", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav",
       "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"}


def _out(n: SketchNote) -> dict:
    return {
        "id": n.id, "kind": n.kind, "content_type": n.content_type, "duration_s": n.duration_s,
        "size_bytes": n.size_bytes, "transcript": n.transcript, "transcript_status": n.transcript_status,
        "created_at": n.created_at.isoformat() + "Z" if n.created_at else None,
    }


def _my_sketch(db: Session, sketch_id: str, me: str) -> Sketch:
    s = db.query(Sketch).filter(Sketch.id == sketch_id, Sketch.sketcher_id == me).first()
    if s is None:
        raise HTTPException(404, "Sketch not found")
    return s


def _my_note(db: Session, note_id: str, me: str) -> SketchNote:
    n = db.query(SketchNote).filter(SketchNote.id == note_id, SketchNote.sketcher_id == me).first()
    if n is None:
        raise HTTPException(404, "Note not found")
    return n


@router.get("/sketches/{sketch_id}/notes")
def list_notes(sketch_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    _my_sketch(db, sketch_id, me)
    rows = db.query(SketchNote).filter(SketchNote.sketch_id == sketch_id).order_by(SketchNote.created_at.asc()).all()
    return [_out(n) for n in rows]


@router.post("/sketches/{sketch_id}/notes")
async def add_note(
    sketch_id: str,
    background_tasks: BackgroundTasks,
    kind: str = Form(...),
    duration_s: int | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    me: str = Depends(get_current_sketcher_id),
):
    if kind not in ("voice", "clip"):
        raise HTTPException(400, "A note is a voice note or a clip.")
    _my_sketch(db, sketch_id, me)
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    want = "audio/" if kind == "voice" else "video/"
    if not content_type.startswith(want) and not (kind == "voice" and content_type == "video/mp4"):
        raise HTTPException(400, "That file is not a recording of the right kind.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "The recording is empty.")
    if len(data) > MAX_BYTES[kind]:
        raise HTTPException(413, "The recording is too large." if kind == "voice" else "The clip is too large. Keep it under 30 seconds.")
    if duration_s is not None:
        duration_s = max(0, min(int(duration_s), MAX_SECONDS[kind] + 5))
    name = f"note_{uuid.uuid4()}.{EXT.get(content_type, 'bin')}"
    from starlette.concurrency import run_in_threadpool
    await run_in_threadpool(storage.save_bytes, name, data, content_type)
    note = SketchNote(sketch_id=sketch_id, sketcher_id=me, kind=kind, file_name=name, content_type=content_type,
                      duration_s=duration_s, size_bytes=len(data),
                      transcript_status="pending" if kind == "voice" else None)
    db.add(note)
    db.commit()
    db.refresh(note)
    if kind == "voice":
        background_tasks.add_task(_transcribe_in_background, note.id)
    return _out(note)


@router.get("/notes/{note_id}/file")
def note_file(note_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    n = _my_note(db, note_id, me)
    path = storage.fetch(n.file_name)
    if path is None:
        raise HTTPException(404, "The recording is missing.")
    return FileResponse(path, media_type=n.content_type, headers={"Cache-Control": "private, max-age=3600"})


class NoteUpdate(BaseModel):
    transcript: str


@router.patch("/notes/{note_id}")
def update_note(note_id: str, body: NoteUpdate, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    n = _my_note(db, note_id, me)
    n.transcript = body.transcript.strip()[:20000]
    n.transcript_status = "done"
    db.commit()
    return _out(n)


@router.delete("/notes/{note_id}")
def delete_note(note_id: str, db: Session = Depends(get_db), me: str = Depends(get_current_sketcher_id)):
    n = _my_note(db, note_id, me)
    storage.delete(n.file_name)
    db.delete(n)
    db.commit()
    return {"deleted": True}


def delete_sketch_notes(db: Session, sketch_id: str) -> None:
    """The notes' files, when their sketch is deleted (the rows go with it)."""
    for (name,) in db.query(SketchNote.file_name).filter(SketchNote.sketch_id == sketch_id).all():
        storage.delete(name)


# ---- the voice note transcription call ----

def transcribe(data: bytes, content_type: str) -> str:
    """The sketcher's words in a voice note, as text (Gemini)."""
    import google.generativeai as genai
    from app.core.gemini_service import USE_MOCK_GEMINI, _configure
    from config import GEMINI_MODEL
    if USE_MOCK_GEMINI:
        return "(A mock text version of the voice note.)"
    _configure()
    model = genai.GenerativeModel(GEMINI_MODEL)
    response = model.generate_content([render_prompt(PROMPTS / "transcribe.md"), {"mime_type": content_type, "data": data}])
    return (response.text or "").strip()


def _transcribe_in_background(note_id: str) -> None:
    """After the upload answers, in FastAPI's threadpool, with its own session."""
    db = SessionLocal()
    try:
        n = db.get(SketchNote, note_id)
        if n is None:
            return  # deleted meanwhile
        try:
            path = storage.fetch(n.file_name)
            n.transcript = transcribe(path.read_bytes(), n.content_type) if path else None
            n.transcript_status = "done" if path else "failed"
        except Exception:
            logger.exception("Voice note transcription failed for note %s", note_id)
            db.rollback()
            n = db.get(SketchNote, note_id)
            if n is not None:
                n.transcript_status = "failed"
        db.commit()
    finally:
        db.close()
