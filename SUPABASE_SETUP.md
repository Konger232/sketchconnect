# Supabase setup

SketchConnect's Postgres lives on Supabase (design doc, Section 3): one
instance backs both the relational data and auth, with PostGIS available
for the location work already wired into `sketches.location`.

This is a walkthrough for you to run yourself — account creation and
signing in aren't things I can do on your behalf.

## 1. Create the project

1. Go to https://supabase.com and sign up / log in.
2. **New project** → name it `sketchconnect` (any region is fine for dev).
3. Save the database password somewhere — you'll need it for `DATABASE_URL`.
4. Wait for provisioning (~2 minutes).

## 2. Run the schema

1. In the Supabase dashboard: **SQL Editor** → **New query**.
2. Paste the contents of `backend/db/schema.sql` and run it.
   This enables PostGIS, creates all five tables, and turns on Row Level
   Security so each sketcher can only see their own rows.

## 3. Collect your keys

From **Project Settings**:

- **API** → `Project URL` → this is `SUPABASE_URL` (backend) and
  `VITE_SUPABASE_URL` (frontend). Already filled in both `.env` files.
- **API** → `Publishable key` (Supabase's current name for what used to
  be called the "anon" key) → this is `VITE_SUPABASE_ANON_KEY`
  (frontend only — it's meant to be public, safe in a shipped bundle).
- **API** → `JWT Settings` → `JWT Secret` → this is `SUPABASE_JWT_SECRET`
  (backend only). This project is on the **Legacy JWT Secret (HS256)**
  setting, not the newer asymmetric JWT Signing Keys, so the backend
  verifies tokens with this shared secret directly (`backend/app/auth.py`)
  rather than fetching a JWKS.
- **Database** → `Connection string` → `URI` (the "Direct connection"
  variant is fine for a dev box) → fill in the password from step 1 →
  this is `DATABASE_URL` (backend).

## 4. Fill in your env files

```
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit both with the values from step 3, plus your existing
`GEMINI_API_KEY` in `backend/.env` (already there from the earlier
prototype — no need to regenerate it).

## 5. Enable email auth (or add a provider)

**Authentication → Providers**: email/password is on by default, which is
enough to start. Add Google/GitHub OAuth later if you want one-tap sign-in
— the frontend's `lib/supabaseClient.js` doesn't care which provider is
used, it just reads the resulting session.

## 6. Verify

```
cd backend && source .venv/bin/activate && uvicorn main:app --reload
curl http://localhost:8000/health
```

should return `{"status": "ok"}`. A real end-to-end check (calling
`/api/scene-analysis`) needs a logged-in Supabase session's JWT, which
you'll get once the frontend's login screen is wired up and you sign in
through it.
