# Technician App (Expo, Android)

> 🚧 **Placeholder.** The Expo project scaffolds in **Phase 2** of the media
> slice (after the backend's `media` module ships in Phase 1). This folder
> exists now so collaborators see the planned layout and don't accidentally put
> mobile code elsewhere.

## Planned scope (locked)

A small Expo (React Native) app for technicians on Android. **Single feature**:
capture Before/After **photos and videos** for a job, compress on-device, and
upload via signed URLs minted by the FastAPI backend.

## Planned stack

| Concern | Choice |
|---|---|
| App | Expo (managed workflow), Android target |
| Build | EAS development build (`expo-dev-client`) — native modules require this |
| Capture | `expo-image-picker` (system camera) |
| Video compression | `react-native-compressor` (~720p, ~2.5 Mbps, configurable) |
| Image compression | `expo-image-manipulator` |
| Playback | `expo-video` (`useVideoPlayer` + `<VideoView>`) — **not** the deprecated `expo-av` |
| File IO | `expo-file-system` |
| API client | Plain `fetch` (or `axios`) against the FastAPI backend |

## Planned layout (vertical-slice, matching the monorepo)

```
technician-app/
  app.json, eas.json
  src/
    lib/api.ts             # FastAPI client (base URL from env)
    lib/compress.ts        # compressVideo() / compressImage()
    features/media/
      BeforeAfterScreen.tsx
      useUploadMedia.ts    # capture → compress → request signed url → PUT → finalize
      MediaTile.tsx        # thumbnail + expo-video playback
```

## Phase 2 entry criteria

- Backend `media` module is live (`POST /api/jobs/{id}/media`, `POST /api/.../media/{mid}/complete`, `GET /api/jobs/{id}/media`).
- Supabase `job-media` bucket is provisioned with backend signing access.
