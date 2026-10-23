# AUDIT FACET D — Parity re-walk & station honesty (verbatim, worker 996ec28f)
ITEM 89:
- D-89a NO publisher exists: nothing writes liveState/isLive — createLivestream Go-Live button writes state/draft only; goLiveStartedAt stays null. Deck "Studio not open" gate CANNOT distinguish warming-up from never-started.
- D-89b two divergent getStatus impls (create-desks vs tail-desks test-pinned same object) — diverge risk when studio states added.
- D-89c deck uses POLLING (2s, 250ms exit-poll) not WS frames — added server load per open deck.
ITEM 97:
- D-97a panel-swap has NO payload channel at all (only an open-panel slot). Desk handoffs needing context must use module-scope state.
- D-97b ONLY Hook Desk is payload-capable today (hookDeskSeed: one-shot template id) — the pattern to generalize.
- D-97c Daily Drop "Use" (hook kinds ONLY) -> Hook Desk CORRECT now (parity note is stale); audio kinds (sample-pack/preset) -> NO payload at all (audioDeskSeed missing); jewelry -> bench only; wallpaper -> URL replace navigation leaves the world.
- D-97d thumbnail/video template "Schedule it" targets a HARDCODED editor URL; the schedule payload (title/media id) is LOST.
ITEM 53 EXTRAS:
- D-53a POST /api/distribution/splits/invite does NOT exist (documented in distribution.ts:14-15 as unbuilt TODO). In-world SplitEditor takes RAW USER IDS only — no email invite, no share link, no pending-invite state at all.
- D-53b create-desks.test fakes invite acceptance — TEST FIDELITY defect (mocks a rail that doesn't exist; the "long client" lap). Flag: fix tests to the real rail or mark honestly.
STATION HONESTY:
- D-H1 Hook Desk "Preview" button NO-OP (only creates a draft, view at Hook Studio page = HERE?? text says view elsewhere = self-contradictory label).
- D-H2 Song Desk hum-tab: humAudioUrl referenced BEFORE assignment (use-before-declare in create-finishers.ts:489-493) — latent bug.
- D-H3 Live Desk active-count header INCREMENTS LOCALLY on join (double-counts vs server) — header lies after joining; refetch needed.
- D-H4 Post Assist composer label ALSO off-station (2D Post Assist page) — 89-style state keys reused.
- D-H5 scheduler "Write with AI ✓ included" badge — certifies pricing that's fetched dynamically (certainty overclaim).
- D-H6 daily-drop kind set {hook,count} so Const "music" kinds (sample-pack/preset/wallpaper) NEVER reach Music Wing in-world (D-97c companion).
- D-H7 Atelier roster REASSIGNS "today's bench" DAILY via rosterFor — copy implies fixed assignment (dishonest by rotation).
- D-H8 THREE overlapping My-Studio navs (creation-row tabs, tail-desks, create-desks) with diverging getStatus — navigation honesty/consistency.
- D-H9 Facet A cross-ref: Creator Heights roster plates blank (hall-scene side).
SCHEDULER:
- D-S1 compose->schedule ALMOST completable: PostSchedulerCard is fully there; what's missing = schedule-success receipt (title+when+channel shown back; currently NO confirmation render).
- D-S2 AI-assist toggle gated by a FEATURE FLAG not entitlement — flag-off state misattributes the reason (says plan, means flag).
GO-LIVE START:
- D-L1 stream key shown + copyable but NO connection proof (no RTMP handshake test; key validity opaque until broadcast software connects) — acceptable? state honesty item: label as untested key.
- D-L2 goLiveStartedAt NEVER assigned ANYWHERE in the codebase — "on air" state is structurally impossible today; stream start is write-only draft.
OTHER:
- D-X1 WorldTutorialOverlay re-mount effect deps [tutorialState, isGuest] only; station changes don't reopen steps.
- D-X2 JOIN_VOICE blocked notice uses setTimeout inside render path (side-effect in render).
POSITIVE: admin locks full parity verified (client verbs + server enforcement + socket close code 4413-4416 + sweeper agreement).
