"""
SQLAlchemy models for the tables described in ai_sketch_mentor_design_doc.md.

`sketchers` is not modeled here: Supabase Auth already owns that identity
in its own auth.users table. Every table below keys off `sketcher_id`, a
UUID that matches auth.uid() from the verified JWT (see app/auth.py) — no
local users table to keep in sync.
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Boolean, JSON, Integer
from sqlalchemy.dialects.postgresql import UUID
from geoalchemy2 import Geography

from .database import Base


def gen_uuid():
    return str(uuid.uuid4())


class Sketch(Base):
    """
    Created immediately at photo upload (design doc, Section 5, step 1),
    not later at final save. `location`/`captured_at` are populated from
    EXIF when available and stay nullable otherwise.
    """
    __tablename__ = "sketches"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    sketcher_id = Column(UUID(as_uuid=False), nullable=False, index=True)

    title = Column(String, nullable=True)
    field_notes = Column(Text, nullable=True)

    style = Column(String, nullable=True)  # ink_and_wash | realistic | minimalist | reportage
    scene_type = Column(String, nullable=True)
    # Full scene-analysis response (scene_summary, focal_regions,
    # perspective_lines, prepared_prompts, debug_raw_gemini_response),
    # cached verbatim the first time Gemini computes it for this sketch.
    # The photo and crop_transform can never change after creation
    # (sketches.py has no route that edits either), so the only thing
    # that can make a cached analysis stale is a different `style` --
    # scene_analysis.py's endpoint reuses this instead of re-calling
    # Gemini whenever the requested style still matches `style` above.
    # Null until the first successful analysis.
    cached_scene_analysis = Column(JSON, nullable=True)

    reference_image_url = Column(String, nullable=True)
    final_sketch_url = Column(String, nullable=True)
    final_sketch_provided = Column(Boolean, default=False)

    # geography(Point, 4326) — see design doc, Section 3 "Location capture"
    location = Column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    captured_at = Column(DateTime, nullable=True)  # from EXIF, not upload time

    # Untouched upload, kept alongside reference_image_url once the
    # sketcher crops/pans/zooms it (CapturePage.jsx's CropFrame) -- not
    # read anywhere yet, but keeps the door open for a future re-crop
    # feature instead of forcing a re-upload from the phone.
    original_image_url = Column(String, nullable=True)
    # { aspect_ratio, offset_x, offset_y, zoom } from cropMath.js, exactly
    # as the sketcher set it -- kept as explicit, queryable data (not just
    # implicit in the baked pixels) since what someone chose to zoom into
    # or crop out is itself a signal of what caught their attention. Null
    # when the sketcher didn't touch the crop (reference_image_url is then
    # just the original, unmodified).
    crop_transform = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


class Persona(Base):
    """
    One admired-artist persona per (sketcher, style). Regenerated only when
    the sketcher edits their admired artist in settings — never per-critique
    (design doc, "Persona generation and caching").
    """
    __tablename__ = "personas"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    sketcher_id = Column(UUID(as_uuid=False), nullable=False, index=True)
    style = Column(String, nullable=False)

    admired_artist_name = Column(String, nullable=True)
    persona_source = Column(String, nullable=False)  # sketcher_provided | system_default
    persona_label = Column(String, nullable=False)
    voice = Column(String, nullable=False)
    priorities = Column(JSON, nullable=False, default=list)
    tone = Column(String, nullable=False)

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class HelpQuestLog(Base):
    """One row per Help Quest question/answer (design doc, "History and storage")."""
    __tablename__ = "help_quest_log"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    sketch_id = Column(UUID(as_uuid=False), ForeignKey("sketches.id"), nullable=False, index=True)
    sketcher_id = Column(UUID(as_uuid=False), nullable=False, index=True)

    step_id = Column(String, nullable=False)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    principle_reference = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


class CritiqueResponse(Base):
    """
    One row per Critique Agent call (design doc: "Each call's response is
    stored as its own row"). `decision_trace` stays persona-free JSON so
    longitudinal tracking doesn't drift with tone tuning.
    """
    __tablename__ = "critique_responses"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    sketch_id = Column(UUID(as_uuid=False), ForeignKey("sketches.id"), nullable=False, index=True)
    sketcher_id = Column(UUID(as_uuid=False), nullable=False, index=True)

    decision_trace = Column(JSON, nullable=False, default=dict)
    critique = Column(Text, nullable=False)
    prior_review_summary = Column(Text, nullable=True)
    final_sketch_provided = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)


class Profile(Base):
    """
    Lightweight app-level profile row, keyed to Supabase's auth.users.id.
    `location` is the sketcher's own general location (e.g. "Portland, OR"),
    not tied to any one sketch -- distinct from Sketch.location, which is a
    specific sketch's GPS point. No auto-create trigger on auth.users yet,
    so app/routers/profile.py upserts a bare row on first GET rather than
    assuming one already exists.
    """
    __tablename__ = "profiles"

    id = Column(UUID(as_uuid=False), primary_key=True)  # == auth.uid()
    display_name = Column(String, nullable=True)
    avatar_url = Column(String, nullable=True)
    location = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
