# SketchConnect — local dev scaffold

Two Docker containers, wired together with Docker Compose:

- `backend/` — FastAPI + OpenCV. Real, working `/analyze` endpoint using the
  same perspective-detection approach tested earlier in this project
  (Canny edges → Hough transform → line intersection clustering).
- `frontend/` — Vite + React. Uploads a photo, calls the backend, draws the
  returned perspective lines and vanishing point on a canvas over the photo.

## First-time setup

1. Copy the env template and fill in real keys later (not needed to test
   the perspective detection, only needed once you wire up `/gemini-proxy`):

   ```
   cp backend/.env.example backend/.env
   ```

2. Build and start both containers:

   ```
   docker compose up --build
   ```

3. Open the frontend: http://localhost:5173
   Open the backend's auto-generated API docs: http://localhost:8000/docs

4. Upload a photo with clear straight lines (a street, a hallway, a building
   shot at an angle) and watch the white lines and red vanishing point circle
   get drawn on top of it.

## What's real vs. what's a stub

- `/analyze` is fully working, not a placeholder. It's the same code
  validated against a synthetic test scene (2.4px of error) earlier in
  this project.
- `/gemini-proxy` is a stub. Add your Gemini API key to `backend/.env`,
  then fill in the actual `google.generativeai` call inside
  `backend/main.py`, using the structured JSON prompt format already
  tested in this project (overall_read, observations, bbox coordinates).

## Notes on this setup vs. production

- The frontend Dockerfile here runs Vite's dev server with hot reload,
  meant for local development only. For a real deployment, either:
  (a) build a production Dockerfile that runs `vite build` and serves
  the static output through nginx, or
  (b) skip Docker for the frontend entirely and deploy the static build
  to something like Vercel or Netlify, which is simpler for a React SPA.
- The backend Dockerfile is close to production-ready as-is, drop the
  `--reload` flag in the final CMD before deploying to Cloud Run.
- CORS in `main.py` is currently locked to `http://localhost:5173`.
  Update this to your real frontend domain before deploying anywhere.
