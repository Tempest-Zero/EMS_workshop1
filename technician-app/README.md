# Technician App (Expo, Android)

Single-feature Expo app for technicians: capture **Before/After** photos and
videos for a job, compress on-device, and upload via short-lived signed URLs
minted by the FastAPI backend. Android-only for the demo.

## Layout

```
technician-app/
  App.tsx                       # root component (renders MediaScreen)
  index.ts                      # Expo entry — registerRootComponent
  app.json                      # Expo config (Android-only, permissions)
  eas.json                      # EAS build profiles (development = APK)
  babel.config.js, tsconfig.json
  .env.example                  # EXPO_PUBLIC_API_URL (points at the backend)
  src/
    lib/
      api.ts                    # typed FastAPI client (media endpoints)
      config.ts                 # env-driven config + compression targets
      compress.ts               # react-native-compressor wrapper
    features/media/
      MediaScreen.tsx           # the only screen — Before/After + capture
      MediaTile.tsx             # thumbnail + expo-video playback
      useMedia.ts               # state hook (list + upload + delete + refresh)
      uploadMedia.ts            # capture → compress → signed URL → PUT → finalize
      uploadMedia.test.ts       # unit tests for the pipeline (mocks)
```

## Stack

| Concern | Choice |
| --- | --- |
| Framework | **Expo** (managed) ~52, **TypeScript** strict |
| Dev builds | **EAS Build** + `expo-dev-client` — required for native modules |
| Capture | `expo-image-picker` (camera, single shot/clip) |
| Compression | `react-native-compressor` — 720p @ ~2.5 Mbps, configurable |
| Playback | `expo-video` (`useVideoPlayer` + `<VideoView>`) — **not** the deprecated `expo-av` |
| File I/O | `expo-file-system` (`uploadAsync` does the PUT to R2) |
| Tests | jest + jest-expo |

## Two ways to run it

There are two independent connections, and conflating them is the classic
mistake:

- **A · your JS → the phone** (the edit/reload loop) — Metro over LAN.
- **B · the app → the backend API** (the data) — a URL baked in per build profile.

Pick the path that matches what you're doing.

### A) Daily iteration — `development` build + LAN

For coding at your own desk with hot reload. The API URL comes from your local
`.env`; the JS is served live by Metro.

```bash
cd technician-app
npm install                # ~2 min
cp .env.example .env
# point it at your dev machine on the LAN (find it with `ipconfig`):
#   EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:8000
```

Run the backend so the phone can reach it (bind 0.0.0.0, not localhost):

```bash
cd ../backend
.venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Build the dev client once (native modules → Expo Go won't work), then run Metro:

```bash
npm install -g eas-cli && eas login          # free Expo account
cd ../technician-app
eas build --profile development --platform android   # ~10 min, install the APK
npm start                                            # Metro; open the dev app, scan QR
```

> ⚠️ LAN requires phone + laptop on the **same Wi-Fi with no client isolation**
> — which public/venue Wi-Fi often blocks. Tunnel (`npx expo start --tunnel`)
> works around it but is slow and drops often. **Don't demo this way** — use (B).

### B) Demo / testers — `preview` build + deployed backend ⭐

This is the build you hand to a technician or your mentor. It embeds the JS
bundle and points at a **deployed** backend, so it needs **no laptop, no Metro,
no shared Wi-Fi** — they just open the app and it works.

1. **Deploy the backend** (see below) → get a stable `https://…` URL.
2. Put that URL in `eas.json` → `build.preview.env.EXPO_PUBLIC_API_URL`.
   The current `preview` profile already points at
   `https://efficient-tenderness-production-2d09.up.railway.app` (the live
   Railway deployment). Update only when that URL changes.
3. Build + distribute:
   ```bash
   eas build --profile preview --platform android
   ```
   EAS returns an install link (internal distribution). Send it to anyone — they
   install the APK and it talks straight to the deployed API.

New tester later? Send the same link. New developer? They clone the repo and the
URL is already in `eas.json` — no per-machine IP hunting.

## Deploy the backend

The database is on **Supabase** (Postgres) and media is on **Cloudflare R2** —
both cloud — so deploying the API is just "run the container with the right env
vars"; there's nothing to provision. The image respects `$PORT`, so it runs
as-is on Railway, Render, or Fly (all build straight from `backend/Dockerfile`).

Set these env vars on the host (same values as `backend/.env`):

```
FIXFLOW_DATABASE_URL            # Supabase Postgres (postgresql+asyncpg://…)
FIXFLOW_R2_ACCOUNT_ID
FIXFLOW_R2_ACCESS_KEY_ID        # backend-only secret
FIXFLOW_R2_SECRET_ACCESS_KEY    # backend-only secret
FIXFLOW_R2_BUCKET=job-media
FIXFLOW_CORS_ORIGINS            # JSON list incl. the web manager's origin
```

Then point `eas.json`'s `preview` (and later `production`) profile at the URL
the host gives you.

> ⚠️ **Iteration-phase gotcha:** `env` in `eas.json` is **build-time only** — it
> is **not** carried by `eas update` (OTA). If you later push JS via `eas update`
> without rebuilding, the API URL won't update with it, so a build and an OTA
> update can silently point at different backends. Re-build (not just update)
> when the API URL changes.

## Quality gates

Same gates CI runs (under the `mobile` job):

```bash
npm run typecheck          # tsc --noEmit
npm test                   # jest
npx expo-doctor            # pre-flight check before eas build
```

## Architecture

This app is the **mobile half** of the `media` vertical slice. The other half
is `backend/app/features/media/`. The app never holds an R2 (or any storage)
credential — it only ever sees short-lived signed URLs minted by FastAPI:

```
Expo (capture + compress)
   ├─ 1. POST /api/jobs/{id}/media         (phase, type, filename, content_type)
   ▼
FastAPI · media slice                       creates DB row (pending),
                                            mints a signed UPLOAD url
   │  2. returns { media_id, signed_url, ... }
   ▼
Expo  ── 3. PUT bytes DIRECTLY to R2 via signed_url
   │  4. POST /api/jobs/{id}/media/{m}/complete
   ▼
FastAPI · media slice                       flips status to "uploaded",
                                            mints a signed PLAYBACK url
```

`uploadMedia.ts` is the pipeline that runs steps 1–4 in order.
