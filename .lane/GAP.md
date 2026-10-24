# GAP VERIFICATION — #27 Creator Comment Controls (verified in source at base f96d7b72)

Comment models that exist:
- `profile_comments` (Shout Wall) — lib/db/src/schema/creator-social.ts
- `media_comments` (track/video player comments) — same file
- `review_comments` (client review links) — separate surface, already has
  its own client-side hide in routes/review-links.ts; NOT creator content
  comments, left untouched.

Creator-owned controls on wall/media comments BEFORE this lane: ZERO.
- grep pin/hide/held/blocked-word across routes + libs found only:
  - `blocked_words` in lib/db/src/schema/trust.ts + routes/trust.ts +
    lib/automod.ts — LIVE-STREAM CHAT automod (per-stream chat rules),
    a different surface; its matching semantics (case-insensitive
    substring) were REUSED for the comment blocklist for consistency.
  - `hide_comment` in routes/review-links.ts — review-link surface only.
- No pin, no hide, no held-for-review queue, no per-creator comment
  settings existed for posts/videos/wall comments. Gap confirmed; built.
- Feed thread replies are full `posts` rows (kind='thread_reply') with
  the platform admin-removal state — a different model, see REPORT.md
  parked notes.
