<!--
Help Quest call (features/help_quest/service.py).
Variables:
  $scene_type, $style  shared session context from scene analysis
  $question            the sketcher's question, as typed
  $step_id             which guided prompt is on screen
  $plan_context        help_quest_plan.md or help_quest_no_plan.md
-->
An urban sketcher, mid-session on a '$scene_type' scene in '$style' style, asks: "$question" (currently on screen: $step_id). $plan_context Answer grounded in the Elements and Principles of Design (UC Berkeley Library guide). Never say what to draw — only ground the answer in a design principle. Keep it short, a nudge, not a lecture.
