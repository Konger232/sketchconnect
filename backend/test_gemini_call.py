import json
from PIL import Image

from app.services.gemini_client import call_gemini_json_with_raw, MOCK_RESPONSE_PATH

# 1. The file currently at mock_scene_analysis.json holds the real schema
#    (just not a real response), so we can reuse it straight from disk.
response_schema = json.loads(MOCK_RESPONSE_PATH.read_text())

# 2. Paste the full prompt text you already showed me, between the triple quotes.
prompt = """
You are observing a reference photo for an urban sketcher who is about to draw it on location, in the 'realistic' style. Classify the scene into exactly one scene_type using these definitions:
... (paste the whole thing you pasted to me, all of it, up to the last paragraph about black margins)
"""

# 3. Point this at any real photo you have on your computer.
image = Image.open("app/services/mockdata/IMG_2212.jpeg")

result, raw_text = call_gemini_json_with_raw(prompt, response_schema, image)
print("Done. Check mock_scene_analysis.json now.")