"""
Debug output for the backend terminal, only with DEBUG=true in .env
(config.DEBUG). Plain print(), not logging, so it shows up directly in the
uvicorn --reload terminal next to the Gemini call it belongs to.
"""
import json
from datetime import datetime
from pathlib import Path

from config import DEBUG
from app.core import mark_geometry

# Complete marks, every point included, one file per sketch and call.
# Git-ignored (backend/debug_out/).
DEBUG_DIR = Path(__file__).resolve().parents[2] / "debug_out"


def print_marks(label: str, sketch_id: str | None, marks: list[dict] | None, aspect: float | None = 1.0) -> None:
    """
    Everything about a sketch's marks, before a Gemini call: one line per
    mark with every field (erased marks included), then the shapes, links
    and spots the geometry found, in frame units. The complete marks, with
    every point, go to debug_out/marks_<sketch>_<label>.json; the terminal
    shows the path, since a sketch can hold thousands of points.
    """
    if not DEBUG:
        return
    marks = marks or []
    print("\n" + "-" * 80)
    print(f"[marks {label}] sketch {sketch_id}: {len(marks)} marks "
          f"({len(mark_geometry.visible_marks(marks))} visible), frame aspect {aspect:.3f}")
    for i, m in enumerate(marks):
        pts = m.get("points") or []
        extras = {k: v for k, v in m.items() if k not in ("points",)}
        extras.setdefault("id", mark_geometry.mark_id(m, i))
        where = f"{len(pts)} pts, start {pts[0]}, end {pts[-1]}" if pts else "no points"
        print(f"  {json.dumps(extras, default=str)}  [{where}]")
    geo = mark_geometry.analyse(marks, aspect)
    for f in geo["marks"]:
        print(f"  {f['id']}: {f['kind']}{' (guide)' if f['guide'] else ''}{' (big)' if f.get('big') else ''}, box {f['box']}")
    print("  " + mark_geometry.groups_text(geo).replace("\n", "\n  "))
    selected = {f["id"] for f in geo["marks"] if f.get("selected")}
    print("  spots (selected marks):\n  " + mark_geometry.spots_text(mark_geometry.spots(geo, selected)).replace("\n", "\n  "))
    try:
        DEBUG_DIR.mkdir(exist_ok=True)
        path = DEBUG_DIR / f"marks_{sketch_id or 'unsaved'}_{label}.json"
        path.write_text(json.dumps({
            "sketch_id": sketch_id,
            "call": label,
            "written_at": datetime.now().isoformat(timespec="seconds"),
            "frame_aspect": aspect,
            "marks": marks,
            "geometry": geo,
        }, indent=2, default=str))
        print(f"  complete marks with every point: {path}")
    except OSError as exc:
        print(f"  (could not write the marks file: {exc})")
    print("-" * 80)


# ---------- Browser <-> FastAPI traffic ----------

import re
import time


def _content_type(headers: list[tuple[bytes, bytes]]) -> str:
    for k, v in headers:
        if k.lower() == b"content-type":
            return v.decode("latin-1")
    return ""


_SECRET_KEY = re.compile(r"pass(word)?|secret|token|api[_-]?key|authori[sz]ation", re.I)


def _redact(value):
    """Masks any field whose name looks like a secret (password, token,
    api_key, ...). Sign-in goes to Supabase, not here, so this is a safety net."""
    if isinstance(value, dict):
        return {k: "***" if _SECRET_KEY.search(str(k)) else _redact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


def _pretty(text: str) -> str:
    s = text.strip()
    if s[:1] in ("{", "["):
        try:
            return json.dumps(_redact(json.loads(s)), indent=2, ensure_ascii=False)
        except ValueError:
            pass
    return text


def _multipart(body: bytes, content_type: str) -> str:
    """Form fields as text, uploaded files as name, filename and size."""
    m = re.search(r'boundary="?([^";]+)"?', content_type)
    if not m:
        return f"({len(body)} bytes of multipart data)"
    lines = []
    for part in body.split(b"--" + m.group(1).encode()):
        part = part.strip(b"\r\n")
        if not part or part == b"--":
            continue
        head, _, content = part.partition(b"\r\n\r\n")
        head = head.decode("latin-1")
        name = re.search(r'name="([^"]*)"', head)
        name = name.group(1) if name else "?"
        filename = re.search(r'filename="([^"]*)"', head)
        if filename:
            lines.append(f"  {name}: file {filename.group(1)!r} ({len(content)} bytes)")
        elif _SECRET_KEY.search(name):
            lines.append(f"  {name}: ***")
        else:
            value = _pretty(content.decode("utf-8", "replace"))
            lines.append(f"  {name}: " + value.replace("\n", "\n    "))
    return "\n".join(lines) or "(no fields)"


def _format_body(body: bytes, content_type: str) -> str:
    if not body:
        return "(empty)"
    ct = content_type.lower()
    if "multipart/form-data" in ct:
        return _multipart(body, content_type)
    if "x-www-form-urlencoded" in ct:
        from urllib.parse import parse_qsl
        pairs = parse_qsl(body.decode("utf-8", "replace"), keep_blank_values=True)
        return "\n".join(f"  {k}: {'***' if _SECRET_KEY.search(k) else v}" for k, v in pairs)
    if "json" in ct or "text" in ct:
        return _pretty(body.decode("utf-8", "replace"))
    return f"({len(body)} bytes, {content_type or 'no content type'})"


class DebugTrafficMiddleware:
    """
    DEBUG only (main.py adds it when DEBUG=true): prints every request the
    browser sends to FastAPI and every response FastAPI sends back, with
    their bodies. JSON is pretty-printed; in a form upload, text fields are
    shown in full and files as name, filename and size, never their bytes.
    Headers are not printed, so the sign-in token never shows, and any
    body field named like a password, token or key prints as ***.
    Only the endpoints in WATCH print: marks, guided answers, scene
    analysis, critique and help quest. A plain ASGI middleware, so the
    request body still reaches the endpoint untouched.
    """

    # Only the calls worth reading while testing guidance. Add a pattern
    # here to watch another endpoint.
    WATCH = [
        (m, re.compile(r)) for m, r in [
            ("PUT",  r"^/api/sketches/[^/]+$"),                      # marks saved
            ("PUT",  r"^/api/sketches/[^/]+/marks/selection$"),      # marks selected
            ("POST", r"^/api/sketches/[^/]+/marks/adopt$"),          # "Add it to your plan"
            ("POST", r"^/api/sketches/[^/]+/session-choices$"),      # guided answers
            ("POST", r"^/api/scene-analysis$"),                      # guided questions
            ("POST", r"^/api/critique$"),                            # art coach
            ("POST", r"^/api/help-quest$"),                          # help quest
        ]
    ]

    @classmethod
    def _watched(cls, method: str, path: str) -> bool:
        return any(m == method and r.match(path) for m, r in cls.WATCH)

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not self._watched(scope["method"], scope["path"]):
            return await self.app(scope, receive, send)

        started = time.perf_counter()
        request_body = []
        response = {"status": None, "headers": [], "body": []}

        async def receive_and_keep():
            message = await receive()
            if message["type"] == "http.request":
                request_body.append(message.get("body", b""))
            return message

        async def send_and_keep(message):
            if message["type"] == "http.response.start":
                response["status"] = message["status"]
                response["headers"] = message.get("headers", [])
            elif message["type"] == "http.response.body":
                response["body"].append(message.get("body", b""))
                if not message.get("more_body"):
                    self._print(scope, b"".join(request_body), response, started)
            await send(message)

        await self.app(scope, receive_and_keep, send_and_keep)

    @staticmethod
    def _print(scope, request_body: bytes, response: dict, started: float) -> None:
        query = scope.get("query_string", b"").decode("latin-1")
        path = scope["path"] + (f"?{query}" if query else "")
        ms = round((time.perf_counter() - started) * 1000)
        print("\n" + "~" * 80)
        print(f"[FastAPI] -> {scope['method']} {path}")
        print(_format_body(request_body, _content_type(scope.get("headers", []))))
        print(f"[FastAPI] <- {response['status']} ({ms} ms)")
        print(_format_body(b"".join(response["body"]), _content_type(response["headers"])))
        print("~" * 80)
