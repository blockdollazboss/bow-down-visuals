---
name: Export Doctor diagnostics
description: Single-clip (Scene 1) end-to-end export diagnostic — purpose, SSRF allowlist decision, session model.
---

# Export Doctor

A diagnostic surface in the Export tab that proves ONE clip (Scene 1) can be sourced, downloaded, ffprobed, and exported before any full multi-scene export is attempted. Four steps: test source URL, download+ffprobe, simple 3s export (1080x1920, no audio), and 3s export with master audio.

## SSRF allowlist (durable decision)
Server endpoints fetch client-supplied URLs, so each fetch is host-allowlisted (https only):
- **Clips** (`scene.demoClipUrl`): Supabase storage host OR `.cloudfront.net`/`.runwayml.com` (Runway) OR Replit object storage (`storage.googleapis.com` with path starting `/replit-objstore-`).
- **Audio** (master player audio): Supabase storage (shared `isAllowedStemUrl` from `lib/audioExport.ts`) OR Replit object storage. Export Doctor uses its own `isAllowedAudioUrl` so it does NOT widen the shared stem guard used by the real export pipeline.
**Why:** The master player plays Scene 1 from Replit object storage (`storage.googleapis.com/replit-objstore-...`) — a Supabase/Runway-only allowlist rejected the real, working source. Runway clips come from a CloudFront CDN independent of Supabase. Internal/metadata hosts (e.g. 169.254.169.254) and arbitrary GCS buckets are still blocked.
**How to apply:** Any new server route that downloads a clip/audio URL from request body must allowlist the host the same way — do not rely on `startsWith("http")` alone. Object-storage hosts serve video as `application/octet-stream` or with no content-type, so treat those as likely-video and let ffprobe be the real gate; never reject on content-type alone.

## Session model
Download creates a fresh `/tmp/export-doctor-*` folder + in-memory session keyed by a randomUUID `doctorId`; export steps look up the session and HARD-STOP (no FFmpeg) if the local file is missing. A 30-min sweeper `rmSync`s the folder AND deletes the map entry (deleting only the map entry leaks temp files).
