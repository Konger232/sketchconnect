"""
The paint library and My palette (design doc, items 45 and 46).

The library is every paint a sketcher can pick: our starter list (checked)
and the paints sketchers add, unique by brand and name. A sketcher's paint
is labelled "Added by @username" until 3 other sketchers carry it; then it
is checked. Anyone can report a mistake (paint_flags, reviewed by Chan).

GET  /api/paints                 the library
POST /api/paints                 add a paint to the library and to my palette
POST /api/paints/{paint_id}/flag report a mistake
GET  /api/palette                my palette: its paints, in order, and the tin
PUT  /api/palette                replace my palette and the tin
"""
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.auth import get_current_sketcher_id
from app.core.database import get_db
from app.core.models import Paint, PaintFlag, PaletteItem, Profile
from app.features.paints.pigments import KNOWN, normalize
from app.features.paints.schemas import FlagRequest, NewPaintRequest, PaletteRequest

router = APIRouter(prefix="/api", tags=["paints"])

MAX_PALETTE = 48
CHECKS_TO_CONFIRM = 3  # other sketchers carrying a paint before it is checked
MAX_PAN_ROWS, MAX_PAN_COLS = 6, 12  # the tin's grid
# The brands in the form's list; a brand typed under "Other" that matches
# one of these takes its spelling.
BRANDS = ["Daniel Smith", "Winsor & Newton", "Schmincke", "ShinHan", "Holbein",
          "M. Graham", "Sennelier", "White Nights", "Da Vinci"]


# ---- the library ----

def _confirmations(db: Session, paint_ids: list[str]) -> dict[str, int]:
    """How many sketchers, other than the one who added it, carry each paint."""
    if not paint_ids:
        return {}
    rows = (db.query(PaletteItem.paint_id, func.count())
            .join(Paint, Paint.id == PaletteItem.paint_id)
            .filter(PaletteItem.paint_id.in_(paint_ids))
            .filter((Paint.added_by.is_(None)) | (PaletteItem.sketcher_id != Paint.added_by))
            .group_by(PaletteItem.paint_id).all())
    return dict(rows)


def paint_dicts(db: Session, paints: list[Paint]) -> list[dict]:
    """The library's shape, as the frontend's paint list (data/paints.js)."""
    counts = _confirmations(db, [p.id for p in paints])
    adders = {p.added_by for p in paints if p.added_by}
    names = dict(db.query(Profile.id, Profile.username).filter(Profile.id.in_(adders)).all()) if adders else {}
    out = []
    for p in paints:
        codes = list(p.pigment_codes or [])
        out.append({
            "id": p.id,
            "brand": p.brand,
            "name": p.name,
            "codes": codes,
            "code": " + ".join(codes),
            "hex": p.hex,
            "lean": p.lean,
            "checked": bool(p.checked) or counts.get(p.id, 0) >= CHECKS_TO_CONFIRM,
            "confirmations": counts.get(p.id, 0),
            "added_by": names.get(p.added_by),
        })
    return out


@router.get("/paints")
def library(db: Session = Depends(get_db), _: str = Depends(get_current_sketcher_id)):
    rows = db.query(Paint).order_by(Paint.checked.desc(), Paint.name).limit(2000).all()
    return {"library": paint_dicts(db, rows)}


def _brand(raw: str) -> str:
    b = " ".join(raw.split())
    for known in BRANDS:
        if known.lower().replace(" ", "") == b.lower().replace(" ", ""):
            return known
    return b


@router.post("/paints")
def add_paint(body: NewPaintRequest, db: Session = Depends(get_db), sketcher_id: str = Depends(get_current_sketcher_id)):
    """
    Checks, in order: each pigment code's form (P, a family, a number);
    codes we don't know need confirm_unknown; the same brand and name
    already in the library is a 409 with that paint, to pick instead.
    The new paint joins my palette.
    """
    codes = []
    for raw in body.pigment_codes:
        code = normalize(raw)
        if not code:
            raise HTTPException(422, {"error": "bad_code", "code": raw,
                                      "message": f'"{raw}" is not a pigment code. It looks like PB29 or PY150, printed on the tube.'})
        if code not in codes:
            codes.append(code)
    unknown = [c for c in codes if c not in KNOWN]
    if unknown and not body.confirm_unknown:
        raise HTTPException(422, {"error": "unknown_code", "codes": unknown,
                                  "message": f"We don't know {', '.join(unknown)}. Check the tube; save anyway if that's what it says."})
    brand = _brand(body.brand)
    name = " ".join(body.name.split())
    same = db.query(Paint).filter(
        func.lower(func.coalesce(Paint.brand, "")) == brand.lower(), func.lower(Paint.name) == name.lower()
    ).first()
    if same:
        raise HTTPException(409, {"error": "exists", "paint": paint_dicts(db, [same])[0],
                                  "message": f"{brand} {name} is already in the library."})
    paint = Paint(id=f"c-{secrets.token_hex(4)}", brand=brand, name=name, pigment_codes=codes,
                  hex=body.hex.lower(), lean=(body.lean or "").strip() or None, added_by=sketcher_id)
    db.add(paint)
    db.flush()
    ids = palette_ids(db, sketcher_id)
    if len(ids) < MAX_PALETTE:
        db.add(PaletteItem(sketcher_id=sketcher_id, paint_id=paint.id, position=len(ids)))
    db.commit()
    return paint_dicts(db, [paint])[0]


@router.post("/paints/{paint_id}/flag")
def flag_paint(paint_id: str, body: FlagRequest, db: Session = Depends(get_db), sketcher_id: str = Depends(get_current_sketcher_id)):
    if not db.get(Paint, paint_id):
        raise HTTPException(404, "No such paint")
    flag = db.get(PaintFlag, (paint_id, sketcher_id)) or PaintFlag(paint_id=paint_id, sketcher_id=sketcher_id)
    flag.note = (body.note or "").strip() or None
    flag.resolved = False
    db.merge(flag)
    db.commit()
    return {"ok": True}


# ---- My palette ----

def palette_ids(db: Session, sketcher_id: str) -> list[str]:
    return [i for (i,) in db.query(PaletteItem.paint_id).filter(PaletteItem.sketcher_id == sketcher_id)
            .order_by(PaletteItem.position, PaletteItem.created_at).all()]


def palette_paints(db: Session, sketcher_id: str) -> list[dict]:
    """My palette as paint dicts, in order."""
    ids = palette_ids(db, sketcher_id)
    by_id = {p.id: p for p in db.query(Paint).filter(Paint.id.in_(ids)).all()} if ids else {}
    return paint_dicts(db, [by_id[i] for i in ids if i in by_id])


def set_palette(db: Session, sketcher_id: str, ids: list[str]) -> list[str]:
    """Replace my palette with these paints (library ids), in this order."""
    wanted = list(dict.fromkeys(i for i in ids if isinstance(i, str)))[:MAX_PALETTE]
    real = {i for (i,) in db.query(Paint.id).filter(Paint.id.in_(wanted)).all()} if wanted else set()
    wanted = [i for i in wanted if i in real]
    db.query(PaletteItem).filter(PaletteItem.sketcher_id == sketcher_id, PaletteItem.paint_id.notin_(wanted or [""])).delete(synchronize_session=False)
    have = {r.paint_id: r for r in db.query(PaletteItem).filter(PaletteItem.sketcher_id == sketcher_id).all()}
    for pos, pid in enumerate(wanted):
        if pid in have:
            have[pid].position = pos
        else:
            db.add(PaletteItem(sketcher_id=sketcher_id, paint_id=pid, position=pos))
    return wanted


def clean_palette_layout(layout: dict | None, paints: list[str]) -> dict | None:
    """
    My palette's pans, as the sketcher's tin is laid out (item 45). Every
    cell is a half pan unless a pan entry says otherwise: a full pan takes
    two cells, side by side (w 2) or one above the other (h 2). Pans outside
    the grid, overlapping another, or holding a paint not in the palette are
    dropped (the paint, not the pan, when only the paint is gone).
    """
    if not isinstance(layout, dict):
        return None
    try:
        rows = max(1, min(MAX_PAN_ROWS, int(layout.get("rows", 2))))
        cols = max(1, min(MAX_PAN_COLS, int(layout.get("cols", 6))))
    except (TypeError, ValueError):
        return None
    taken: set[tuple[int, int]] = set()
    pans = []
    for pan in (layout.get("pans") or [])[: rows * cols]:
        try:
            r, c, w, h = (int(pan.get(k, d)) for k, d in (("r", 0), ("c", 0), ("w", 1), ("h", 1)))
        except (TypeError, ValueError, AttributeError):
            continue
        if w not in (1, 2) or h not in (1, 2) or w * h > 2:
            continue
        if not (0 <= r and r + h <= rows and 0 <= c and c + w <= cols):
            continue
        cells = {(r + i, c + j) for i in range(h) for j in range(w)}
        if cells & taken:
            continue
        paint = pan.get("paint") if pan.get("paint") in paints else None
        if paint is None and w * h == 1:
            continue  # an empty half pan is the default; no entry needed
        taken |= cells
        pans.append({"r": r, "c": c, "w": w, "h": h, "paint": paint})
    return {"rows": rows, "cols": cols, "pans": pans}


def _profile(db: Session, sketcher_id: str) -> Profile:
    profile = db.get(Profile, sketcher_id)
    if not profile:
        raise HTTPException(404, "No profile yet")
    return profile


@router.get("/palette")
def get_palette(db: Session = Depends(get_db), sketcher_id: str = Depends(get_current_sketcher_id)):
    return {"palette_paints": palette_paints(db, sketcher_id), "layout": _profile(db, sketcher_id).palette_layout}


@router.put("/palette")
def put_palette(body: PaletteRequest, db: Session = Depends(get_db), sketcher_id: str = Depends(get_current_sketcher_id)):
    profile = _profile(db, sketcher_id)
    ids = set_palette(db, sketcher_id, body.paints)
    profile.palette_layout = clean_palette_layout(body.layout if body.layout is not None else profile.palette_layout, ids)
    db.commit()
    return {"palette_paints": palette_paints(db, sketcher_id), "layout": profile.palette_layout}
