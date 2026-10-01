<!--
Fills $plan in scene_analysis.md when the sketcher marked focal points or
drew marks. Image 2 is sent with it. Built in features/scene_analysis/service.py.
Variables:
  $focal_points     "- Focal points: ..." with one entry per point, only for sketches
                    that still have focal points (retired, design doc item 17); else empty
  $marks_table      one short line per mark with its id, in stroke order (core/mark_geometry.py marks_table)
  $selected_shapes  the selected shapes and their marks, or "none selected"
  $spots            where selected marks meet other marks (core/mark_geometry.py spots), or "none"
  $links            how the marks group into shapes and connect (core/mark_geometry.py groups_text),
                    so the relationship section can see marks that reach from one subject to another
-->
Image 2 shows the plan the sketcher made before this analysis. Each mark has a small label with its id at the point where the stroke started.
$focal_points- Marks by id, in stroke order (m1 was drawn first):
$marks_table
- Selected shapes (what the sketcher chose to focus on):
$selected_shapes
- Spots where the selected marks meet other marks:
$spots
- How the marks group into shapes (s1, s2, ...) and connect:
$links
