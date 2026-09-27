"""Filesystem locations shared across features."""
from pathlib import Path

# backend/uploads -- photos, framed crops and final sketches.
UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"
