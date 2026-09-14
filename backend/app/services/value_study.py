"""
Dominant value shapes: reduces a photo to N tonal value groups -- the
"squint and see the big light/mid/dark masses" technique urban sketchers
use to plan a composition before drawing. This is deterministic image
processing (grayscale conversion, blur, percentile-based tonal binning),
not scene understanding, so it runs entirely server-side with OpenCV/
numpy rather than a Gemini call -- there's nothing here an LLM would do
more reliably, and every extra Gemini call costs money and latency this
doesn't need.

Ported from backend/legacy/perspective_analyze.py's `/value-study`
prototype endpoint (Phase 0), which validated this exact algorithm --
reused here for the on-demand "dominant value shapes" toggle on
SketchDetailPage's edit-mode view rather than a standalone dev endpoint.
Tunable constants (MIN/MAX_TONAL_LEVELS, VALUE_STUDY_BLUR_KERNEL) live in
config.py, same as the legacy version.
"""
import base64

import cv2
import numpy as np
from PIL import Image

from config import MAX_IMAGE_DIMENSION, MIN_TONAL_LEVELS, MAX_TONAL_LEVELS, VALUE_STUDY_BLUR_KERNEL


def _resize_if_needed(pil_image: Image.Image, max_dim: int = MAX_IMAGE_DIMENSION) -> Image.Image:
    """
    Same downscale-only-if-needed helper scene_analysis.py and the legacy
    module each keep their own copy of -- duplicated on purpose rather
    than shared, matching this codebase's existing pattern of each
    router/service owning its own small copy instead of a shared util.
    """
    w, h = pil_image.size
    if max(w, h) <= max_dim:
        return pil_image
    scale = max_dim / max(w, h)
    return pil_image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)


def compute_value_study(pil_image: Image.Image, levels: int = 4) -> dict:
    """
    Returns {"levels", "toneValues", "valueStudyImage"} -- valueStudyImage
    is a data: URI PNG the frontend can drop straight into an <img src=...>
    in place of the real photo. `levels` is clamped to
    [MIN_TONAL_LEVELS, MAX_TONAL_LEVELS].
    """
    levels = max(MIN_TONAL_LEVELS, min(MAX_TONAL_LEVELS, levels))

    pil_image = _resize_if_needed(pil_image.convert("RGB"))
    img = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Softens edges the way a real squint does -- without this, fine
    # texture (leaf detail, crowd outlines) produces speckled noise within
    # a tone group instead of the cohesive simplified shapes a real squint
    # shows a sketcher.
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
        representative = int(gray[mask].mean()) if mask.sum() > 0 else int((lo + hi) / 2)
        result[mask] = representative
        tone_values.append(representative)

    success, buffer = cv2.imencode(".png", result)
    if not success:
        raise ValueError("Could not encode value-study image")
    b64_string = base64.b64encode(buffer).decode("utf-8")

    return {
        "levels": levels,
        "toneValues": tone_values,
        "valueStudyImage": f"data:image/png;base64,{b64_string}",
    }
