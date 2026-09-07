"""
Thin wrapper around google.generativeai enforcing structured JSON output
(design doc, Section 3, "Schema enforcement"): responseSchema +
responseMimeType="application/json" so Gemini can't drift into narrative
or code responses.
"""
import json
import os

import google.generativeai as genai
from PIL import Image

from config import GEMINI_MODEL


def _configure():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set — see backend/.env.example")
    genai.configure(api_key=api_key)


def call_gemini_json_with_raw(
    prompt: str, response_schema: dict, image: Image.Image | None = None
) -> tuple[dict, str]:
    """
    Fires one Gemini call, forcing JSON output against `response_schema`
    (a plain dict in Gemini's OpenAPI-subset schema format). Returns
    (parsed_dict, raw_text) — the raw text is Gemini's response exactly as
    received, before the ```json fence stripping below. Raises on
    non-JSON output rather than silently returning a malformed shape —
    callers should let FastAPI turn that into a 502.

    Split out from call_gemini_json (below) so routers that want to show
    the sketcher/developer the actual raw model output — not just the
    parsed-and-filtered result — can get at it without changing the
    return shape for every other caller.
    """
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

    response = model.generate_content(contents)
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
