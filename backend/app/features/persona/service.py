"""
AI agent persona creation call (schema: gemini_call_schemas.md #2). Fires
once, from Settings, when a sketcher sets or changes their admired artist
for a style. The HTTP route and storage stay in features/persona/router.py; the
prompt text is in prompts/persona_*.md.
"""
from pathlib import Path

from app.core.prompt_loader import render_prompt
from app.core.gemini_service import call_gemini_json

PROMPTS = Path(__file__).parent / "prompts"

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "persona_source": {"type": "string", "enum": ["sketcher_provided", "system_default"]},
        "persona_label": {"type": "string"},
        "voice": {"type": "string"},
        "priorities": {"type": "array", "items": {"type": "string"}},
        "tone": {"type": "string"},
    },
    "required": ["persona_source", "persona_label", "voice", "priorities", "tone"],
}


def build_prompt(style: str, admired_artist_name: str | None) -> str:
    if admired_artist_name:
        return render_prompt(PROMPTS / "persona_admired_artist.md", artist=admired_artist_name, style=style)
    return render_prompt(PROMPTS / "persona_default.md", style=style)


def generate_persona(style: str, admired_artist_name: str | None) -> dict:
    return call_gemini_json(build_prompt(style, admired_artist_name), RESPONSE_SCHEMA, mock_name="persona")
