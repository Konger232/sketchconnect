"""
Shared validation for values that more than one feature receives.

The guided question bank used to live here as Python dicts. It moved to
features/scene_analysis/question_bank.json (loaded and checked by
question_bank.py), since only the scene analysis call reads it.
"""
from config import STYLES


def validate_style(style: str) -> None:
    if style not in STYLES:
        raise ValueError(f"Unknown style: {style}")
