"""
SketchConnect backend configuration.
Tunable values live here so they're easy to find and adjust without
digging through endpoint logic in main.py.
"""

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
GEMINI_MODEL = "gemini-2.5-flash"

# --- CORS ---
# Add your real deployed frontend domain here once you have one
# (e.g. "https://your-project.framer.website" or a Vercel/Netlify URL)
ALLOWED_ORIGINS = ["http://localhost:5173"]