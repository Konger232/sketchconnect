"""
Thin wrapper around google.generativeai enforcing structured JSON output
(design doc, Section 3, "Schema enforcement"): responseSchema +
responseMimeType="application/json" so Gemini can't drift into narrative
or code responses.
"""
import json
import os
from pathlib import Path

import google.generativeai as genai

from google.api_core.exceptions import ResourceExhausted
from PIL import Image
from config import GEMINI_MODEL

USE_MOCK_GEMINI = os.getenv("USE_MOCK_GEMINI", "false").lower() == "true"
MOCK_RESPONSE_PATH = Path(__file__).parent / "mockdata" / "mock_scene_analysis.json"


def _configure():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set — see backend/.env.example")
    genai.configure(api_key=api_key)


def _mock_gemini_response():
    raw_text = MOCK_RESPONSE_PATH.read_text()
    result = json.loads(raw_text)
    return result, raw_text


def call_gemini_json_with_raw(
    prompt: str, response_schema: dict, image: Image.Image | None = None
) -> tuple[dict, str]:
    """Return the raw Gemini response to the GUI"""
    if USE_MOCK_GEMINI:
        return _mock_gemini_response()

    _configure()
    model = genai.GenerativeModel(
        GEMINI_MODEL,
        generation_config={
            "response_mime_type": "application/json",
            "response_schema": response_schema,
        },
    )
    contents = [prompt, image] if image is not None else [prompt]

    # Dev-time visibility into exactly what gets sent/received per call —
    # this is the one place every call type (Scene Analysis, Persona,
    # Critique, Help Quest) funnels through, so it covers all of them.
    # Plain print(), not logging, since this is meant to show up directly
    # in the uvicorn --reload terminal during local testing.
    print("\n" + "=" * 80)
    print(f"[Gemini call] model: {GEMINI_MODEL}")
    print("[Gemini call] prompt sent:\n" + prompt)
    print("[Gemini call] response_schema sent:\n" + json.dumps(response_schema, indent=2))
    print("=" * 80)

    try:
        response = model.generate_content(contents)
    except ResourceExhausted as exc:
        raise GeminiQuotaExceededError(
            "Gemini API quota exceeded. Try again later."
        ) from exc 

    raw_text = response.text.strip()

    print("[Gemini call] raw response:\n" + raw_text)
    print("=" * 80 + "\n")

    text = raw_text
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    return json.loads(text), raw_text


def call_gemini_json(prompt: str, response_schema: dict, image: Image.Image | None = None) -> dict:
    """Existing public shape — parsed dict only. Unchanged for every
    caller that doesn't need the raw text (Persona, Critique, Help Quest)."""
    parsed, _raw_text = call_gemini_json_with_raw(prompt, response_schema, image)
    return parsed


class GeminiQuotaExceededError(Exception):
    """Raise when Gemini's free-tier daily quota is used up."""
    pass