<!--
Help Quest call (features/help_quest/service.py).
Variables:
  $scene_type          from scene analysis
  $style_note          " in 'reportage' style", or empty before the sketcher picks a style
                       (they pick it at the final sketch upload)
  $question            the sketcher's question, as typed
  $step_id             which guided prompt is on screen
  $plan_context        help_quest_plan.md or help_quest_no_plan.md
-->
An urban sketcher, mid-session on a '$scene_type' scene$style_note, asks: "$question" (currently on screen: $step_id). $plan_context Answer grounded in the Elements and Principles of Design (UC Berkeley Library guide). Never say what to draw — only ground the answer in a design principle. Keep it short, a nudge, not a lecture.
