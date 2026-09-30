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
from config import DEBUG, GEMINI_MODEL

USE_MOCK_GEMINI = os.getenv("USE_MOCK_GEMINI", "false").lower() == "true"
# One mock file per call type: mockdata/mock_<mock_name>.json
MOCK_DIR = Path(__file__).parent / "mockdata"


def _configure():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set — see backend/.env.example")
    genai.configure(api_key=api_key)


def _mock_gemini_response(mock_name: str):
    raw_text = (MOCK_DIR / f"mock_{mock_name}.json").read_text()
    result = json.loads(raw_text)
    return result, raw_text


def call_gemini_json_with_raw(
    prompt: str,
    response_schema: dict,
    image: Image.Image | list[Image.Image | None] | None = None,
    mock_name: str = "scene_analysis",
) -> tuple[dict, str]:
    """Return the raw Gemini response to the GUI.
    `image` is one image or a list of them (e.g. the critique's coaching
    composite + final sketch), sent after the prompt in list order; None
    entries are skipped. The prompt should say which image is which.
    In mock mode, `mock_name` picks the mock file that matches this call."""
    if USE_MOCK_GEMINI:
        result, raw_text = _mock_gemini_response(mock_name)
        if DEBUG:
            _print_request(mock_name, prompt, response_schema, 0, mock=True)
            print(f"[Gemini {mock_name}] mock response:\n" + raw_text)
            print("=" * 80 + "\n")
        return result, raw_text

    _configure()
    model = genai.GenerativeModel(
        GEMINI_MODEL,
        generation_config={
            "response_mime_type": "application/json",
            "response_schema": response_schema,
        },
    )
    images = image if isinstance(image, list) else [image]
    images = [im for im in images if im is not None]
    contents = [prompt, *images]

    # Every call type (scene analysis, persona, critique, Help Quest)
    # funnels through here. With DEBUG=true in .env, the whole request and
    # response print in the uvicorn terminal (config.DEBUG).
    if DEBUG:
        _print_request(mock_name, prompt, response_schema, len(images))

    try:
        response = model.generate_content(contents)
    except ResourceExhausted as exc:
        raise GeminiQuotaExceededError(
            "Gemini API quota exceeded. Try again later."
        ) from exc 

    raw_text = response.text.strip()

    if DEBUG:
        print(f"[Gemini {mock_name}] raw response:\n" + raw_text)
    _print_token_usage(response, mock_name)
    if DEBUG:
        print("=" * 80 + "\n")

    text = raw_text
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    return json.loads(text), raw_text


def _print_request(name: str, prompt: str, response_schema: dict, image_count: int, mock: bool = False) -> None:
    """DEBUG only: the full request, as sent. Plain print(), not logging,
    so it shows up directly in the uvicorn --reload terminal."""
    print("\n" + "=" * 80)
    print(f"[Gemini {name}] model: {'mock' if mock else GEMINI_MODEL}")
    print(f"[Gemini {name}] images sent: {image_count}")
    print(f"[Gemini {name}] prompt sent:\n" + prompt)
    print(f"[Gemini {name}] response_schema sent:\n" + json.dumps(response_schema, indent=2))
    print("=" * 80)


def _print_token_usage(response, name: str = "call") -> None:
    """
    Actual token counts Gemini billed for this call (images included), from
    the response's usage_metadata. `cached` is the part of the prompt Gemini
    served from its cache -- how much the fixed opening of a prompt is
    saving. Fields a model doesn't report print as "n/a".
    """
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        print(f"[Gemini {name}] token usage: not reported")
        return

    def field(name):
        value = getattr(usage, name, None)
        return "n/a" if value is None else value

    print(
        f"[Gemini {name}] token usage: "
        f"prompt={field('prompt_token_count')} "
        f"(cached={field('cached_content_token_count')}), "
        f"response={field('candidates_token_count')}, "
        f"total={field('total_token_count')}"
    )


def call_gemini_json(
    prompt: str,
    response_schema: dict,
    image: Image.Image | list[Image.Image | None] | None = None,
    mock_name: str = "scene_analysis",
) -> dict:
    """Existing public shape — parsed dict only. Unchanged for every
    caller that doesn't need the raw text (Persona, Critique, Help Quest)."""
    parsed, _raw_text = call_gemini_json_with_raw(prompt, response_schema, image, mock_name)
    return parsed


class GeminiQuotaExceededError(Exception):
    """Raise when Gemini's free-tier daily quota is used up."""
    pass