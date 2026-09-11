# SketchConnect

AI companion for urban sketchers, drawing on location from direct
observation. Full design is in `ai_sketch_mentor_design_doc.md` and
`gemini_call_schemas.md` (kept in the Sketch Connect Claude project).

- `frontend/` — Vite + React, Tailwind. Capture, guided sketch flow,
  profile/feedback, settings.
- `backend/` — FastAPI. Three scoped Gemini calls (scene analysis, persona
  creation, critique agent) plus Help Quest and plain sketch CRUD, all
  returning structured JSON via `responseSchema`.
- `backend/legacy/` — the Phase-0 OpenCV prototype (deterministic
  perspective/value-study detection), preserved and still mounted under
  `/legacy`, but not part of the current architecture.

## First-time setup

Docker isn't installed on this machine, so this runs natively — a Python
venv for the backend, `npm` for the frontend. (`docker-compose.yml` is
still here and works if you set up Docker later.)

### 1. Supabase (Postgres + Auth)

Follow `SUPABASE_SETUP.md` — creates the project, runs the schema, and
tells you what goes in each `.env` file. Do this first; both servers need
`DATABASE_URL`/`SUPABASE_URL` to boot cleanly.

### 2. Backend

```
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in DATABASE_URL, SUPABASE_URL, GEMINI_API_KEY
uvicorn main:app --reload
```

- API docs: http://localhost:8000/docs
- Health check: http://localhost:8000/health

To open the app from another device on the same Wi-Fi (e.g. a phone,
for a quick mobile check), add `--host 0.0.0.0` to the uvicorn command
above -- by default it only listens on localhost. The frontend's `npm
run dev` already binds `0.0.0.0` and CORS already allows a private-
network origin on port 5173 (see `backend/config.py`), so once the
backend is reachable too, open the "Network:" URL Vite prints when it
starts, from the phone's browser.

### 3. Frontend

```
cd frontend
npm install
cp .env.example .env   # then fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev
```

- App: http://localhost:5173

## What's real vs. what's a first pass

- Backend: routes, schemas, DB models, Supabase JWT verification, EXIF
  location extraction, and the Gemini call wrapper are all wired end to
  end. `backend/app/rules.py`'s prompt copy is placeholder text — replace
  it as the actual prepared-prompt content gets designed per scene type.
- Frontend: every screen walked through in the Figma prototype has a
  matching page/component (Home, Capture, guided sketch flow with the
  AI bottom-sheet pattern, Profile/Feedback Summary, Settings), styled
  to the same palette and layout. Treat this as a working first pass, not
  a pixel-perfect match — refine spacing/assets against the Figma file
  directly as you go.
- Image storage: uploaded photos are written to `backend/uploads/` for
  local dev. Swap for Supabase Storage before deploying anywhere shared.
- A previous Cloud Run deployment of the *old* OpenCV backend exists
  (see `frontend/.env`'s comment) — unrelated to this setup, still running
  the Phase-0 prototype until redeployed.

## Notes on this setup vs. production

- CORS in `backend/config.py`'s `ALLOWED_ORIGINS` is locked to
  `http://localhost:5173`. Update before deploying.
- Drop `--reload` from the backend's run command before deploying to
  Cloud Run.
