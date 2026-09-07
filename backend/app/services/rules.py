"""
The FastAPI rule table that decides which prepared prompts are eligible for
a given (scene_type, style) pair. Gemini reports scene facts; this table
decides what those facts unlock — keeping the AI observing, not directing
(design doc, Section 2 and Section 5).

This is a first-pass starter table, not final content — fill in real
question/option copy per scene as the semester's UX gets designed. Each
entry becomes the `prepared_prompts` seed passed into the Gemini prompt so
the model fills in scene-specific wording without inventing new question
categories.
"""
from config import SCENE_TYPES, STYLES

# prompt "keys" eligible per scene_type, independent of style — style mostly
# changes tone/wording, not which structural questions apply.
PROMPT_KEYS_BY_SCENE_TYPE: dict[str, list[str]] = {
    "architectural": ["perspective_lines", "proportion_check", "focal_building", "show_focal_areas"],
    "still_life_organic": ["hide_background", "split_shapes", "compare_weights", "tonal_values", "show_focal_areas"],
    "figure": ["gesture_first", "proportion_check", "time_pressure_tip", "show_focal_areas"],
    "open_landscape": ["horizon_placement", "value_masses", "sky_ground_ratio", "show_focal_areas"],
    "mixed": ["routing_question", "focal_building", "gesture_first", "show_focal_areas"],
}

# Human-readable question text per key, so routers don't hardcode copy.
# Gemini still fills in scene-specific details inside `question`/`options`;
# this is the fallback/seed text.
PROMPT_TEXT: dict[str, str] = {
    "perspective_lines": "Want to see the perspective lines for this building?",
    "proportion_check": "Should we check proportions before you commit to line weight?",
    "focal_building": "Which part of the scene should anchor your composition?",
    "hide_background": "What feels easiest to trace first?",
    "split_shapes": "Background is clear. What's next?",
    "compare_weights": "Want to compare the relative weights of these shapes?",
    "tonal_values": "Should we simplify this into a few tonal values?",
    "gesture_first": "Want to start with a quick gesture line before details?",
    "time_pressure_tip": "This subject may move — want a tip for working fast?",
    "horizon_placement": "Where should the horizon sit in your composition?",
    "value_masses": "Want to see this scene as large flat value shapes?",
    "sky_ground_ratio": "How much of the frame should sky take up?",
    "routing_question": "What do you want to focus on first?",
    # Shown on demand only -- never auto-revealed. focal_regions is
    # Gemini's own read of what stood out, and (per the design doc's
    # own framing, and the sketcher feedback that led to removing the
    # tap-to-pick focal point picker) that read shouldn't be pushed on
    # the sketcher by default -- see parking-lot.md.
    "show_focal_areas": "Want to see which areas of the scene stood out most to the AI?",
}

# Seed "options" per key, same spirit as PROMPT_TEXT: a starting point
# Gemini adapts wording on (see the "options" instruction in
# scene_analysis.py's _build_prompt), not a literal freeze. Previously
# options were left entirely up to Gemini to invent each call -- this
# gives them the same dev-editable, consistent-by-key treatment as the
# questions themselves. Each list is 3 choices; by convention the last
# one is a "skip/do it differently" option, matching the pattern Gemini
# itself converged on before this existed (see e.g. compare_heights).
PROMPT_OPTIONS: dict[str, list[str]] = {
    "perspective_lines": ["Show the vanishing lines", "Just note the strongest angle", "Skip perspective for now"],
    "proportion_check": ["Check proportions first", "Eyeball it and adjust as you go", "Skip proportion check"],
    "focal_building": ["Anchor on the most prominent structure", "Let a smaller detail lead instead", "Decide as you sketch"],
    "hide_background": ["Start with the foreground shapes", "Block in the background first", "Work both together"],
    "split_shapes": ["Group shapes by value", "Group shapes by type", "Keep it as one continuous mass"],
    "compare_heights": ["Compare relative heights", "Focus on visual weight instead", "Skip height comparison"],
    "tonal_values": ["Block in 3 main values", "Focus on line contours first", "Work directly with full detail"],
    "gesture_first": ["Start with a quick gesture line", "Go straight to detail", "Warm up with a few thumbnails"],
    "time_pressure_tip": ["Capture the gesture fast, refine later", "Focus on the head or core shape only", "Take a reference photo as backup"],
    "horizon_placement": ["Place it low for more sky", "Place it high for more foreground", "Center it evenly"],
    "value_masses": ["Block in large flat shapes first", "Work light-to-dark gradually", "Jump straight to detail"],
    "sky_ground_ratio": ["Let the sky dominate", "Let the ground dominate", "Split it evenly"],
    "routing_question": ["Architecture first", "Figures first", "Whatever draws your eye"],
    "show_focal_areas": ["Show all of them", "Just the strongest one", "Decide on my own"],
}


# Every valid prompt key, flattened across all scene types — this is the
# enum Gemini's structured output is constrained to for `prepared_prompts[].key`.
# JSON Schema enums can't be conditioned on a sibling field's value, so this
# can't be narrowed to just the eventual scene_type's keys at the schema
# level; eligible_prompt_keys() below re-checks that scoping in code after
# Gemini responds.
PROMPT_KEYS_ALL: list[str] = sorted(PROMPT_TEXT.keys())


def eligible_prompt_keys(scene_type: str) -> list[str]:
    if scene_type not in SCENE_TYPES:
        raise ValueError(f"Unknown scene_type: {scene_type}")
    return PROMPT_KEYS_BY_SCENE_TYPE.get(scene_type, [])


def render_prompt_guide() -> str:
    """
    Renders PROMPT_KEYS_BY_SCENE_TYPE + PROMPT_TEXT as a block of Gemini
    prompt context, grouped by scene_type. Scene Analysis doesn't know the
    scene_type until Gemini determines it in the same call, so this passes
    every scene_type's approved question keys + seed wording up front —
    Gemini picks from whichever scene_type's list matches what it classifies
    the photo as, adapting the seed wording to that specific photo rather
    than inventing new question categories. One call in, one call out —
    this doesn't add a second Gemini round-trip.
    """
    lines = []
    for scene_type in SCENE_TYPES:
        keys = PROMPT_KEYS_BY_SCENE_TYPE.get(scene_type, [])
        if not keys:
            continue
        lines.append(f"- {scene_type}:")
        for key in keys:
            seed = PROMPT_TEXT.get(key, "")
            seed_options = PROMPT_OPTIONS.get(key, [])
            lines.append(f'  - {key}: "{seed}" options: {seed_options}')
    return "\n".join(lines)


def validate_style(style: str) -> None:
    if style not in STYLES:
        raise ValueError(f"Unknown style: {style}")
