# parity lane — Stack-100 #2 items 68–80 + 97 (branch stack28/world-parity, base 92a3ae6b)

Setup: worktree ~/workspace/bdv-wt-w28-parity; symlink forest cloned from bdv-wt-w28-sky
(per-entry links into bdv-wt-integration); @workspace/db + @workspace/api-zod verified
resolving INTO this worktree (readlink -f); lib/db + lib/api-zod dists built in-worktree
(.lane/build-db.log, .lane/build-zod.log, both exit 0).

## Per-item status
- 68 Hook Desk Preview: INVESTIGATING — current HookDesk.tsx has NO Preview button at all
  (modes hooks/captions/preflight/cta, results render in-panel). Audit D-H1 may be stale
  (pre-native desk). Verify create-desks runner path before ruling.
- 69 humAudioUrl: INVESTIGATING — identifier absent from current tree (grep 0 hits);
  create-finishers.ts no longer exists. Find current hum tab in SongDeskTabs/audio lib.
- 70 Live Desk count: INVESTIGATING — LiveDesk.tsx (1903 lines) to read.
- 71 Scheduler receipt: INVESTIGATING — SchedulerDesk.tsx to read.
- 72 AI-assist gate reason: INVESTIGATING — SchedulerDesk.tsx to read.
- 73 Pricing badge: INVESTIGATING — search scheduler AI badge copy.
- 74 Daily Drop music kinds: INVESTIGATING — current DailyDropKind set is only
  {thumbnail,caption,video,hook} (daily-drop-catalog.ts DROP_KINDS); server DAILY_DROPS
  slate must be checked for sample-pack/preset kinds.
- 75 Atelier bench copy: INVESTIGATING — ateliers.ts/component roster copy.
- 76 My-Studio navs: INVESTIGATING — no getStatus in lib/world (grep 0); find current navs.
- 77 Tutorial overlay station-follow: INVESTIGATING — tutorial.ts is pure; overlay in world.tsx.
- 78 JOIN_VOICE render side-effect: INVESTIGATING — no JOIN_VOICE identifier; find blocked
  notice in world.tsx voice code.
- 79 Stream key honesty: INVESTIGATING — LiveDesk / go-live desk key surface.
- 80 Post Assist label: INVESTIGATING — PostAssist.tsx (145 lines) to read.
- 97 Panel payload: DESIGN — panel swap is onOpenStation(stationId: string) only
  (StationPanel props; world.tsx host). SchedulerPrefill pattern exists in
  scheduler-desk.ts (typed + defensive) as the model. Daily Drop "Use" currently
  passes NO payload (DailyDropCatalog.tsx onOpenStation(stationId)).

## Verification
(pending — numbers only from finished .lane logs)
