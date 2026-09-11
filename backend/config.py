"""
SketchConnect backend configuration.
Tunable values live here so they're easy to find and adjust without
digging through endpoint logic in main.py.
"""
from dotenv import load_dotenv

# Loads backend/.env into the process environment. Without this, every
# os.environ.get() below silently returns "" instead of erroring --
# which is exactly what caused DATABASE_URL to come back empty, the
# SQLAlchemy engine to be built as None, and every DB-backed endpoint
# to fail with UnboundExecutionError instead of a clear startup error.
load_dotenv()

# --- Image preprocessing ---
MAX_IMAGE_DIMENSION = 1600       # longest side, in pixels, before any analysis runs
                                  # (fixes the memory crash on full-size phone photos)

# --- Value study (/value-study) ---
MIN_TONAL_LEVELS = 2
MAX_TONAL_LEVELS = 8
VALUE_STUDY_BLUR_KERNEL = (15, 15)   # Gaussian blur strength, mimics the optical
                                      # softening of a real squint, not just color reduction

# --- Perspective detection (/analyze) ---
PERSPECTIVE_BLUR_KERNEL = (5, 5)     # light blur before edge detection (noise reduction,
                                      # separate purpose from the value study's squint blur)
CANNY_LOW_THRESHOLD = 50
CANNY_HIGH_THRESHOLD = 150
HOUGH_THRESHOLD = 60
HOUGH_MIN_LINE_LENGTH = 60
HOUGH_MAX_LINE_GAP = 15
MIN_LINE_LENGTH_FILTER = 60          # discard candidate lines shorter than this
ANGLE_EXCLUDE_NEAR_HORIZONTAL = 8    # degrees; lines flatter than this are excluded
ANGLE_EXCLUDE_NEAR_VERTICAL = (82, 98)  # degrees; lines in this range are excluded
VP_SEARCH_RADIUS_FACTOR = 0.1        # fraction of image size used to cluster candidate
                                      # vanishing points around the densest match
LINE_TO_VP_DISTANCE_FACTOR = 0.06    # fraction of image size; how close a line's
                                      # extension must pass to the VP to "count"
ANGLE_DEDUP_THRESHOLD = 4            # degrees; lines within this angle of an already-
                                      # kept line are treated as duplicates
MAX_CLEAN_LINES = 8                  # cap on how many lines get returned to the frontend

# --- Gemini (/gemini-proxy) ---
GEMINI_MODEL = "gemini-3.6-flash"

# --- CORS ---
# Add your real deployed frontend domain here once you have one
# (e.g. "https://your-project.framer.website" or a Vercel/Netlify URL)
ALLOWED_ORIGINS = ["http://localhost:5173"]
# Also allow the Vite dev server when it's opened from another device on
# the same Wi-Fi (e.g. testing on a phone) -- Vite prints that "Network:"
# URL when frontend/main.jsx is started with `npm run dev`. Private-network
# IP ranges only (192.168.x.x, 10.x.x.x, 172.16-31.x.x), port 5173.
ALLOWED_ORIGIN_REGEX = r"^http://(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):5173$"
# --- Supabase / Postgres ---
# DATABASE_URL: the Postgres connection string from your Supabase project
# (Project Settings -> Database -> Connection string -> URI, "Session pooler"
# works fine for a dev box). Loaded from the environment, not hardcoded.
import os as _os

DATABASE_URL = _os.environ.get("DATABASE_URL", "")

# Supabase issues auth JWTs; this backend verifies them directly against
# Supabase's public JWKS — no database lookup needed on the hot path (see
# design doc, Section 3, Auth). This project is on Supabase's asymmetric
# JWT Signing Keys (Project Settings -> API -> JWT Settings), so
# app/auth.py fetches `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`
# rather than checking against a static shared secret.
SUPABASE_URL = _os.environ.get("SUPABASE_URL", "")
# Supabase JWTs use "authenticated" as the standard audience claim for a
# logged-in user's token.
SUPABASE_JWT_AUDIENCE = "authenticated"

# --- Scene analysis rule table ---
# Which prepared-prompt SET is eligible for a given (scene_type, style) pair.
# Gemini fills in scene-specific wording; this table controls *which*
# question keys it's allowed to choose from, keeping the AI observing
# rather than directing (see design doc, Section 5).
SCENE_TYPES = [
    "architectural",
    "still_life_organic",
    "figure",
    "open_landscape",
    "mixed",
]
STYLES = ["ink_and_wash", "realistic", "minimalist", "reportage"]

# Focal-region cap: a design decision, not citation-backed (design doc, Sec. 6)
MAX_FOCAL_REGIONS = 3
