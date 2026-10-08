# Feature Wave 6 — Coordinator Log (2026-10-07)

## Gap analysis summary
Surveyed ~/memory/2026-10-07.md, SUNO_RESEARCH.md, CAPCUT_RESEARCH.md, and the actual route inventory
(artifacts/api-server/src/routes/generate — ~180 route files). Excluded already-built items:
- SFX backend exists (POST /api/sfx registered) but only as standalone sfx.tsx page — sprawl candidate for coherence crew, not rebuilt here
- Stem remix (per-stem levels) already exists in stem-splitter.ts
- Editor VHS/Camera Shake/Cinematic Bars are CSS-preview approximations only — NOT burned into export (genuine gap → worker 7)

## The 10 (6 Suno/music + 4 CapCut/video)
| # | Feature | Docks in | Price |
|---|---------|----------|-------|
| 1 | Song Remix + Replace Section | Song Maker results | 400 / 300 |
| 2 | Hum-to-Song | Song Maker "Hum it" tab | 500 |
| 3 | Album/EP Builder (+ public /albums/:slug) | Song Maker library | 300 (on publish) |
| 4 | Cover Song | Song Maker results/library | 400 |
| 5 | Inspo Mode (playlist vibe → style DNA) | Song Maker "Inspo" tab | 200 |
| 6 | Song Mashup | Song Maker | 400 |
| 7 | Real Burned Cinematic FX (true shake/bars/VHS/grain) | Video Editor Effects | 150 |
| 8 | LUT Import (.cube/.3DL + house presets) | Video Editor Color panel | 150 |
| 9 | Split-Screen Video Grids | Video Editor Templates | 200 |
| 10 | Export Quality Controls (4K/CRF/fps/MP4-MOV) | Video Editor Export tab | 150 |

## Standing directives given to all workers
NO SPRAWL · COHERENCE (handoff chains, shared project context) · QUALITY (gold/black luxury, no dead buttons) ·
VIRALITY (one-click share, BDV attribution, ?ref=CODE) · staging only · VB×100 pricing + 402/refund ·
no paid provider runs · tsc clean · idempotent migrations (next 0066, NEVER another 0063)

## Worker agents
1. 6f47dc2a (remix/replace-section) · 2. f2158fb0 (hum-to-song) · 3. 3a2fa7bf (album builder)
4. 0bc35bbb (cover song) · 5. cfa2e830 (inspo mode) · 6. 98670815 (mashup)
7. 58cb94df (cinematic fx) · 8. 1de3b595 (LUT import) · 9. 6261d734 (split-screen) · 10. dc820791 (export quality)

## Status
Dispatched 2026-10-07 ~19:35 EDT. Awaiting handoffs. Final report to parent pending all 10.

## Completions
- [x] Worker 5 (Inspo Mode, cfa2e830) — DONE 2026-10-07 ~19:35 EDT. Commit `8ddff9ee` on origin/staging.
  UI: /make-song → "Inspo" mode toggle. POST /api/song-inspo/analyze (free) → editable style-DNA card →
  "Save to My Vibes" presets → POST /api/song-inspo/generate (200 VB, 402 pre-check → charge → auto-refund).
  Migration 0068_inspo_vibe_presets.sql (renumbered from 0066; siblings claimed 0066_albums + 0066_hum_recordings, 0067_mashup_sources exists).
  tsc clean. Not browser-tested. Shared-tree stash incident recovered cleanly.
- [x] Worker 9 (Split-Screen Grids, 6261d734) — DONE 2026-10-07 ~19:38 EDT. Commit `0af00632` on origin/staging.
  UI: Video Editor → Templates tab → "Split-Screen Grids" card. POST /api/split-screen/apply (202+jobId) →
  GET /api/split-screen/job/:jobId; layouts: side-by-side, stacked, 3-up, 2x2, PiP; audio mix options;
  200 VB, 402 pre-check → charge → auto-refund. Handoffs: use-in-editor → captions → multi-ratio export →
  scheduler; "Make a reaction video" preload. No migration. tsc clean on own files; pre-existing errors
  noted in sibling files (hum-to-song, song-cover, mashup server; InspoTab, AiCaptionSuite client).
  ffmpeg hang fixed (xstack fill + shortest=1). Not browser-tested.
- [x] Worker 1 (Cover Song, 0bc35bbb) — DONE 2026-10-07 ~19:41 EDT. Report thin ("committed, pushed via worker 6's push,
  local in sync with origin/staging") — VERIFY cover-song route + UI presence on origin/staging during final synthesis.
- [x] Worker 1b (Song Remix + Replace Section, 6f47dc2a) — DONE 2026-10-07 ~19:42 EDT. Commit `ca44ac34` (swept into worker 6's batch commit; verified present).
  UI: /make-song results → "Remix & Rework" section (Remix tab: style-tweak + length; Replace tab: tagged-section picker
  parsed from [Verse]/[Chorus] lyrics, fine-tune start/end seconds). Reverse: /songs cards → gold "Rework" button expands panel inline.
  POST /api/song-remix (400 VB; same lyrics/vibe, fresh arrangement via ElevenLabs music_v2_5) + POST /api/song-replace-section
  (300 VB; regenerates one section, 3s acrossfade splice, duration preserved — verified locally: 20s song → exactly 20.00s incl. edge case).
  402→charge→refund; registry entries. No migration (songs.source/parent_song_id already existed).
  Handoffs: lyric video, cover art, add-to-album (/songs?song=<id>&addToAlbum=1, degrades gracefully), hub project asset, share /songs?song=<id>&ref=CODE.
  tsc clean on own files. Not browser-tested; no paid ElevenLabs runs (standing rule).
- [x] Worker 2 (Hum-to-Song, f2158fb0) — DONE 2026-10-07 ~19:42 EDT. Commit `9f25d31e` on origin/staging.
  UI: /make-song → "Hum it" tab (?tab=hum). POST /api/hum-to-song (multipart): free analyzeOnly step (ffmpeg decode +
  dependency-free DSP melody-analysis.ts: tempo via onset autocorrelation, key via Krumhansl-Schmuckler, reported as estimates)
  → paid step 500 VB (402→charge→refund). Audio-influence: tries ElevenLabs music/upload → conditioning_ref first,
  degrades to text-prompt compose from extracted tempo/key/phrasing; response reports influence path honestly; 503 names
  ELEVENLABS_API_KEY when unset. Client HumToSong.tsx: MediaRecorder (60s auto-stop) + upload, tempo/key badges,
  Simple/Custom modes, full loading/error/out-of-credits states. Migration 0066_hum_recordings.sql (collides with sibling
  0066_user_luts.sql — both idempotent, applies fine; rename pass recommended later). Handoffs: lyric video (karaoke),
  audiogram, cover art, Extend +30s (existing extend pipeline), share ?ref=CODE; hum+song pushed to hub project as "hum" asset.
  tsc clean on own files. Not browser-tested; no paid provider runs.
- [x] Worker 10 (Export Quality Controls, dc820791) — DONE 2026-10-07 ~19:46 EDT. Commit `c78712a4` on origin/staging.
  UI: Video Editor → Export tab → Final Video Export card → "Quality" disclosure: resolution 720p/1080p/4K,
  quality slider→CRF (80→18, 100→16, 0→26), 24/30/60fps, MP4/MOV, watermark toggle, live estimate
  ("≈ 43 MB · ~13 min render" via free POST /api/export-quality/estimate). POST /api/export-quality on the SAME
  pipeline (no fork; final ffmpeg pass parameterized, defaults match legacy). 150 VB flat (4K included);
  charge-once-after-success (pipeline's established pattern — failed renders never charge, no refund needed).
  Handoffs: Schedule Post deep-link, copy share link ?ref=CODE, Publish to Showcase, tip to multi-ratio card.
  Watermark toggle default ON, locked ON for free users (server gate) + upsell link to /watermark-removal.
  8/8 unit tests pass. tsc clean on own files. No migration (quality opts ride in export_jobs.params). Not browser-tested.
  Flag: 4K will be slow on 512MB Render (single-thread x264); UI warns.
- [x] Worker 8 (LUT Import, 1de3b595) — DONE 2026-10-07 ~19:46 EDT. Commit `2dce9c14` on origin/staging.
  UI: Video Editor → Effects tab → Color Grade card → "…or import your own LUT" link → LUT Import panel:
  4 house LUTs (teal-orange, moody, vibrant, noir; 32³ .cube in data/luts/, shipped in Docker), .cube/.3dl upload
  w/ validation, "My LUTs" save/reuse/delete, scene picker, free preview thumbnail, paid apply.
  Routes in routes/lut.ts: POST /api/apply-lut (150 VB, 402→charge→refund), GET /api/lut/presets(+/:file),
  POST /api/lut/preview (free), POST /api/lut/validate (free), POST /api/lut/upload, GET /api/lut/my,
  DELETE /api/lut/my/:id. Migration 0066_user_luts.sql (collides with 0066_hum_recordings.sql — both idempotent).
  Handoffs: use-in-editor (onReplaceClipVideo), captions tab, multi-ratio export (handoffVideoUrl prop), share intents.
  .3dl supported via server-side parse→.cube conversion (ffmpeg 8.1 lut3d rejected raw .3dl). tsc clean on own files.
  Not browser-tested.

## Coordinator verification (2026-10-07 ~19:47 EDT)
- All 10 route files present on origin/staging; every router imported + router.use'd EXACTLY once in routes/index.ts.
  No duplicate path registrations (multi-path routers are distinct endpoints: song-cover x3, song-inspo x4, mashup x3,
  albums x4, lut x7, export-quality x2 — all distinct paths).
- Commits on origin/staging: 8ddff9ee (inspo), 0af00632 (split-screen), ca44ac34 (mashup+albums+remix+cover swept),
  1e22ee9d (cinematic-fx), 9f25d31e (hum-to-song), c78712a4 (export-quality), 2dce9c14 (LUT).
- Migrations: 0066_hum_recordings, 0066_user_luts (collision, both idempotent), 0067_mashup_sources,
  0068_inspo_vibe_presets, 0069_albums.
- Frontend UI verified present: InspoTab, HumToSong, SongMashup, CoverSongModal (make-song.tsx tabs), CinematicFxCard
  (EffectsSection), SplitScreenPanel (TemplatesTabPanel), LUT panel (Color Grade card), Quality panel (FinalVideoExport).
- main untouched. All pushes to origin/staging only.
- [x] Worker 7 (Real Burned Cinematic FX, 58cb94df) — DONE 2026-10-07 ~19:41 EDT. Commit `1e22ee9d` on origin/staging.
  UI: Video Editor → Effects tab → "True Cinematic FX" card. POST /api/cinematic-fx: true camera shake
  (crop-wobble), letterbox bars (drawbox), VHS (noise+scanlines+tracking+rgbashift), film grain; intensity 10-100.
  150 VB, 402→charge→refund. Global export pipeline upgraded: effects-ffmpeg.ts buildEffectStack now resolves
  VHS/Bars/Shake/Grain to true-burn chains (used by export-video + Export Doctor). WYSIWYG preview with honest
  labels. Handoffs: use-in-editor → captions → multi-ratio export → scheduler. 14/14 unit tests pass. tsc clean
  on own files. Not browser-tested. No migration needed.
- [x] Worker 6 (Song Mashup, 98670815) — DONE 2026-10-07 ~19:41 EDT. Commit `ca44ac34` on origin/staging.
  UI: /make-song → "Mashup" tab. POST /api/mashup (artifacts/api-server/src/routes/mashup.ts): beat-detect both,
  tempo-align B→A (atempo), acrossfade / beat-locked amix / interleave concat; 400 VB, 402→charge→refund.
  Migration 0067_mashup_sources.sql. Handoffs: lyric video (karaoke-video), cover art, add-to-album (sibling's
  /api/albums), share w/ ?ref=CODE, reverse lookup "Mashups using this" on song cards. tsc clean on own files.
  Not browser-tested. Note: route file lives at routes/mashup.ts (not routes/generate/).
- [x] Worker 3 (Album/EP Builder, 3a2fa7bf) — DONE 2026-10-07 ~19:42 EDT. Commit `ca44ac34` (swept by worker 6's batch commit; verified byte-correct in HEAD).
  UI: /songs → "Albums" tab (docked, no new page/sidebar). Create Album/EP, AI cover art (reuse /api/cover-art),
  upload/paste cover, reorderable tracklist, draft free, Publish 300 VB. Public /albums/:slug: gold-black, playable
  tracklist, MusicAlbum JSON-LD, BDV badge, view counter, signup CTA. Routes in routes/albums.ts:
  POST/GET /api/albums, GET /api/albums/public/:slug (public), GET/PATCH/DELETE /api/albums/:id,
  POST /api/album-publish/:id. Handoffs: song rows → "Add to album" modal; album → playlist-pitch,
  release-checklist, distribute, showcase; ?ref=CODE on share links. Migration 0069_albums.sql (0066 claimed x3 by
  siblings: hum_recordings, user_luts, inspo→0068; 0067 mashup; 0068 inspo). tsc clean on own files; fixed 2 sibling
  type errors in co-mingled songs.tsx. Not browser-tested.
