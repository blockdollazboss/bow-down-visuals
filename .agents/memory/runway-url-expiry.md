---
name: Runway clip URL expiry
description: Runway presigned S3 URLs expire after ~24h; handle gracefully in video player.
---

Runway's generated video URLs are temporary AWS S3 presigned URLs that expire after ~24 hours.
Playing an expired URL causes "The element has no supported sources" error from the video element.

**Why:** Runway doesn't host permanent video files — it returns time-limited presigned S3 URLs.

**How to apply:** Add `onError` handler to video elements that sets an `urlError` state.
Show an amber overlay: "Clip URL expired — Runway links are temporary. Regenerate the clip."
Reset `urlError` when the clip index changes. Do NOT silently swallow play() errors.
The FinalVideoPreview component in MusicVideoTimeline.tsx implements this pattern.
