# Deploying SketchConnect

The backend runs on Google Cloud Run in Tokyo (`asia-northeast1`, next to
Supabase). The frontend is a static build on Firebase Hosting. Images live in
the private Supabase Storage bucket `sketch-images`.

In the commands below, replace:

- `PROJECT_ID`: your Google Cloud project ID
- `PROJECT_NUMBER`: its project number (on the project's Dashboard)
- `SUPABASE_URL_VALUE`: your Supabase project URL (`https://….supabase.co`)

Secrets are typed into your own terminal. They never go in a file in the repo.

## 0. Before you start (once)

1. Images are in the bucket: `STORAGE_BUCKET=sketch-images` in `backend/.env`,
   `python tools/upload_to_supabase.py` has run, and the app works locally.
2. Install the Google Cloud CLI (`gcloud`): `brew install --cask google-cloud-sdk`,
   or the macOS installer from cloud.google.com/sdk. Check with `gcloud --version`.
3. The Firebase CLI runs through `npx`, with no global install (a global
   `npm install -g` fails with a permission error on this Mac; don't use
   `sudo`). Check with `npx firebase-tools --version` and answer `y` the first
   time. Everywhere below, `npx firebase-tools` is the `firebase` command.
4. Sign in, then find the project ID and number with `gcloud projects list`
   (the ID is the lowercase name with dashes, not the display name):

   ```
   gcloud auth login
   gcloud config set project PROJECT_ID
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
     artifactregistry.googleapis.com secretmanager.googleapis.com
   ```

## 1. Secrets (once)

Four values go in Secret Manager. For each name below, run the two commands,
paste the value when the second one waits, press Enter, then Ctrl-D:

```
gcloud secrets create NAME --replication-policy=automatic
gcloud secrets versions add NAME --data-file=-
```

| NAME | Value |
|---|---|
| `GEMINI_API_KEY` | from backend/.env |
| `DATABASE_URL` | from backend/.env. Must be Supabase's **pooler** string (Session pooler): Cloud Run can't reach the direct connection. |
| `SUPABASE_SERVICE_ROLE_KEY` | from backend/.env |
| `MEDIA_SIGNING_KEY` | from backend/.env, or a new long random string |

Let Cloud Run read them:

```
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

## 2. The backend

From the `backend` folder:

```
gcloud run deploy sketchconnect-api --source . --region asia-northeast1 \
  --allow-unauthenticated --memory 1Gi --cpu 1 --no-cpu-throttling \
  --min-instances 0 --max-instances 1 --timeout 300 \
  --set-env-vars STORAGE_BUCKET=sketch-images,SUPABASE_URL=SUPABASE_URL_VALUE \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest,DATABASE_URL=DATABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,MEDIA_SIGNING_KEY=MEDIA_SIGNING_KEY:latest
```

The first build takes a few minutes. It ends with a Service URL like
`https://sketchconnect-api-….asia-northeast1.run.app`. Open `<that URL>/health`:
it should answer.

Why these settings:

- `--no-cpu-throttling`: the critique runs in the background after the upload
  answers. Without this, Cloud Run nearly stops the CPU once the answer is sent.
- `--max-instances 1`: one server, so its caches never disagree.
- `--min-instances 0`: no cost when nobody uses it. The first visit after a
  quiet spell waits about 10 seconds. For the committee's review week, set it
  to 1 (step 6).
- `.dockerignore` keeps `.env` and `uploads/` out of the image.

## 3. The frontend

Add Firebase to the same Google project (once):

```
npx firebase-tools login
npx firebase-tools projects:addfirebase PROJECT_ID
```

From the `frontend` folder, create `.env.production` with the backend's
address (not a secret):

```
VITE_API_URL=https://sketchconnect-api-….asia-northeast1.run.app
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` come from `frontend/.env` as
they are. Then build and publish:

```
npm run build
npx firebase-tools deploy --only hosting --project PROJECT_ID
```

The site is at `https://PROJECT_ID.web.app`.

## 4. Connect the two (once)

Let the site talk to the backend:

```
gcloud run services update sketchconnect-api --region asia-northeast1 \
  --update-env-vars FRONTEND_ORIGINS=https://PROJECT_ID.web.app,https://PROJECT_ID.firebaseapp.com
```

In Supabase, Authentication > URL Configuration:

- Site URL: `https://PROJECT_ID.web.app`
- Redirect URLs: add `https://PROJECT_ID.web.app/**` (keep the localhost one)

Google sign-in goes through Supabase's own callback, so the Google client
needs no change.

## 5. Check it

On your phone, on mobile data (not your Wi-Fi):

1. Open the site as a visitor: Explore, the map and the teasers load.
2. Sign in with Google: you come back signed in.
3. Open one of your sketches: the reference photo, plan and final sketch show.
4. Start a new sketch: upload a photo, draw strokes, get the AI guide.
5. Upload a progress shot and a final: the critique arrives.
6. Share > Instagram on the phone: the share sheet opens.

If something fails, read the server's log:
Cloud Run > sketchconnect-api > Logs.

## 6. Day to day

- Backend changes: run the step 2 command again from `backend`.
- Frontend changes, from `frontend`: `npm run build` then
  `npx firebase-tools deploy --only hosting --project PROJECT_ID`.
- Review week, no waiting on first visit (costs while on):

  ```
  gcloud run services update sketchconnect-api --region asia-northeast1 --min-instances 1
  ```

  Afterwards, set it back to 0.
- Set a budget alert in Billing > Budgets & alerts, for example US$20 a month.
- The older Cloud Run service from the first prototype can be deleted once
  this one works.
