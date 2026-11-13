# Deploying SketchConnect

The backend runs on Google Cloud Run in Tokyo (`asia-northeast1`, next to
Supabase). The frontend is a static build on Firebase Hosting. Images live in
the private Supabase Storage bucket `sketch-images`.

In the commands below, replace:

- `PROJECT_ID`: sketchconnect-app-2026
- `PROJECT_NUMBER`: 799683070133
- `SUPABASE_URL_VALUE`: https://vsjfzoljlpvctrepxbde.supabase.co

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

Four values go in Secret Manager: the table below lists them. Each takes two
commands. Run them **one at a time**: paste one line, press Enter, wait for
its answer, then the next. Two lines pasted together run as one broken
command ("unrecognized arguments"), and the second then fails with
"NOT_FOUND".

| NAME | Value |
|---|---|
| `GEMINI_API_KEY` | from backend/.env |
| `DATABASE_URL` | from backend/.env. Must be Supabase's **Session pooler** string (it contains `pooler.supabase.com`): Cloud Run can't reach the direct connection. |
| `SUPABASE_SERVICE_ROLE_KEY` | from backend/.env |
| `MEDIA_SIGNING_KEY` | from backend/.env. None yet: make one with `openssl rand -hex 32` and add it to backend/.env too |

**First command: create the empty secret.** Replace NAME:

```
gcloud secrets create NAME --replication-policy=automatic
```

Answer: `Created secret [NAME].`

**Second command: store its value.** Replace NAME, and replace `[VALUE]` with
the value after `=` in backend/.env. Keep the single quotes around it:

```
printf '%s' '[VALUE]' | gcloud secrets versions add NAME --data-file=-
```

Answer: `Created version [1] of the secret [NAME].`

For example, if backend/.env has `GEMINI_API_KEY=abc123`, the two commands are:

```
gcloud secrets create GEMINI_API_KEY --replication-policy=automatic
```

```
printf '%s' 'abc123' | gcloud secrets versions add GEMINI_API_KEY --data-file=-
```

What the second command does: `printf '%s' '[VALUE]'` writes the value
exactly as it is, without the line break that pressing Enter would add (a
line break at the end can break `DATABASE_URL`). The `|` passes it to gcloud,
and `--data-file=-` tells gcloud to read the value from there.

- A wrong value: run the second command again with the right one. The deploy
  uses the newest version (`:latest`).
- "already exists" on the first command: the secret is there; just run the
  second.
- Check the four names with `gcloud secrets list` (it never shows values).
- The values stay in your terminal history (`~/.zsh_history`, on your Mac
  only). Delete those `printf` lines there if you like.

**Then let Cloud Run read them.** PROJECT_NUMBER is the number column in
`gcloud projects list` (it also shows in gcloud's messages, as
`projects/<number>/…`):

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

**Once: sign in to Firebase and add it to the project.**

```
npx firebase-tools login
```

Then add Firebase on the website (the `projects:addfirebase` command fails the
first time, before Firebase's terms are accepted):

1. Open console.firebase.google.com, signed in with the account that owns the
   project.
2. Click "Get started by setting up a Firebase project".
3. Choose the existing Google Cloud project from the list. The list shows
   display names, not IDs: `gcloud projects list` gives the NAME that goes with
   PROJECT_ID. Don't create a new project.
4. Confirm the pay-as-you-go (Blaze) plan: the project's billing is already
   linked, and hosting stays within the free allowance. Turn Google Analytics
   off. Finish.

**Once: the backend's address.** `frontend/.env.production` holds it (not a
secret, and committed):

```
VITE_API_URL=https://sketchconnect-api-799683070133.asia-northeast1.run.app
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` come from `frontend/.env` as
they are.

**Build and publish**, from the `frontend` folder, one command at a time:

```
npm run build
```

```
npx firebase-tools deploy --only hosting --project sketchconnect-app-2026
```

It ends with `Hosting URL: https://PROJECT_ID.web.app`: the public site.

## 4. Connect the two (once)

Let the site talk to the backend:

```
gcloud run services update sketchconnect-api --region asia-northeast1 --update-env-vars "^@^FRONTEND_ORIGINS=https://PROJECT_ID.web.app,https://PROJECT_ID.firebaseapp.com"
```

The `^@^` at the start is needed: gcloud otherwise reads the comma as the start
of another variable ("Bad syntax for dict arg").

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
