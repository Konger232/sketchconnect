"""
Loads the .md prompt templates for every Gemini call.

Each feature keeps its own templates in a `prompts/` folder next to its
service.py and passes that folder in, e.g.

    PROMPTS = Path(__file__).parent / "prompts"
    render_prompt(PROMPTS / "help_quest.md", question=..., ...)

A bare filename (no folder) is looked up in core/prompts/, which holds the
templates shared by several features (planning_image.md).

Placeholders use `$name` (string.Template), not `{name}`: prompts can
contain literal braces (JSON examples, sets) without escaping. A literal
dollar sign is written `$$`. A missing variable raises KeyError, so a typo
in a template or a caller fails loudly instead of sending Gemini a prompt
with a hole in it.

Each file may start with one `<!-- ... -->` comment documenting its
variables; it's stripped before sending. Files are cached, but re-read
whenever they change on disk -- uvicorn --reload only watches .py files, so
a plain lru_cache would keep serving the old wording until a restart.
"""
import re
from pathlib import Path
from string import Template

SHARED_PROMPTS_DIR = Path(__file__).parent / "prompts"

_HEADER_COMMENT = re.compile(r"\A\s*<!--.*?-->\s*", re.DOTALL)
_cache: dict[Path, tuple[float, str]] = {}


def _resolve(template: str | Path) -> Path:
    path = Path(template)
    return path if path.is_absolute() else SHARED_PROMPTS_DIR / path


def load_prompt(template: str | Path) -> str:
    """Read a template, minus its header comment."""
    path = _resolve(template)
    if not path.is_file():
        raise FileNotFoundError(f"Prompt template not found: {path}")
    mtime = path.stat().st_mtime
    cached = _cache.get(path)
    if cached and cached[0] == mtime:
        return cached[1]
    text = _HEADER_COMMENT.sub("", path.read_text(encoding="utf-8"), count=1)
    # Files end with a newline; the prompt shouldn't.
    text = text.rstrip("\n")
    _cache[path] = (mtime, text)
    return text


def render_prompt(template: str | Path, **variables) -> str:
    """Load a template and fill in its `$name` placeholders."""
    return Template(load_prompt(template)).substitute(**variables)
