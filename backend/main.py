"""
SketchConnect middle server.
Two jobs, kept deliberately separate:
  1. /analyze      -> deterministic OpenCV perspective detection (fast, free, no AI)
  2. /gemini-proxy  -> stub for Gemini calls (fill in with your API key + prompt)
"""

import os
import io
import numpy as np
import cv2
from PIL import Image
import pillow_heif
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

pillow_heif.register_heif_opener()  # lets PIL open HEIC/HEIF files transparently

app = FastAPI(title="SketchConnect middle server")

# Allow the local Vite dev server to call this API during development.
# Tighten this to your real frontend domain before deploying.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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
    except Exception:
        return {"error": "Could not decode image"}
    img = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
    if img is None:
        return {"error": "Could not decode image"}

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180, threshold=60, minLineLength=60, maxLineGap=15
    )

    if lines is None:
        return {"vanishingPoint": None, "lines": [], "message": "No lines detected"}

    def angle_deg(x1, y1, x2, y2):
        return np.degrees(np.arctan2(y2 - y1, x2 - x1)) % 180

    candidates = []
    for l in lines:
        x1, y1, x2, y2 = l[0]
        length = np.hypot(x2 - x1, y2 - y1)
        a = angle_deg(x1, y1, x2, y2)
        if length < 60 or a < 8 or a > 172 or 82 < a < 98:
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
        radius = max(w, h) * 0.1
        near = d < radius
        if near.sum() >= 3:
            mx, my = pts_arr[near, 0].mean(), pts_arr[near, 1].mean()
        vp = {"x": float(mx), "y": float(my)}

    return {
        "imageWidth": w,
        "imageHeight": h,
        "vanishingPoint": vp,
        "lines": [
            {"x1": int(x1), "y1": int(y1), "x2": int(x2), "y2": int(y2)}
            for x1, y1, x2, y2 in candidates[:40]
        ],
    }


@app.post("/gemini-proxy")
async def gemini_proxy(image: UploadFile = File(...), prompt: str = ""):
    """
    Stub. Wire this up to the real Gemini API using GEMINI_API_KEY from the
    environment. Keeping this server-side is what keeps the key off the client.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return {"error": "GEMINI_API_KEY not set on the server"}
    # TODO: call google.generativeai here with `image` and `prompt`,
    # and return the structured JSON schema from earlier testing.
    return {"message": "Gemini proxy stub. Add your API call here."}
