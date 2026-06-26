---
name: Export Doctor diagnostics
description: Single-clip (Scene 1) end-to-end export diagnostic — purpose, SSRF allowlist decision, session model.
---

# Export Doctor

A diagnostic surface in the Export tab that proves ONE clip (Scene 1) can be sourced, downloaded, ffprobed, and exported before any full multi-scene export is attempted. Four steps: test source URL, download+ffprobe, simple 3s export (1080x1920, no audio), and 3s export with master audio.

## SSRF allowlist (durable decision)
Server endpoints fetch client-supplied URLs, so each fetch is host-allowlisted:
- **Clips** (`scene.demoClipUrl`): https only, host === Supabase storage host OR hostname ends with `.cloudfront.net` / `.runwayml.com`.
- **Audio** (master player audio): reuse `isAllowedStemUrl` from `lib/audioExport.ts` (Supabase host, https only).
**Why:** Runway-generated clips are served from a CloudFront CDN before/independent of Supabase upload, so a Supabase-only allowlist would reject legitimate clips. Audio is always uploaded to Supabase, so it stays Supabase-only.
**How to apply:** Any new server route that downloads a clip/audio URL from request body must allowlist the host the same way — do not rely on `startsWith("http")` alone.

## Session model
Download creates a fresh `/tmp/export-doctor-*` folder + in-memory session keyed by a randomUUID `doctorId`; export steps look up the session and HARD-STOP (no FFmpeg) if the local file is missing. A 30-min sweeper `rmSync`s the folder AND deletes the map entry (deleting only the map entry leaks temp files).
