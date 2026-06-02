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
| File I/O | `expo-file-system` (`uploadAsync` does the PUT to Supabase) |
| Tests | jest + jest-expo |

## Local dev setup

```bash
cd technician-app
npm install                # ~2 min, ~1 GB node_modules
cp .env.example .env
# edit .env if running on a real phone:
#   EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:8000
```

### Run the backend so the app can talk to it

```bash
# in another terminal, from repo root
cd backend
.venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Listening on `0.0.0.0` is important — otherwise the phone can't reach it.
Sanity-check from a regular browser: `http://<dev-machine-LAN-IP>:8000/api/health`.

### Build a dev APK with EAS (one time, ~10 min)

`react-native-compressor` and `expo-video` are native modules → Expo Go cannot
run them. You need an **EAS development build** installed on the test device.

```bash
npm install -g eas-cli
eas login                                       # free Expo account
eas build --profile development --platform android
```

When the build completes EAS gives you a downloadable APK URL. Install it on
the Android device (one-time).

### Run the app

```bash
npm start                  # starts Metro / dev server
```

Open the dev-build app on the phone → scan the QR code (or pick from the
dev menu) → the JS loads. Edit code, save, the app hot-reloads.

> **Android emulator** also works for the demo if you set
> `EXPO_PUBLIC_API_URL=http://10.0.2.2:8000` (the emulator's host-loopback IP).

## Quality gates

Same gates CI runs (under the `mobile` job):

```bash
npm run tsc                # tsc --noEmit
npm test                   # jest
```

## Architecture

This app is the **mobile half** of the `media` vertical slice. The other half
is `backend/app/features/media/`. The app never holds a Supabase key — it
only ever sees short-lived signed URLs minted by FastAPI:

```
Expo (capture + compress)
   ├─ 1. POST /api/jobs/{id}/media         (phase, type, filename, content_type)
   ▼
FastAPI · media slice                       creates DB row (pending),
                                            mints a signed UPLOAD url
   │  2. returns { media_id, signed_url, ... }
   ▼
Expo  ── 3. PUT bytes DIRECTLY to Supabase via signed_url
   │  4. POST /api/jobs/{id}/media/{m}/complete
   ▼
FastAPI · media slice                       flips status to "uploaded",
                                            mints a signed PLAYBACK url
```

`uploadMedia.ts` is the pipeline that runs steps 1–4 in order.
