"""
SketchConnect middle server.
Two jobs, kept deliberately separate:
  1. /analyze       -> deterministic OpenCV perspective detection (fast, free, no AI)
  2. /value-study   -> deterministic tonal value reduction (squint simulation)
  3. /gemini-proxy  -> real Gemini calls (focal point, depth-layer coaching, etc.)

Tunable constants live in config.py, not scattered through this file.
"""

import os
import io
import json
import base64
import numpy as np
import cv2
from PIL import Image
import pillow_heif
import google.generativeai as genai
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware

from config import (
    MAX_IMAGE_DIMENSION,
    MIN_TONAL_LEVELS,
    MAX_TONAL_LEVELS,
    VALUE_STUDY_BLUR_KERNEL,
    PERSPECTIVE_BLUR_KERNEL,
    CANNY_LOW_THRESHOLD,
    CANNY_HIGH_THRESHOLD,
    HOUGH_THRESHOLD,
    HOUGH_MIN_LINE_LENGTH,
    HOUGH_MAX_LINE_GAP,
    MIN_LINE_LENGTH_FILTER,
    ANGLE_EXCLUDE_NEAR_HORIZONTAL,
    ANGLE_EXCLUDE_NEAR_VERTICAL,
    VP_SEARCH_RADIUS_FACTOR,
    LINE_TO_VP_DISTANCE_FACTOR,
    ANGLE_DEDUP_THRESHOLD,
    MAX_CLEAN_LINES,
    GEMINI_MODEL,
    ALLOWED_ORIGINS,
)

pillow_heif.register_heif_opener()  # lets PIL open HEIC/HEIF files transparently

app = FastAPI(title="SketchConnect middle server")


def resize_if_needed(pil_image, max_dim=MAX_IMAGE_DIMENSION):
    """
    Downscale an image if its longest side exceeds max_dim, preserving aspect
    ratio. Modern phone photos are often 4000+ pixels wide, far more
    resolution than edge detection or Gemini need, and processing them at
    full size is what was crashing the container on memory limits.
    """
    w, h = pil_image.size
    if max(w, h) <= max_dim:
        return pil_image
    scale = max_dim / max(w, h)
    new_size = (int(w * scale), int(h * scale))
    return pil_image.resize(new_size, Image.LANCZOS)


# Allow the local Vite dev server to call this API during development.
# Add your real deployed frontend domain in config.py's ALLOWED_ORIGINS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(image: UploadFile = File(...)):
    """
    Deterministic perspective analysis: Canny edges -> Hough line detection ->
    pairwise line intersections -> densest cluster = estimated vanishing point.
    Same approach validated earlier in this project's testing.
    """
    contents = await image.read()
    try:
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
        pil_image = resize_if_needed(pil_image)
    except Exception:
        return {"error": "Could not decode image"}
    img = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
    if img is None:
        return {"error": "Could not decode image"}

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, PERSPECTIVE_BLUR_KERNEL, 0)
    edges = cv2.Canny(blur, CANNY_LOW_THRESHOLD, CANNY_HIGH_THRESHOLD, apertureSize=3)
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=HOUGH_THRESHOLD,
        minLineLength=HOUGH_MIN_LINE_LENGTH,
        maxLineGap=HOUGH_MAX_LINE_GAP,
    )

    if lines is None:
        return {"vanishingPoint": None, "lines": [], "message": "No lines detected"}

    def angle_deg(x1, y1, x2, y2):
        return np.degrees(np.arctan2(y2 - y1, x2 - x1)) % 180

    v_lo, v_hi = ANGLE_EXCLUDE_NEAR_VERTICAL
    candidates = []
    for l in lines:
        x1, y1, x2, y2 = l[0]
        length = np.hypot(x2 - x1, y2 - y1)
        a = angle_deg(x1, y1, x2, y2)
        if (
            length < MIN_LINE_LENGTH_FILTER
            or a < ANGLE_EXCLUDE_NEAR_HORIZONTAL
            or a > (180 - ANGLE_EXCLUDE_NEAR_HORIZONTAL)
            or v_lo < a < v_hi
        ):
            continue
        candidates.append((x1, y1, x2, y2))

    def to_h(x1, y1, x2, y2):
        return np.cross([x1, y1, 1.0], [x2, y2, 1.0])

    homo = [to_h(*c) for c in candidates]
    pts = []
    for i in range(len(homo)):
        for j in range(i + 1, len(homo)):
            pt = np.cross(homo[i], homo[j])
            if abs(pt[2]) < 1e-6:
                continue
            x, y = pt[0] / pt[2], pt[1] / pt[2]
            if -3 * w < x < 3 * w and -3 * h < y < 3 * h:
                pts.append((x, y))

    vp = None
    if pts:
        pts_arr = np.array(pts)
        mx, my = np.median(pts_arr[:, 0]), np.median(pts_arr[:, 1])
        d = np.hypot(pts_arr[:, 0] - mx, pts_arr[:, 1] - my)
        radius = max(w, h) * VP_SEARCH_RADIUS_FACTOR
        near = d < radius
        if near.sum() >= 3:
            mx, my = pts_arr[near, 0].mean(), pts_arr[near, 1].mean()
        vp = {"x": float(mx), "y": float(my)}

    def dist_point_to_line(px, py, x1, y1, x2, y2):
        line_vec = np.array([x2 - x1, y2 - y1], dtype=float)
        line_len = np.linalg.norm(line_vec)
        if line_len < 1e-6:
            return 1e9
        line_unit = line_vec / line_len
        pt_vec = np.array([px - x1, py - y1], dtype=float)
        proj_len = np.dot(pt_vec, line_unit)
        proj = np.array([x1, y1]) + proj_len * line_unit
        return np.linalg.norm(np.array([px, py]) - proj)

    clean_lines = []
    if vp is not None:
        # Score every candidate by how closely its extension passes through
        # the vanishing point, favoring longer (more confident) lines
        scored = []
        for x1, y1, x2, y2 in candidates:
            d = dist_point_to_line(vp["x"], vp["y"], x1, y1, x2, y2)
            length = np.hypot(x2 - x1, y2 - y1)
            if d < max(w, h) * LINE_TO_VP_DISTANCE_FACTOR:
                scored.append((d, -length, x1, y1, x2, y2))
        scored.sort()

        # Deduplicate by angle so near-identical parallel lines (e.g. many
        # roofline segments) don't all get drawn on top of each other
        used_angles = []
        for d, negl, x1, y1, x2, y2 in scored:
            a = angle_deg(x1, y1, x2, y2)
            if all(abs(a - ua) > ANGLE_DEDUP_THRESHOLD for ua in used_angles):
                used_angles.append(a)
                clean_lines.append((x1, y1, x2, y2))
            if len(clean_lines) >= MAX_CLEAN_LINES:
                break

    return {
        "imageWidth": w,
        "imageHeight": h,
        "vanishingPoint": vp,
        "lines": [
            {"x1": int(x1), "y1": int(y1), "x2": int(x2), "y2": int(y2)}
            for x1, y1, x2, y2 in clean_lines
        ],
    }


@app.post("/value-study")
async def value_study_endpoint(
    image: UploadFile = File(...), levels: int = Form(4)
):
    """
    Reduce a photo to N tonal value groups, the digital version of a
    sketcher squinting to see simplified light/dark shapes. Deterministic:
    the same photo and level count always produce the same result, using
    percentile-based binning so the groups reflect this specific photo's
    actual tone distribution rather than a fixed brightness grid.

    A Gaussian blur is applied before tone grouping to mimic the other half
    of squinting: real squinting doesn't just reduce perceived color detail,
    it optically softens edges too. Without this, fine texture (leaf detail,
    crowd outlines) produces speckled noise within a tone group instead of
    the cohesive simplified shapes a real squint shows a sketcher.

    `levels` is caller-controlled (clamped via config's MIN/MAX_TONAL_LEVELS)
    so the frontend can offer a slider rather than a fixed choice.
    """
    levels = max(MIN_TONAL_LEVELS, min(MAX_TONAL_LEVELS, levels))

    contents = await image.read()
    try:
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
        pil_image = resize_if_needed(pil_image)
    except Exception:
        return {"error": "Could not decode image"}

    img = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, VALUE_STUDY_BLUR_KERNEL, 0)

    percentiles = np.linspace(0, 100, levels + 1)
    thresholds = np.percentile(gray, percentiles)

    result = np.zeros_like(gray)
    tone_values = []
    for i in range(levels):
        lo, hi = thresholds[i], thresholds[i + 1]
        if i == levels - 1:
            mask = (gray >= lo) & (gray <= hi)
        else:
            mask = (gray >= lo) & (gray < hi)
        if mask.sum() > 0:
            representative = int(gray[mask].mean())
        else:
            representative = int((lo + hi) / 2)
        result[mask] = representative
        tone_values.append(representative)

    success, buffer = cv2.imencode(".png", result)
    if not success:
        return {"error": "Could not encode result image"}
    b64_string = base64.b64encode(buffer).decode("utf-8")

    return {
        "levels": levels,
        "toneValues": tone_values,
        "valueStudyImage": f"data:image/png;base64,{b64_string}",
    }


@app.post("/gemini-proxy")
async def gemini_proxy(image: UploadFile = File(...), prompt: str = Form(...)):
    """
    Real Gemini call. Sends an image + a prompt (the caller is responsible for
    prompt content, e.g. the depth-layer coaching prompt validated earlier in
    this project). Expects Gemini to return JSON per that prompt's schema and
    parses it before returning, stripping markdown code fences if present,
    since models sometimes add them even when told not to.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return {"error": "GEMINI_API_KEY not set on the server"}

    contents = await image.read()
    try:
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
        pil_image = resize_if_needed(pil_image)
    except Exception:
        return {"error": "Could not decode image"}

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(GEMINI_MODEL)

    try:
        response = model.generate_content([prompt, pil_image])
        text = response.text.strip()

        # Defensive: strip ```json ... ``` fences if the model added them
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()

        parsed = json.loads(text)
        return parsed
    except json.JSONDecodeError:
        return {
            "error": "Gemini did not return valid JSON",
            "raw": response.text if "response" in locals() else None,
        }
    except Exception as e:
        return {"error": str(e)}