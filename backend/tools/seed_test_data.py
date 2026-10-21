"""
Test data for SketchConnect (testing plan, October 2026).

Makes six seed sketchers with profiles, kits, admired sketchers, sketches
at every stage, uploads, likes, comments and follows, plus the images they
use. Every seed login's email ends in @seed.sketchconnect.test, and every
seed image starts with "seed_", so --reset removes what this script made
and nothing else.

Run from backend/ with the venv on:

  python tools/seed_test_data.py --dry-run      images and a row count, no database
  python tools/seed_test_data.py                create everything
  python tools/seed_test_data.py --me <handle>  also link the seed sketchers to your account
  python tools/seed_test_data.py --reset        remove all seed data
  python tools/seed_test_data.py --fixtures     photos for the live upload tests, in debug_out/

Two values in backend/.env that the app itself does not read:

  SUPABASE_SERVICE_ROLE_KEY  creates and deletes the seed logins
  SEED_PASSWORD              the password every seed sketcher signs in with

The sketch images are drawn here, not real photos. They are good for
testing pages, lists, the map and uploads. For the AI calls (scene
analysis, marks analysis, critique), use real photos from the fixtures or
your phone.
"""
import argparse
import hashlib
import math
import os
import random
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402

import config  # noqa: E402,F401  loads backend/.env
from app.core.paths import UPLOAD_DIR  # noqa: E402

SEED_DOMAIN = "seed.sketchconnect.test"
SEED_PREFIX = "seed_"
FIXTURE_DIR = BACKEND / "debug_out"
NOW = datetime.utcnow().replace(microsecond=0)


# ---------------------------------------------------------------------------
# The sketchers. Four are the design doc personas; Lena is the professional
# sketcher and Sam is a new member with nothing yet (empty states).
# ---------------------------------------------------------------------------

KYOTO_PALACE = (35.0254, 135.7621)  # Kenreimon Gate

SKETCHERS = [
    {
        "handle": "marcus.tan",
        "name": "Marcus Tan",
        "location": "Singapore",
        "bio": "Civil engineer and dad of two. I sketch in the 20 minutes before school pickup.",
        "links": {"instagram": "https://instagram.com/example.marcus"},
        "color": (52, 106, 140),
        "favorite_paints": ["pb29", "pbr7-burnt-sienna", "py97", "pr108", "pg7", "paynes-gray"],
        "admired": [
            {"name": "Liz Steel", "location": "Sydney", "link": "https://www.lizsteel.com",
             "voice": "Warm and practical. Talks about tea, edges and capturing the moment fast.",
             "priorities": ["simple shapes first", "line and wash", "enjoy the process"], "tone": "encouraging"},
        ],
        "kit": [
            ("line", "Sakura Pigma Micron 03", {"size": "0.35 mm", "waterproof": True, "note": "the everyday line"}, [], None, None, True),
            ("color", "Ultramarine Blue", {"brand": "Daniel Smith"}, ["PB29"], "watercolor", "transparent", False),
            ("color", "Burnt Sienna", {"brand": "Daniel Smith"}, ["PBr7"], "watercolor", "transparent", False),
            ("color", "Hansa Yellow Medium", {"brand": "Daniel Smith"}, ["PY97"], "watercolor", "transparent", False),
            ("brush", "Escoda waterbrush", {"size": "medium"}, [], None, None, False),
            ("paper", "Stillman & Birn Beta A5", {"weight": "270 gsm", "surface": "cold_press"}, [], None, None, False),
        ],
        "sketches": [
            {"key": "marcus_chinatown", "title": "Chinatown shophouses", "kind": "street", "scene": "architectural",
             "at": (1.2834, 103.8443), "label": "Chinatown, Singapore", "days": 3, "stage": "complete", "progress": 2,
             "media": ["fineliner", "watercolor"], "values": 5, "mask": "triad", "critique": True, "persona": "Liz Steel",
             "notes": "Late afternoon. Five-foot way in shade, upper floors in full sun.",
             "principles": [("rhythm", "strong", ["shape", "line"], "The repeated windows set a beat along the row."),
                            ("emphasis", "moderate", ["value"], "The dark doorway pulls the eye to the middle shop.")]},
            {"key": "marcus_marina", "title": "Marina Bay from the bridge", "kind": "waterfront", "scene": "open_landscape",
             "at": (1.2868, 103.8545), "label": "Marina Bay, Singapore", "days": 40, "stage": "complete", "progress": 0,
             "media": ["fineliner", "watercolor"], "values": 3, "mask": None, "critique": True, "persona": None,
             "notes": "Windy. Kept the sky loose.",
             "principles": [("balance", "strong", ["shape", "space"], "The skyline on the right balances the open water on the left.")]},
            {"key": "marcus_hawker", "title": "Hawker centre lunch", "kind": "crowd", "scene": "figure",
             "at": (1.2806, 103.8504), "label": "Lau Pa Sat, Singapore", "days": 1, "stage": "sketching", "progress": 0,
             "media": ["fineliner"], "values": None, "mask": None, "critique": False, "persona": None,
             "notes": None,
             "principles": [("movement", "strong", ["line"], "The queue leads the eye from the front to the stall.")]},
        ],
    },
    {
        "handle": "david.whitfield",
        "name": "David Whitfield",
        "location": "Kyoto, Japan",
        "bio": "Retired architect. I teach weekend sketch walks around Kyoto.",
        "links": {"website": "https://example.com/david-sketch-walks", "facebook": "https://facebook.com/example.david"},
        "color": (120, 72, 48),
        "favorite_paints": ["pb29", "pbr7-raw-sienna", "pr255", "pg7", "neutral-tint"],
        "admired": [
            {"name": "Ian Fennelly", "location": "Sydney", "link": "https://www.ianfennelly.com",
             "voice": "Direct and confident. Talks about bold shapes, values and editing the scene.",
             "priorities": ["big value shapes", "edit what you see", "commit to the line"], "tone": "direct"},
            {"name": "Paul Wang", "location": "Singapore", "link": None,
             "voice": "", "priorities": [], "tone": ""},  # voice not built yet: tests the "not ready" state
        ],
        "kit": [
            ("line", "Staedtler Mars Lumograph 2B", {"note": "for the first layout"}, [], None, None, True),
            ("line", "Lamy Safari, extra fine", {"ink": "Platinum Carbon Black", "waterproof": True}, [], None, None, False),
            ("color", "Raw Sienna", {"brand": "Winsor & Newton"}, ["PBr7"], "watercolor", "transparent", False),
            ("color", "Pyrrol Scarlet", {"brand": "Daniel Smith"}, ["PR255"], "watercolor", "transparent", False),
            ("brush", "Rosemary travel brush", {"size": "8"}, [], None, None, False),
            ("paper", "Moleskine watercolor album", {"surface": "cold_press"}, [], None, None, False),
        ],
        "sketches": [
            {"key": "david_kenreimon", "title": "Kenreimon Gate, Kyoto Imperial Palace", "kind": "temple", "scene": "architectural",
             "at": KYOTO_PALACE, "label": "Kyoto Imperial Palace, Kyoto", "days": 6, "stage": "complete", "progress": 1,
             "media": ["pencil", "fountain_pen", "watercolor"], "values": 5, "mask": "complementary", "critique": True, "persona": "Ian Fennelly",
             "notes": "Sketch walk with the Saturday group. Gravel glare everywhere.",
             "principles": [("balance", "strong", ["shape"], "The gate sits square in the frame, a symmetrical balance."),
                            ("emphasis", "strong", ["value", "color"], "The dark roof against the pale sky holds the eye.")]},
            {"key": "david_gion", "title": "Gion evening lanterns", "kind": "street", "scene": "architectural",
             "at": (35.0037, 135.7788), "label": "Gion, Kyoto", "days": 120, "stage": "complete", "progress": 0,
             "media": ["fountain_pen", "watercolor"], "values": 3, "mask": None, "critique": False, "persona": None,
             "notes": "Warm lanterns, cool street.",
             "principles": [("unity", "moderate", ["color"], "Two dominant colors tie the street together.")]},
            {"key": "david_path", "title": "Philosopher's Path in autumn", "kind": "landscape", "scene": "open_landscape",
             "at": (35.0222, 135.7944), "label": "Philosopher's Path, Kyoto", "days": 2, "stage": "progress", "progress": 1,
             "media": ["pencil", "watercolor"], "values": None, "mask": None, "critique": False, "persona": None,
             "notes": "Came back for the color the next day.",
             "principles": [("movement", "strong", ["line"], "The path curves the eye into the trees.")]},
        ],
    },
    {
        "handle": "priya.nair",
        "name": "Priya Nair",
        "location": "Bangkok, Thailand",
        "bio": "Reportage sketcher. Markets, temples and people. I post every page of the process.",
        "links": {"instagram": "https://instagram.com/example.priya", "tiktok": "https://tiktok.com/@example.priya"},
        "color": (176, 58, 90),
        "favorite_paints": ["pb35", "pr83", "py43", "pv23", "pw6"],
        "admired": [
            {"name": "Marc Taro Holmes", "location": "Montreal", "link": None,
             "voice": "Lively and observant. Talks about gesture, people in a scene and a fast first pass.",
             "priorities": ["gesture over detail", "people give scale", "three-pass method"], "tone": "lively"},
        ],
        "kit": [
            ("line", "Pentel brush pen", {"waterproof": True}, [], None, None, True),
            ("color", "Winsor & Newton gouache set", {"brand": "Winsor & Newton"}, ["PW6", "PR83"], "gouache", "opaque", False),
            ("color", "Quinacridone Gold", {"brand": "Daniel Smith"}, ["PY150"], "watercolor", "transparent", False),
            ("paper", "Hahnemuhle sketch book, landscape", {"weight": "140 gsm"}, [], None, None, False),
        ],
        "sketches": [
            {"key": "priya_palace_wall", "title": "Imperial Palace garden wall", "kind": "temple", "scene": "architectural",
             "at": (35.0262, 135.7632), "label": "Kyoto Imperial Palace, Kyoto", "days": 9, "stage": "complete", "progress": 9,
             "media": ["markers", "gouache"], "values": 7, "mask": "analogous", "critique": True, "persona": "Marc Taro Holmes",
             "notes": "Ten pages, three sittings. Same place David sketched last week.",
             "principles": [("pattern", "strong", ["texture", "line"], "The roof tiles repeat across the wall."),
                            ("variety", "moderate", ["color"], "A pop of red against the grey wall.")]},
            {"key": "priya_watarun", "title": "Wat Arun at dusk", "kind": "temple", "scene": "architectural",
             "at": (13.7437, 100.4889), "label": "Wat Arun, Bangkok", "days": 15, "stage": "complete", "progress": 3,
             "media": ["fineliner", "gouache"], "values": 5, "mask": "triad", "critique": False, "persona": None,
             "notes": "From the ferry pier. Lights came on halfway through.",
             "principles": [("emphasis", "strong", ["value"], "The pale spire against the dusk sky.")]},
            {"key": "priya_chatuchak", "title": "Chatuchak market crowd", "kind": "crowd", "scene": "figure",
             "at": (13.7999, 100.5502), "label": "Chatuchak, Bangkok", "days": 0, "stage": "progress", "progress": 10,
             "media": ["markers"], "values": None, "mask": None, "critique": False, "persona": None,
             "notes": "At the 10-page cap on purpose: the upload button should refuse an 11th.",
             "principles": [("movement", "strong", ["line"], "People walking left pull the eye across.")]},
        ],
    },
    {
        "handle": "dana.johnson",
        "name": "Dana Johnson",
        "location": None,  # no location on the profile either
        "bio": "Sketching at home from my own photos and the weekly prompts.",
        "links": {},
        "color": (88, 120, 70),
        "favorite_paints": [],
        "admired": [],
        "kit": [
            ("ink", "Platinum Carbon Black", {"waterproof": True}, [], None, None, False),
            ("brush", "Kuretake water brush", {"size": "large"}, [], None, None, False),
        ],
        "sketches": [
            {"key": "dana_pastries", "title": "Sunday pastries", "kind": "still_life", "scene": "still_life_organic",
             "at": None, "label": None, "days": 12, "stage": "complete", "progress": 0,
             "media": ["fountain_pen", "watercolor"], "values": 3, "mask": None, "critique": True, "persona": None,
             "notes": "From a photo. No location: should not show on the map.",
             "principles": [("unity", "strong", ["color"], "Warm browns tie the plate together.")]},
            {"key": "dana_teapot", "title": "Grandma's teapot", "kind": "still_life", "scene": "still_life_organic",
             "at": None, "label": None, "days": 30, "stage": "complete", "progress": 1,
             "media": ["fountain_pen"], "values": None, "mask": None, "critique": False, "persona": None,
             "notes": None,
             "principles": [("proportion", "moderate", ["shape"], "The spout and handle balance the round body.")]},
        ],
    },
    {
        "handle": "lena.ortiz",
        "name": "Lena Ortiz",
        "location": "Lisbon, Portugal",
        "bio": "Professional illustrator. Commissions, workshops and a sketchbook every month.",
        "links": {"instagram": "https://instagram.com/example.lena", "website": "https://example.com/lena-ortiz",
                  "facebook": "https://facebook.com/example.lena", "tiktok": "https://tiktok.com/@example.lena"},
        "color": (196, 120, 40),
        "favorite_paints": ["pb29", "pb15-3", "py150", "pbr7-burnt-sienna", "pv19", "pg7", "pbk6"],
        "admired": [
            {"name": "Ian Fennelly", "location": "Sydney", "link": "https://www.ianfennelly.com",
             "voice": "Direct and confident. Talks about bold shapes, values and editing the scene.",
             "priorities": ["big value shapes", "edit what you see"], "tone": "direct"},
            {"name": "Liz Steel", "location": "Sydney", "link": "https://www.lizsteel.com",
             "voice": "Warm and practical. Talks about edges and capturing the moment fast.",
             "priorities": ["simple shapes first", "line and wash"], "tone": "encouraging"},
        ],
        "kit_photo": True,
        "kit": [
            ("line", "Uni Pin fineliner 0.1", {"size": "0.1 mm", "waterproof": True}, [], None, None, True),
            ("line", "Uni Pin fineliner 0.5", {"size": "0.5 mm", "waterproof": True}, [], None, None, False),
            ("ink", "De Atramentis Document Black", {"waterproof": True}, [], None, None, False),
            ("color", "Phthalo Blue (GS)", {"brand": "Schmincke"}, ["PB15:3"], "watercolor", "transparent", True),
            ("color", "Quinacridone Rose", {"brand": "Schmincke"}, ["PV19"], "watercolor", "transparent", False),
            ("color", "Nickel Azo Yellow", {"brand": "Daniel Smith"}, ["PY150"], "watercolor", "transparent", False),
            ("color", "Permanent White gouache", {"brand": "Holbein"}, ["PW6"], "gouache", "opaque", False),
            ("brush", "Da Vinci Casaneo travel", {"size": "6"}, [], None, None, False),
            ("paper", "Arches cold press block", {"weight": "300 gsm", "surface": "cold_press"}, [], None, None, False),
            ("extra", "Folding stool", {"note": "hidden on purpose: others should not see it"}, [], None, None, False, True),
        ],
        "featured": ["lena_tram", "lena_alfama", "lena_belem", "lena_kyoto", "lena_porto", "lena_draft"],  # 6: cap is 5, and the draft must not show
        "sketches": [
            {"key": "lena_tram", "title": "Tram 28 on Rua da Conceicao", "kind": "street", "scene": "mixed",
             "at": (38.7101, -9.1370), "label": "Baixa, Lisbon", "days": 5, "stage": "complete", "progress": 2,
             "media": ["fineliner", "watercolor"], "values": 5, "mask": "triad", "critique": True, "persona": "Ian Fennelly",
             "notes": "Commission study.",
             "principles": [("emphasis", "strong", ["color"], "The yellow tram against cool shadows.")]},
            {"key": "lena_alfama", "title": "Alfama rooftops", "kind": "street", "scene": "architectural",
             "at": (38.7114, -9.1300), "label": "Alfama, Lisbon", "days": 21, "stage": "complete", "progress": 0,
             "media": ["fineliner", "watercolor"], "values": 3, "mask": None, "critique": False, "persona": None,
             "notes": None,
             "principles": [("rhythm", "strong", ["shape"], "Roofs step down the hill in a beat.")]},
            {"key": "lena_belem", "title": "Torre de Belém", "kind": "temple", "scene": "architectural",
             "at": (38.6916, -9.2160), "label": "Belém, Lisbon", "days": 60, "stage": "complete", "progress": 1,
             "media": ["fineliner", "watercolor", "gouache"], "values": 5, "mask": "complementary", "critique": False, "persona": None,
             "notes": "Accented title on purpose: search 'Belem' and 'Belém'.",
             "principles": [("balance", "moderate", ["shape"], "The tower sits off-centre against open sky.")]},
            {"key": "lena_kyoto", "title": "Palace south wall", "kind": "temple", "scene": "architectural",
             "at": (35.0216, 135.7621), "label": "Kyoto Imperial Palace, Kyoto", "days": 200, "stage": "complete", "progress": 0,
             "media": ["fineliner", "watercolor"], "values": None, "mask": None, "critique": False, "persona": None,
             "notes": "About 420 m south of Kenreimon: outside the 300 m 'near here' radius.",
             "principles": [("unity", "moderate", ["color"], "One wash ties the wall and sky.")]},
            {"key": "lena_porto", "title": "Ribeira riverfront", "kind": "waterfront", "scene": "open_landscape",
             "at": (41.1405, -8.6110), "label": "Ribeira, Porto", "days": 90, "stage": "complete", "progress": 0,
             "media": ["fineliner", "watercolor"], "values": 5, "mask": None, "critique": False, "persona": None,
             "notes": None,
             "principles": [("rhythm", "strong", ["shape"], "Facades repeat along the river.")]},
            {"key": "lena_sintra", "title": "Pena Palace hill", "kind": "landscape", "scene": "open_landscape",
             "at": (38.7876, -9.3906), "label": "Sintra, Portugal", "days": 150, "stage": "complete", "progress": 0,
             "media": ["watercolor"], "values": None, "mask": None, "critique": False, "persona": None,
             "notes": None,
             "principles": [("movement", "moderate", ["line"], "The road winds up to the palace.")]},
            {"key": "lena_draft", "title": "Cais do Sodre market", "kind": "crowd", "scene": "figure",
             "at": (38.7068, -9.1459), "label": "Cais do Sodre, Lisbon", "days": 1, "stage": "sketching", "progress": 0,
             "media": ["fineliner"], "values": None, "mask": None, "critique": False, "persona": None,
             "notes": "Draft: must not show to anyone but Lena, even though it is in her featured list.",
             "principles": [("movement", "strong", ["line"], "Stalls lead the eye in.")]},
        ],
    },
    {
        "handle": "sam.lee",
        "name": "Sam Lee",
        "location": None,
        "bio": None,
        "links": {},
        "color": (110, 110, 120),
        "favorite_paints": [],
        "admired": [],
        "kit": [],
        "sketches": [],  # new member: every empty state
    },
]

FOLLOWS = [
    ("marcus.tan", "david.whitfield"), ("priya.nair", "david.whitfield"), ("lena.ortiz", "david.whitfield"),
    ("david.whitfield", "priya.nair"), ("marcus.tan", "lena.ortiz"), ("priya.nair", "lena.ortiz"),
    ("david.whitfield", "lena.ortiz"), ("sam.lee", "lena.ortiz"), ("dana.johnson", "lena.ortiz"),
]

LIKES = [
    ("david.whitfield", "marcus_chinatown"), ("priya.nair", "marcus_chinatown"), ("lena.ortiz", "marcus_chinatown"),
    ("priya.nair", "david_kenreimon"), ("lena.ortiz", "david_kenreimon"), ("marcus.tan", "david_kenreimon"),
    ("david.whitfield", "priya_palace_wall"), ("marcus.tan", "priya_palace_wall"),
    ("marcus.tan", "lena_tram"), ("priya.nair", "lena_tram"), ("david.whitfield", "lena_tram"),
    ("sam.lee", "lena_tram"), ("dana.johnson", "lena_tram"), ("dana.johnson", "priya_watarun"),
]

COMMENTS = [
    ("david.whitfield", "marcus_chinatown", 2, "The dark doorway really works. How long did this take you?"),
    ("marcus.tan", "marcus_chinatown", 2, "About 25 minutes, then the wash at home."),
    ("priya.nair", "david_kenreimon", 5, "I sat by the garden wall the week after. Your roof shape helped me."),
    ("david.whitfield", "priya_palace_wall", 8, "Ten pages! Lovely to see each stage."),
    ("lena.ortiz", "priya_palace_wall", 7, "That red pop is perfect."),
    ("sam.lee", "lena_tram", 3, "New here. Which yellow is that?"),
    ("lena.ortiz", "lena_tram", 3, "Nickel Azo Yellow, with a little Quinacridone Rose."),
    ("dana.johnson", "dana_pastries", 11, "Note to self: try a 3-value study first next time."),
    # Unicode and a long comment, near the 1000-character cap.
    ("priya.nair", "lena_alfama", 18, "Que lindo! 屋根のリズムが素敵です。 " + "The roofs step down so well. " * 30),
]

# Gamut masks on the Yurmby wheel: hue 0-360, chroma 0-1.
MASKS = {
    "triad": [{"h": 30, "c": 0.85}, {"h": 150, "c": 0.6}, {"h": 260, "c": 0.8}],
    "complementary": [{"h": 20, "c": 0.9}, {"h": 60, "c": 0.4}, {"h": 200, "c": 0.9}, {"h": 240, "c": 0.4}],
    "analogous": [{"h": 340, "c": 0.9}, {"h": 20, "c": 0.9}, {"h": 60, "c": 0.5}, {"h": 0, "c": 0.15}],
}

TIPS = {
    "fineliner": ("Line weight", "Use the 0.5 for the near edges and the 0.1 for the far ones."),
    "pencil": ("Light layout", "Block the big shapes lightly before any detail."),
    "fountain_pen": ("Broken line", "Lift the pen where light hits an edge."),
    "watercolor": ("Save the whites", "Leave the paper bare where the light is brightest."),
    "gouache": ("Light last", "Paint the light accents last, opaque over the darks."),
    "markers": ("Two greys", "Use one warm grey and one cool grey for the shadows."),
}


# ---------------------------------------------------------------------------
# Images: a drawn "photo" and sketch pages that fill in stage by stage.
# ---------------------------------------------------------------------------

PAPER = (244, 239, 228)
INK = (38, 36, 40)


def _rnd(key: str) -> random.Random:
    return random.Random(int(hashlib.md5(key.encode()).hexdigest()[:12], 16))


def _shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def _scene(kind: str, rnd: random.Random, w: int, h: int) -> dict:
    """The shapes of one scene: sky, ground and objects, in drawing order."""
    horizon = int(h * rnd.uniform(0.55, 0.68))
    skies = [((126, 172, 214), (214, 230, 240)), ((236, 150, 104), (120, 108, 160)), ((170, 190, 205), (232, 232, 228))]
    sky = rnd.choice(skies)
    ground = rnd.choice([(150, 140, 120), (120, 130, 95), (170, 160, 140)])
    shapes = []  # (type, geometry, color)

    if kind == "street":
        x = -rnd.randint(0, 60)
        while x < w:
            bw = rnd.randint(140, 260)
            top = rnd.randint(int(h * 0.12), int(h * 0.38))
            col = rnd.choice([(214, 180, 140), (190, 120, 100), (220, 205, 170), (150, 170, 160), (230, 214, 120)])
            shapes.append(("rect", (x, top, x + bw, horizon + 40), col))
            shapes.append(("poly", [(x - 8, top), (x + bw + 8, top), (x + bw - 10, top - 26), (x + 10, top - 26)], _shade(col, 0.7)))
            for wy in range(top + 30, horizon - 40, 70):
                for wx in range(x + 22, x + bw - 40, 56):
                    shapes.append(("rect", (wx, wy, wx + 26, wy + 40), (70, 80, 96)))
            shapes.append(("rect", (x + bw // 2 - 22, horizon - 50, x + bw // 2 + 22, horizon + 40), (52, 44, 40)))
            x += bw
    elif kind == "temple":
        cx = w // 2 + rnd.randint(-120, 120)
        shapes.append(("rect", (0, horizon - 90, w, horizon + 20), (212, 206, 196)))  # wall
        shapes.append(("rect", (0, horizon - 110, w, horizon - 90), (92, 96, 100)))  # wall roof
        gw = rnd.randint(340, 460)
        for px in (cx - gw // 2, cx + gw // 2 - 40):
            shapes.append(("rect", (px, int(h * 0.32), px + 40, horizon + 20), (168, 64, 44)))
        shapes.append(("rect", (cx - gw // 2 - 20, int(h * 0.30), cx + gw // 2 + 20, int(h * 0.34)), (150, 58, 40)))
        for i, rh in enumerate((0.16, 0.24)):
            y = int(h * rh)
            span = gw // 2 + 120 - i * 50
            shapes.append(("poly", [(cx - span, y + 50), (cx + span, y + 50), (cx + span - 90, y), (cx - span + 90, y)], (70, 74, 82)))
    elif kind == "landscape":
        for i, (k, col) in enumerate(((0.45, (120, 140, 160)), (0.55, (96, 128, 96)), (0.7, (84, 112, 70)))):
            base = int(h * k)
            amp, ph = rnd.randint(30, 80), rnd.random() * 6
            pts = [(x, base - amp * math.sin(x / (180 + 60 * i) + ph)) for x in range(0, w + 40, 40)]
            shapes.append(("poly", pts + [(w, h), (0, h)], col))
        for _ in range(rnd.randint(5, 9)):
            tx, ty = rnd.randint(0, w), rnd.randint(int(h * 0.6), int(h * 0.85))
            r = rnd.randint(40, 90)
            shapes.append(("rect", (tx - 6, ty, tx + 6, ty + r), (90, 64, 44)))
            shapes.append(("ellipse", (tx - r, ty - r, tx + r, ty + r // 3), rnd.choice([(196, 96, 50), (214, 150, 60), (90, 130, 70)])))
        shapes.append(("poly", [(w * 0.42, h), (w * 0.58, h), (w * 0.52, h * 0.66), (w * 0.49, h * 0.66)], (200, 186, 160)))
    elif kind == "waterfront":
        x = int(w * 0.45)
        while x < w:
            bw, top = rnd.randint(60, 130), rnd.randint(int(h * 0.15), int(h * 0.45))
            shapes.append(("rect", (x, top, x + bw, horizon), rnd.choice([(170, 180, 190), (200, 196, 180), (140, 150, 170)])))
            x += bw + rnd.randint(4, 20)
        shapes.append(("rect", (0, horizon, w, h), (90, 130, 160)))
        shapes.append(("poly", [(0, horizon + 60), (w * 0.4, horizon + 10), (w * 0.4, horizon + 30), (0, horizon + 80)], (110, 104, 100)))
        for _ in range(8):
            yy = rnd.randint(horizon + 40, h - 20)
            xx = rnd.randint(0, w - 200)
            shapes.append(("line", [(xx, yy), (xx + rnd.randint(80, 200), yy)], (200, 220, 230)))
    elif kind == "still_life":
        horizon = int(h * 0.45)
        sky = ((214, 200, 180), (230, 220, 204))
        ground = (176, 130, 92)
        for _ in range(rnd.randint(3, 5)):
            ox, oy = rnd.randint(140, w - 260), rnd.randint(int(h * 0.42), int(h * 0.7))
            r = rnd.randint(70, 150)
            col = rnd.choice([(214, 160, 84), (196, 120, 60), (230, 220, 200), (110, 140, 170), (170, 60, 50)])
            shapes.append(("ellipse", (ox + 10, oy + r - 20, ox + 2 * r + 30, oy + r + 30), (130, 96, 70)))  # shadow
            shapes.append(("ellipse", (ox, oy, ox + 2 * r, oy + int(r * 1.3)), col))
        shapes.append(("ellipse", (w * 0.2, h * 0.75, w * 0.8, h * 0.98), (236, 234, 228)))  # plate
    elif kind == "crowd":
        for i in range(rnd.randint(3, 4)):
            sx = int(i * w / 3.6) + rnd.randint(0, 40)
            col = rnd.choice([(200, 70, 60), (60, 120, 170), (220, 170, 60), (90, 150, 90)])
            shapes.append(("rect", (sx, int(h * 0.35), sx + 300, horizon), (120, 100, 84)))
            shapes.append(("poly", [(sx - 20, int(h * 0.36)), (sx + 320, int(h * 0.36)), (sx + 150, int(h * 0.2))], col))
        for _ in range(rnd.randint(9, 15)):
            fx, fy = rnd.randint(30, w - 30), rnd.randint(horizon - 60, h - 160)
            s = 0.7 + (fy - horizon + 60) / h
            col = rnd.choice([(60, 60, 70), (200, 80, 70), (230, 200, 90), (70, 110, 160), (240, 240, 236)])
            shapes.append(("ellipse", (fx - 34 * s, fy, fx + 34 * s, fy + 150 * s), col))
            shapes.append(("ellipse", (fx - 18 * s, fy - 38 * s, fx + 18 * s, fy), (200, 160, 130)))
    return {"horizon": horizon, "sky": sky, "ground": ground, "shapes": shapes}


def _draw_shape(d: ImageDraw.ImageDraw, s, fill=None, outline=None, width=1):
    kind, g, _ = s
    if kind == "rect":
        d.rectangle(g, fill=fill, outline=outline, width=width)
    elif kind == "ellipse":
        d.ellipse(g, fill=fill, outline=outline, width=width)
    elif kind == "poly":
        d.polygon(g, fill=fill, outline=outline, width=width) if fill else d.line(list(g) + [g[0]], fill=outline, width=width)
    elif kind == "line":
        d.line(g, fill=fill or outline, width=max(width, 3))


def render_photo(kind: str, key: str, size: tuple[int, int]) -> Image.Image:
    w, h = size
    rnd = _rnd(key)
    sc = _scene(kind, rnd, w, h)
    img = Image.new("RGB", size, sc["sky"][0])
    d = ImageDraw.Draw(img)
    top, bottom = sc["sky"]
    for y in range(sc["horizon"]):
        t = y / max(1, sc["horizon"])
        d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))
    d.rectangle((0, sc["horizon"], w, h), fill=sc["ground"])
    for s in sc["shapes"]:
        _draw_shape(d, s, fill=s[2])
    noise = Image.effect_noise(size, 18).convert("RGB")
    img = Image.blend(img, noise, 0.06).filter(ImageFilter.GaussianBlur(1.2))
    return img


def _wobble(rnd, pts, amt=2.5):
    return [(x + rnd.uniform(-amt, amt), y + rnd.uniform(-amt, amt)) for x, y in pts]


def _outline_pts(s):
    kind, g, _ = s
    if kind == "rect":
        x0, y0, x1, y1 = g
        return [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    if kind == "ellipse":
        x0, y0, x1, y1 = g
        cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
        return [(cx + rx * math.cos(a / 20 * math.tau), cy + ry * math.sin(a / 20 * math.tau)) for a in range(21)]
    if kind == "poly":
        return list(g) + [g[0]]
    return list(g)


def render_sketch_page(kind: str, key: str, size: tuple[int, int], stage: float) -> Image.Image:
    """A sketch page `stage` of the way done (0-1). Lines go in big shapes
    first, then detail; washes come in after 60%; the final adds darks."""
    w, h = size
    sc = _scene(kind, _rnd(key), w, h)
    rnd = _rnd(key + f"-page-{stage:.2f}")
    page = Image.new("RGB", size, PAPER)
    tex = Image.effect_noise(size, 10).convert("RGB")
    page = Image.blend(page, tex, 0.04)

    shapes = sorted(sc["shapes"], key=lambda s: -_area(s))
    if stage >= 0.6:
        wash = Image.new("RGBA", size, (0, 0, 0, 0))
        wd = ImageDraw.Draw(wash)
        alpha = int(70 + 90 * (stage - 0.6) / 0.4)
        wd.rectangle((0, 0, w, sc["horizon"]), fill=(*sc["sky"][0], alpha // 2))
        wd.rectangle((0, sc["horizon"], w, h), fill=(*sc["ground"], alpha // 2))
        shown = shapes[: int(len(shapes) * min(1, (stage - 0.4) / 0.6))]
        for s in shown:
            if s[0] == "line":
                continue
            ox, oy = rnd.uniform(-8, 8), rnd.uniform(-8, 8)
            moved = (s[0], _offset(s[1], ox, oy, s[0]), s[2])
            _draw_shape(wd, moved, fill=(*s[2], alpha))
        wash = wash.filter(ImageFilter.GaussianBlur(3))
        page = Image.alpha_composite(page.convert("RGBA"), wash).convert("RGB")

    d = ImageDraw.Draw(page)
    count = max(1, int(len(shapes) * min(1.0, stage / 0.7)))
    d.line([(0, sc["horizon"]), (w, sc["horizon"])], fill=INK, width=1)
    for i, s in enumerate(shapes[:count]):
        width = 3 if i < 4 else 2 if i < 15 else 1
        pts = _wobble(rnd, _outline_pts(s))
        d.line(pts, fill=INK, width=width, joint="curve")
    if stage >= 0.95:  # darks and hatching on the final
        for s in shapes[: min(8, len(shapes))]:
            if s[0] != "rect":
                continue
            x0, y0, x1, y1 = s[1]
            for xx in range(int(x0), int(x1), 9):
                d.line([(xx, y1 - (y1 - y0) * 0.25), (xx + 12, y1)], fill=_shade(INK, 1.6), width=1)
    return page


def _area(s):
    kind, g, _ = s
    if kind in ("rect", "ellipse"):
        return abs((g[2] - g[0]) * (g[3] - g[1]))
    if kind == "poly":
        xs, ys = [p[0] for p in g], [p[1] for p in g]
        return (max(xs) - min(xs)) * (max(ys) - min(ys))
    return 0


def _offset(g, ox, oy, kind):
    if kind in ("rect", "ellipse"):
        return (g[0] + ox, g[1] + oy, g[2] + ox, g[3] + oy)
    return [(x + ox, y + oy) for x, y in g]


def _font(px: int):
    try:
        return ImageFont.load_default(size=px)
    except TypeError:  # Pillow older than 10.1
        return ImageFont.load_default()


def render_avatar(name: str, color) -> Image.Image:
    img = Image.new("RGB", (256, 256), color)
    d = ImageDraw.Draw(img)
    initials = "".join(p[0] for p in name.split()[:2]).upper()
    d.text((128, 128), initials, fill=(250, 248, 242), font=_font(110), anchor="mm")
    return img


def render_kit_photo(key: str) -> Image.Image:
    """A flat lay: a paint tin, pens and a brush on a table."""
    rnd = _rnd(key)
    img = Image.new("RGB", (1200, 900), (196, 170, 140))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((120, 160, 640, 520), 24, fill=(40, 40, 46))
    for i in range(12):
        x, y = 150 + (i % 6) * 80, 200 + (i // 6) * 150
        d.rectangle((x, y, x + 64, y + 110), fill=(236, 236, 230))
        d.rectangle((x + 6, y + 6, x + 58, y + 104), fill=tuple(rnd.randint(40, 230) for _ in range(3)))
    for i, col in enumerate([(30, 30, 30), (30, 30, 30), (200, 40, 40), (40, 80, 160)]):
        y = 600 + i * 55
        d.rounded_rectangle((180, y, 900, y + 26), 12, fill=col)
    d.rectangle((760, 140, 1060, 560), fill=(248, 246, 238))  # sketchbook
    d.line([(980, 120), (1100, 760)], fill=(130, 90, 50), width=14)  # brush
    return img.filter(ImageFilter.GaussianBlur(0.8))


def _save(img: Image.Image, name: str) -> str:
    UPLOAD_DIR.mkdir(exist_ok=True)
    path = UPLOAD_DIR / name
    if name.endswith(".png"):
        img.save(path, format="PNG")
    else:
        img.save(path, format="JPEG", quality=86)
    return f"/uploads/{name}"


def sketch_images(sk: dict) -> dict:
    """Writes the reference photo and the sketch pages for one sketch."""
    size = (960, 1280) if sk["kind"] in ("still_life",) else (1280, 960)
    key = sk["key"]
    out = {"reference": _save(render_photo(sk["kind"], key, size), f"{SEED_PREFIX}{key}_ref.jpg"), "pages": []}
    n = sk["progress"]
    final = sk["stage"] == "complete"
    total = n + (1 if final else 0)
    for i in range(total):
        is_final = final and i == total - 1
        stage = 1.0 if is_final else (i + 1) / (total + (0 if final else 1)) * 0.9
        name = f"{SEED_PREFIX}{key}_{'final' if is_final else f'p{i + 1:02d}'}.jpg"
        out["pages"].append(_save(render_sketch_page(sk["kind"], key, size, stage), name))
    return out


# ---------------------------------------------------------------------------
# AI results, written as the app stores them, so pages render without
# calling Gemini. Shapes follow marks_analysis/service.py and mock_critique.json.
# ---------------------------------------------------------------------------

def strokes(key: str, count: int) -> list[dict]:
    rnd = _rnd(key + "-strokes")
    colors = ["#f87171", "#fde68a", "#86efac"]
    out, t = [], 0
    for i in range(count):
        x, y = rnd.uniform(150, 850), rnd.uniform(150, 850)
        pts = [[round(x + j * rnd.uniform(8, 18), 1), round(y + 40 * math.sin(j / 3 + i), 1)] for j in range(12)]
        if i == count - 1:  # the last one is a lone dot: a focal spot
            pts = [[round(x, 1), round(y, 1)]]
        dur = rnd.randint(400, 1800)
        out.append({"id": f"m{i + 1}", "source": "own", "color": colors[0], "width": 2.0, "size_mm": 1.0,
                    "points": pts, "started_ms": t, "duration_ms": dur})
        t += dur + rnd.randint(300, 2500)
    return out


def cached_analysis(sk: dict, marks: list[dict]) -> dict:
    ids = [m["id"] for m in marks]
    principles = []
    for i, (name, group, elements, why) in enumerate(sk["principles"]):
        tips = [{"name": TIPS[m][0], "tip": TIPS[m][1]} for m in sk["media"] if m in TIPS][:1] or \
               [{"name": "Squint", "tip": "Squint to see the big value shapes."}]
        principles.append({"principle": name, "group": group, "mark_ids": ids[i::2][:3], "elements": elements,
                           "why": why, "tips": tips, "relationships": []})
    cleaned = {
        "marks": [{"mark_id": m, "traces": "a main shape", "element": "line", "role": "contour",
                   "fit": "close", "depth": "middle"} for m in ids],
        "plan_read": {"principles": principles, "relationships": []},
        "areas": [],
        "media": sk["media"],
        "stroke_order_note": "The big shapes came first, then the focal spot.",
    }
    return {
        "scene_summary": f"[SEED] {sk['title']}.",
        "scene_type": sk["scene"],
        "focal_regions": [],
        "marks_analysis": {"fingerprint": "seed", "cleaned": cleaned},
    }


def critique_row(sk: dict, persona_label: str | None) -> dict:
    p = sk["principles"][0][0]
    voice = f" ({persona_label})" if persona_label else ""
    return {
        "decision_trace": {
            "habits": [{"observation": "Kept the focal spot from the plan to the final sketch.", "principle": p, "evidence": "intended"},
                       {"observation": "Blocked in the big shapes before detail.", "principle": "proportion", "evidence": "instinct"}],
            "opportunities": [{"observation": "Try a 3-value study before the first wash.", "principle": "emphasis", "evidence": "stages"}],
        },
        "critique": f"[SEED]{voice} Your plan held up. The {p} you aimed for shows in the final sketch. "
                    "What would change with one more dark near the focal spot?",
        "prior_review_summary": "First review for this sketch.",
    }


# ---------------------------------------------------------------------------
# Supabase logins (admin API, service role key)
# ---------------------------------------------------------------------------

def _admin():
    import httpx
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not key or not config.SUPABASE_URL:
        sys.exit("Add SUPABASE_SERVICE_ROLE_KEY to backend/.env first (SUPABASE_URL is already there).")
    return httpx.Client(base_url=f"{config.SUPABASE_URL}/auth/v1/admin",
                        headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=20)


def seed_logins(client) -> dict[str, str]:
    """{email: user id} for every login on the seed domain."""
    found, page = {}, 1
    while True:
        r = client.get("/users", params={"page": page, "per_page": 200})
        r.raise_for_status()
        users = r.json().get("users", [])
        for u in users:
            if (u.get("email") or "").endswith("@" + SEED_DOMAIN):
                found[u["email"]] = u["id"]
        if len(users) < 200:
            return found
        page += 1


def create_login(client, email: str, name: str, password: str) -> str:
    r = client.post("/users", json={"email": email, "password": password, "email_confirm": True,
                                    "user_metadata": {"full_name": name, "seed": True}})
    if r.status_code >= 400:
        sys.exit(f"Could not create {email}: {r.status_code} {r.json().get('msg') or r.text[:200]}")
    return r.json()["id"]


# ---------------------------------------------------------------------------
# Build, reset, fixtures
# ---------------------------------------------------------------------------

def build(dry_run: bool, me: str | None):
    from geoalchemy2.elements import WKTElement

    if dry_run:
        ids = {s["handle"]: f"00000000-0000-4000-8000-{i:012d}" for i, s in enumerate(SKETCHERS, 1)}
        db = None
    else:
        password = os.environ.get("SEED_PASSWORD", "")
        if len(password) < 8:
            sys.exit("Add SEED_PASSWORD (8 or more characters) to backend/.env first.")
        from app.core.database import SessionLocal
        from app.core.handles import is_taken
        client = _admin()
        if seed_logins(client):
            sys.exit("Seed data is already there. Run with --reset first.")
        db = SessionLocal()
        for s in SKETCHERS:
            if is_taken(db, s["handle"]):
                sys.exit(f"The handle {s['handle']} is taken by a real profile. Rename it in SKETCHERS.")
        ids = {s["handle"]: create_login(client, f"{s['handle']}@{SEED_DOMAIN}", s["name"], password) for s in SKETCHERS}

    from app.core.models import (CritiqueResponse, Follow, KitItem, Persona, Profile, Sketch,
                                 SketchComment, SketchLike, SketchUpload)
    rows, sketch_ids, counts = [], {}, {}

    def add(row):
        rows.append(row)
        counts[type(row).__name__] = counts.get(type(row).__name__, 0) + 1

    for s in SKETCHERS:
        uid = ids[s["handle"]]
        avatar = _save(render_avatar(s["name"], s["color"]), f"{SEED_PREFIX}avatar_{s['handle']}.png")
        kit_photo = _save(render_kit_photo(s["handle"]), f"{SEED_PREFIX}kit_{s['handle']}.jpg") if s.get("kit_photo") else None
        profile = Profile(id=uid, display_name=s["name"], avatar_url=avatar, location=s["location"], handle=s["handle"],
                          bio=s["bio"], links=s["links"] or None, kit_photo_url=kit_photo,
                          favorite_paints=s["favorite_paints"] or None, created_at=NOW - timedelta(days=240))
        add(profile)

        personas = {}
        for a in s["admired"]:
            p = Persona(sketcher_id=uid, style=None, admired_artist_name=a["name"], persona_source="sketcher_provided",
                        persona_label=f"{a['name']} (admired)", admired_link=a["link"], admired_location=a["location"],
                        voice=a["voice"], priorities=a["priorities"], tone=a["tone"] or "")
            p.id = str(uuid.uuid4())
            personas[a["name"]] = p
            add(p)

        for i, item in enumerate(s["kit"]):
            kind, label, details, codes, medium, opacity, pinned, *hidden = item
            add(KitItem(sketcher_id=uid, kind=kind, label=label, details=details, pigment_codes=codes, medium=medium,
                        opacity=opacity, source="own", pinned=pinned, hidden=bool(hidden and hidden[0]),
                        created_at=NOW - timedelta(days=200, minutes=-i)))

        for sk in s["sketches"]:
            images = sketch_images(sk)
            created = NOW - timedelta(days=sk["days"], hours=_rnd(sk["key"]).randint(0, 8))
            marks = strokes(sk["key"], 5)
            sketch = Sketch(sketcher_id=uid, title=sk["title"], field_notes=sk["notes"],
                            scene_type=sk["scene"] if sk["stage"] == "complete" else None,
                            cached_scene_analysis=cached_analysis(sk, marks),
                            reference_image_url=images["reference"], original_image_url=images["reference"],
                            marks=marks, created_at=created, captured_at=created - timedelta(minutes=5),
                            session_choices=[{"key": "media", "prompt": "What do you draw with?", "media": sk["media"],
                                              "answered_at": created.isoformat() + "Z"}],
                            value_levels=sk["values"], gamut_mask={"shapes": [{"type": "polygon", "corners": MASKS[sk["mask"]]}]} if sk["mask"] else None)
            sketch.id = str(uuid.uuid4())
            if sk["at"]:
                sketch.location = WKTElement(f"POINT({sk['at'][1]} {sk['at'][0]})", srid=4326)
                sketch.location_label = sk["label"]
            persona = personas.get(sk["persona"]) if sk["persona"] else None
            if persona:
                sketch.persona_id = persona.id
            if sk["stage"] == "complete":
                sketch.final_sketch_url = images["pages"][-1]
                sketch.final_sketch_provided = True
                sketch.palettes = {"scene": s["favorite_paints"][:5] or ["pb29", "pbr7-burnt-sienna", "py97"],
                                   "sketch": (s["favorite_paints"] or ["pb29", "pbr7-burnt-sienna"])[:4]}
            add(sketch)
            sketch_ids[sk["key"]] = sketch.id
            for pos, url in enumerate(images["pages"]):
                add(SketchUpload(sketch_id=sketch.id, sketcher_id=uid, url=url, position=pos,
                                 created_at=created + timedelta(hours=pos + 1)))
            if sk["critique"] and sk["stage"] == "complete":
                c = critique_row(sk, sk["persona"])
                add(CritiqueResponse(sketch_id=sketch.id, sketcher_id=uid, final_sketch_provided=True,
                                     created_at=created + timedelta(hours=len(images["pages"]) + 1), **c))
                sketch.critique_status = "done"

        if s.get("featured"):
            profile.featured_sketch_ids = [sketch_ids[k] for k in s["featured"]]

    for a, b in FOLLOWS:
        add(Follow(follower_id=ids[a], followed_id=ids[b], created_at=NOW - timedelta(days=30)))
    for h, k in LIKES:
        add(SketchLike(sketch_id=sketch_ids[k], sketcher_id=ids[h], created_at=NOW - timedelta(days=1)))
    for h, k, days, body in COMMENTS:
        add(SketchComment(sketch_id=sketch_ids[k], author_id=ids[h], body=body[:1000], created_at=NOW - timedelta(days=days)))

    if me and not dry_run:
        owner = db.query(Profile).filter(Profile.handle == me.lstrip("@").lower()).first()
        if owner is None:
            sys.exit(f"No profile with the handle {me}. Open your sketcher page once, then try again.")
        mine = (db.query(Sketch).filter(Sketch.sketcher_id == owner.id, Sketch.final_sketch_url.isnot(None))
                .order_by(Sketch.created_at.desc()).limit(2).all())
        for h in ("marcus.tan", "david.whitfield", "priya.nair"):
            add(Follow(follower_id=ids[h], followed_id=owner.id))
        for sk in mine:
            for h in ("marcus.tan", "priya.nair", "lena.ortiz"):
                add(SketchLike(sketch_id=sk.id, sketcher_id=ids[h]))
            add(SketchComment(sketch_id=sk.id, author_id=ids["david.whitfield"], body="Nice framing. Where were you standing?"))
            add(SketchComment(sketch_id=sk.id, author_id=ids["lena.ortiz"], body="Love the colour here."))
        print(f"Linked to @{owner.handle}: 3 followers, likes and comments on {len(mine)} of your shared sketches.")

    if dry_run:
        print("Dry run: images written to", UPLOAD_DIR, "| no database or logins touched.")
    else:
        # Profiles and personas first, so every foreign key has its row.
        order = ["Profile", "Persona", "KitItem", "Sketch", "SketchUpload", "CritiqueResponse", "Follow", "SketchLike", "SketchComment"]
        for name in order:
            db.add_all([r for r in rows if type(r).__name__ == name])
            db.flush()
        db.commit()
        db.close()
        print(f"Done. Sign in as any <handle>@{SEED_DOMAIN} with SEED_PASSWORD.")
    for name, n in counts.items():
        print(f"  {name:16} {n}")


def reset():
    from app.core.database import SessionLocal
    from app.core.models import (CritiqueResponse, Follow, HelpQuestLog, KitItem, Persona, Profile, Sketch,
                                 SketchComment, SketchLike, SketchUpload)
    client = _admin()
    logins = seed_logins(client)
    db = SessionLocal()
    uids = list(logins.values())
    if uids:
        sketch_ids = [r[0] for r in db.query(Sketch.id).filter(Sketch.sketcher_id.in_(uids)).all()]
        for model, cond in [
            (SketchComment, SketchComment.author_id.in_(uids)),
            (SketchComment, SketchComment.sketch_id.in_(sketch_ids)),
            (SketchLike, SketchLike.sketcher_id.in_(uids)),
            (SketchLike, SketchLike.sketch_id.in_(sketch_ids)),
            (Follow, Follow.follower_id.in_(uids)),
            (Follow, Follow.followed_id.in_(uids)),
            (SketchUpload, SketchUpload.sketch_id.in_(sketch_ids)),
            (CritiqueResponse, CritiqueResponse.sketch_id.in_(sketch_ids)),
            (HelpQuestLog, HelpQuestLog.sketch_id.in_(sketch_ids)),
            (KitItem, KitItem.sketcher_id.in_(uids)),
            (Sketch, Sketch.id.in_(sketch_ids)),
            (Persona, Persona.sketcher_id.in_(uids)),
            (Profile, Profile.id.in_(uids)),
        ]:
            db.query(model).filter(cond).delete(synchronize_session=False)
        db.commit()
    db.close()
    for email, uid in logins.items():
        client.delete(f"/users/{uid}").raise_for_status()
    files = list(UPLOAD_DIR.glob(f"{SEED_PREFIX}*"))
    for f in files:
        f.unlink()
    print(f"Removed {len(logins)} seed logins, their rows and {len(files)} seed images.")


def _gps(value: float):
    value = abs(value)
    d = int(value)
    m = int((value - d) * 60)
    s = round((value - d - m / 60) * 3600, 2)
    return (float(d), float(m), float(s))


def fixtures():
    """Photos for the live tests that go through the real upload and AI calls."""
    FIXTURE_DIR.mkdir(exist_ok=True)
    made = []

    def save(img, name, lat=None, lon=None, taken=None, orientation=None):
        exif = Image.Exif()
        if taken:
            exif[0x0132] = taken  # DateTime
            exif.get_ifd(0x8769)[0x9003] = taken  # DateTimeOriginal
        if lat is not None:
            gps = exif.get_ifd(0x8825)
            gps.update({1: "N" if lat >= 0 else "S", 2: _gps(lat), 3: "E" if lon >= 0 else "W", 4: _gps(lon)})
        if orientation:
            exif[0x0112] = orientation
        img.save(FIXTURE_DIR / name, format="JPEG", quality=88, exif=exif.tobytes())
        made.append(name)

    save(render_photo("temple", "fx-kyoto", (1280, 960)), "fixture_gps_kyoto_imperial_palace.jpg",
         35.02545, 135.76215, "2026:10:18 10:12:00")
    save(render_photo("temple", "fx-bkk", (1280, 960)), "fixture_gps_bangkok_wat_arun.jpg",
         13.74372, 100.48890, "2026:10:19 17:40:00")
    save(render_photo("street", "fx-nogps", (1280, 960)), "fixture_no_gps.jpg", taken="2026:10:20 09:00:00")
    save(render_photo("street", "fx-rot", (1280, 960)), "fixture_rotated_exif6.jpg", orientation=6)
    save(render_photo("landscape", "fx-big", (5200, 3900)), "fixture_large_5200px.jpg")
    save(render_sketch_page("street", "fx-sketch", (1280, 960), 1.0), "fixture_final_sketch.jpg")
    (FIXTURE_DIR / "fixture_not_an_image.jpg").write_text("This is text with a .jpg name. Upload must refuse it.\n")
    made.append("fixture_not_an_image.jpg")
    print("Fixtures in", FIXTURE_DIR)
    for m in made:
        print("  ", m)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="write the images, touch no database or logins")
    ap.add_argument("--reset", action="store_true", help="remove every seed login, row and image")
    ap.add_argument("--fixtures", action="store_true", help="write photos for the live upload tests to debug_out/")
    ap.add_argument("--me", help="your own handle: seed sketchers follow you and like and comment on your sketches")
    args = ap.parse_args()
    if args.reset:
        reset()
    elif args.fixtures:
        fixtures()
    else:
        build(args.dry_run, args.me)
