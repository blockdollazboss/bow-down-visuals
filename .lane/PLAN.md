# upg-player lane — PLAN (replacement #3, Oct 27)
Base: origin/main @ ecc63098 · Branch: stack200/upg-player · NO push/merge. Migrations: provisional 9999-*.sql only.

## Audit scopes (stack200-board.md dedupe audit)
- **#174 Thumbnail Duels** — UPGRADE of Thumbnail A/B Test (routes/generate/thumbnail-test.ts + thumbnail-ab.ts, AI vision scoring 200 VB). DELTA ONLY: audience-served A/B rotation on the real video, real click/view counts per cover, automatic winner takeover. Results WITH REAL COUNTS (never % without numbers). Dock: thumbnail/promote flow where covers live.
- **N5 Auto Chapters** — UPGRADE of editor chapters (sanitizeVideoChapters) + AI Clip Descriptions. DELTA ONLY: chapters + summary generated automatically from a long video's OWN content/transcript; creator-editable + approved BEFORE they show on the watch surface; off switch (automated-behavior law).
- **N9 Karaoke Mode** — UPGRADE of Karaoke maker (routes/generate/karaoke.ts, rendered video). DELTA ONLY: interactive IN-PLAYER mode — fans sing over the track with synced lit lyrics (song's own artist-supplied/verified lyrics) on their own mic; sing-alongs recorded/shared as house videos per creator settings.

## Covered-check (base ecc63098, Oct 27)
- #174: NO thumbnail-duel code anywhere (only unrelated party-room game duels). Delta fully missing → BUILD.
- N5: routes/generate/auto-chapters.ts (315 lines) + editor AutoChaptersCard.tsx EXIST at base — need scope read: does it cover watch-surface approval + off switch + chapters shown on watch pages? Build ONLY the missing delta half.
- N9: karaoke exists only as rendered-video product + caption styles. NO in-player interactive mode → BUILD.

## Ladder
1. PLAN.md banked (this commit).
2. N5 scope read → build missing delta (watch-surface chapters + approval + off switch).
3. #174 build (schema 9999-thumbnail-duels.sql, serve/count/takeover API, creator dock + results with real counts).
4. N9 build (player karaoke mode: synced lit lyrics overlay, mic sing-over, record/share per creator settings).
5. Suites + typechecks green per package; manifest verdicts appended.
