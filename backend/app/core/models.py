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

from app.core.database import Base


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
    # perspective, prepared_prompts, debug_raw_gemini_response, plan_fingerprint),
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
    # Critique call progress: None (never run) | 'pending' | 'done' | 'failed'.
    # Set by features/critique_agent/router.py, polled by EditSketch.jsx.
    critique_status = Column(String, nullable=True)

    # geography(Point, 4326) — see design doc, Section 3 "Location capture"
    location = Column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    # Human-readable "City, Country" for `location` above -- set once,
    # either from Gemini's own reading of the EXIF coordinates (scene_
    # analysis.py, when the sketch doesn't have a location yet) or from
    # whichever search result the sketcher picked in the location field
    # (sketches.py's update_sketch). Cleared alongside `location` whenever
    # that's explicitly cleared. Deliberately stored rather than resolved
    # live on every read -- see LocationSearchField.jsx.
    location_label = Column(String, nullable=True)
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

    # One entry per confirmed focal point once the sketcher has been
    # through FocalFrameEditor.jsx (mark, then frame-refine) in the sketch
    # flow: [{x, y, source, region_ref, paired_label, paired_region_ref,
    # pairing_method, pairing_distance}, ...], schemas.PairedFocalPoint's
    # own shape, x/y normalized against whatever frame reference_image_url
    # currently shows (so this stays valid even if a later pass re-crops
    # and reprojects every point into the new frame -- see
    # features/sketches/router.py's focal_frame endpoint). Null until that flow has
    # been completed at least once for this sketch.
    focal_points = Column(JSON, nullable=True)
    # The sketcher's planning marks (Marks.jsx): freehand lines
    # drawn over the framed photo, [{color, width, points: [[x, y], ...]}]
    # in the same 0-1000 frame space as focal_points. Kept as data rather
    # than baked into reference_image_url so scene analysis sees a clean
    # photo; coaching calls can render them onto a composite when needed.
    marks = Column(JSON, nullable=True)
    # Guided-question answers, one {prompt, response} per pick, appended
    # by POST /api/sketches/{id}/session-choices. Read by the critique call.
    session_choices = Column(JSON, nullable=True)
    # Whose voice gives this sketch's feedback: one of the sketcher's
    # admired sketchers (design doc, item 36), picked with the final
    # sketch. Null falls back to the style's persona, then a default coach.
    persona_id = Column(UUID(as_uuid=False), ForeignKey("personas.id", ondelete="SET NULL"), nullable=True)
    # Closest paints, as pigment codes (design doc, item 28): `scene` from
    # the reference photo, `sketch` from the final sketch. The sketcher can
    # correct the sketch's list by hand on the sketch page.
    palettes = Column(JSON, nullable=True)
    # The Value and Color tabs (design doc, item 37): how many values the
    # value study uses, and the gamut mask ({"corners": [{h, c, paint_id}]}).
    value_levels = Column(Integer, nullable=True)
    gamut_mask = Column(JSON, nullable=True)
    # Who sees the shared sketch: members | followers | private
    # (app/core/visibility.py). And whether the sketcher Glazed the final.
    visibility = Column(String, nullable=False, default="members", server_default="members")
    glazed = Column(Boolean, nullable=False, default=False, server_default="false")
    # The style the coach saw in the final sketch, and the sketcher's answer:
    # None not answered, True agreed, False changed it (then `style` holds
    # their pick). Design doc, item 39.
    style_detected = Column(String, nullable=True)
    style_confirmed = Column(Boolean, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Persona(Base):
    """
    A critique persona, made once and reused (design doc, "Persona
    generation and caching"). Since October 17, 2026 (item 36), one per
    admired sketcher on the sketcher's list, with `style` null. Rows with a
    style are the older one-per-style personas and the style defaults,
    kept so older sketches still get their voice.
    """
    __tablename__ = "personas"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    sketcher_id = Column(UUID(as_uuid=False), nullable=False, index=True)
    style = Column(String, nullable=True)

    admired_artist_name = Column(String, nullable=True)
    persona_source = Column(String, nullable=False)  # sketcher_provided | system_default
    persona_label = Column(String, nullable=False)
    # For a name on the admired list: a link to their page and where they
    # sketch, shown on the sketcher page (item 36).
    admired_link = Column(String, nullable=True)
    admired_location = Column(String, nullable=True)
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
    so app/features/profile/router.py upserts a bare row on first GET rather than
    assuming one already exists.
    """
    __tablename__ = "profiles"

    id = Column(UUID(as_uuid=False), primary_key=True)  # == auth.uid()
    display_name = Column(String, nullable=True)
    avatar_url = Column(String, nullable=True)
    location = Column(String, nullable=True)
    # The sketcher page (design doc, item 36): its address (/@username), a
    # short self-introduction, links to their social pages, up to 6 pinned
    # sketches, and the photo of their kit (item 28).
    username = Column(String, nullable=True, unique=True)
    bio = Column(Text, nullable=True)
    links = Column(JSON, nullable=True)
    featured_sketch_ids = Column(JSON, nullable=True)
    kit_photo_url = Column(String, nullable=True)  # the first bag photo, before kit_photos
    # What's in my bag: up to 3 photos, "/uploads/<file>" (design doc, item 44).
    kit_photos = Column(JSON, nullable=True)
    # My favorite palette: pigment codes, in the paint editor (item 36).
    favorite_paints = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class KitItem(Base):
    """
    One tool in a sketcher's bag (design doc, items 28 and 44): a category
    from a fixed list, a name, an optional short tip and link, and its pin
    on a bag photo. Paints are not here: they are My palette
    (profiles.favorite_paints). `source` is `own` for one the sketcher added,
    `ai` for one the kit reading call found.
    """
    __tablename__ = "kit_items"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    sketcher_id = Column(UUID(as_uuid=False), nullable=False, index=True)

    # pen | ink | brush | paper | sketchbook | palette | clips | easel | bag | other
    category = Column(String, nullable=False)
    label = Column(String, nullable=False)
    note = Column(String, nullable=True)   # a short tip: "extra fine nib"
    link = Column(String, nullable=True)   # where to buy it, from the sketcher
    # Where the tool sits on a bag photo: {photo: 0-2, x, y} with x and y
    # from 0 to 1 from the top left; none for a tool not on a photo.
    spot = Column(JSON, nullable=True)
    source = Column(String, nullable=False, default="own")

    created_at = Column(DateTime, default=datetime.utcnow)


class KitWish(Base):
    """A tool a sketcher starred in someone else's bag: their wish list
    (item 44). Only they see it; it goes when the tool does."""
    __tablename__ = "kit_wishlist"

    sketcher_id = Column(UUID(as_uuid=False), primary_key=True)
    kit_item_id = Column(UUID(as_uuid=False), primary_key=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Follow(Base):
    """One sketcher following another (design doc, item 33)."""
    __tablename__ = "sketcher_follows"

    follower_id = Column(UUID(as_uuid=False), primary_key=True)
    followed_id = Column(UUID(as_uuid=False), primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SketchLike(Base):
    """One like on a shared sketch (design doc, item 33)."""
    __tablename__ = "sketch_likes"

    sketch_id = Column(UUID(as_uuid=False), ForeignKey("sketches.id", ondelete="CASCADE"), primary_key=True)
    sketcher_id = Column(UUID(as_uuid=False), primary_key=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SketchComment(Base):
    """A comment on a shared sketch (design doc, item 32)."""
    __tablename__ = "sketch_comments"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    sketch_id = Column(UUID(as_uuid=False), ForeignKey("sketches.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(UUID(as_uuid=False), nullable=False)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class SketchUpload(Base):
    """One sketch upload: a progress sketch or the final (design doc,
    items 35 and 38). The final is the upload whose url equals
    sketches.final_sketch_url. `position` is the sketcher's order."""
    __tablename__ = "sketch_uploads"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    sketch_id = Column(UUID(as_uuid=False), ForeignKey("sketches.id", ondelete="CASCADE"), nullable=False, index=True)
    sketcher_id = Column(UUID(as_uuid=False), nullable=False)
    url = Column(String, nullable=False)
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

