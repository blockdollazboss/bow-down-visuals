# parity lane — Stack-100 #2 items 68–80 + 97 (branch stack28/world-parity, base 92a3ae6b)

Setup: worktree ~/workspace/bdv-wt-w28-parity; symlink forest cloned from bdv-wt-w28-sky
(per-entry links into bdv-wt-integration); @workspace/db + @workspace/api-zod verified
resolving INTO this worktree (readlink -f); lib/db + lib/api-zod dists built in-worktree
(.lane/build-db.log, .lane/build-zod.log, both exit 0).

## Per-item status
- 97 DONE (commit 1): panel payload channel — new lib/world/panel-payload.ts (typed
  PanelPayload: hook-template/caption-pack/thumbnail-template; template references only,
  never money) + parsePanelPayloadFor defensive parse per receiving station. Threaded
  world.tsx target → StationPanel → CreateDeskPanel → CreateDeskProps.panelPayload.
  Consumers: Daily Drop Use sends dailyDropPanelPayload(entry) (drop key = template slug);
  HookDesk applies via hookTemplatePrefill/captionPackPrefill in matching mode;
  ThumbnailBenches via getThumbnailTemplate. Video drops honestly carry no payload
  (editor seed is a project id). Pin correction (1): daily-drop-catalog.test USE pin —
  station-only call shape → station+payload shape (behaviour changed by this item).
- 71 DONE (commit 5fd46850): scheduler receipt — facet partly stale (a saved line existed
  but named only the when, and only when the response parsed). schedulerSavedReceipt()
  in scheduler-desk.ts now names title + when + channels from the server post, falling
  back to the just-saved draft; draft receipt stays honest. 5 new tests + source pin.
- 79 DONE (commit 59b63ebe): stream key honesty — IngestKeySection now labels an enabled
  existing key "untested — proven the first time your encoder connects" (no handshake
  test exists on the surface). Copy-only; no rail/price change.
- 68 PINNED (stale): Hook Desk has NO Preview button and saves no draft in the shipped
  tree; results render in-panel (world-hook-desk-result). Pin: parity-rewalk.test.ts.
- 69 PINNED (stale): humAudioUrl / create-finishers.ts do not exist; SongHumBench declares
  humRef state before all uses. Pin: parity-rewalk.test.ts.
- 70 PINNED (stale): no local viewer-count increment anywhere in LiveDesk; all counts are
  server DTO reads. Pin: live-desk.test.ts (in commit 59b63ebe).
- 72 PINNED (stale): no AI toggle / feature-flag gate copy in the in-world scheduler.
- 73 PINNED (stale): no "Write with AI ✓ included" badge anywhere; best-time price is the
  named constant SCHEDULER_BEST_TIME_COST_VISUAL_BUCS=100 printed before the ask.
  Pins (72+73): parity-rewalk.test.ts.
- 74 PINNED (stale): server DAILY_DROPS slate kind union is exactly {caption, hook,
  thumbnail, video} (read from api-server retention-drops.ts in the pin) — no
  sample-pack/preset/wallpaper kinds exist to strand; all four kinds route to real
  stations; unknown kinds fail the catalogue closed. Pins: parity-rewalk.test.ts.
- 75 PINNED (stale): no "today's bench" copy, no rosterFor; Ateliers Slate = Kingdom Board.
- 76 PINNED (stale): exactly one my-studio station, one StudioBoard render, zero
  getStatus in lib/world. Pins: parity-rewalk.test.ts.
- 77 PINNED (stale): no WorldTutorialOverlay; tutorialStatus refreshes on room change
  ([status, roomId, refreshTutorial]) + panel close. Pin: parity-rewalk.test.ts.
- 78 PINNED (stale): world.tsx's only setTimeout CALLS (2) sit inside TimerRef callbacks;
  voiceNote renders as plain state set from socket callbacks; no JOIN_VOICE exists.
  Pin: parity-rewalk.test.ts.
- 80 PINNED (stale): PostAssist copy names the in-world composer ("Drafted into your
  composer below"); Promote host hands the draft to the in-world SchedulerDeskSection.
  Pin: parity-rewalk.test.ts.
- 97 sub-claims PINNED (stale halves): D-97d — "Schedule it" already opens
  SchedulerComposeStandalone inline with a typed SchedulerPrefill (no hardcoded editor
  URL); D-97c-wallpaper — no wallpaper surface exists in the world. Pins:
  parity-rewalk.test.ts.

## Parked
- None. No migrations needed; no price/charge changes; no new locale keys (all new copy
  is English literals in components that already use English literals).

## Verification (FINAL — numbers from finished logs in this .lane/)
- FE world suites: 101 files / 1,838 tests ALL PASS, exit 0 (.lane/final-fe-world.log)
  — base at stack28/world tip was 99 files / 1,808 (sky lane); +2 files / +30 tests
  are this lane's (panel-payload 10, parity-rewalk 13, scheduler receipt 5, live 2),
  zero regressions.
- API world suites: 32 files / 422 tests ALL PASS, exit 0 (.lane/final-api-world.log)
  — this lane changed no API code; run as the world-surface regression check.
- FE typecheck exit 0 (.lane/final-fe-typecheck.log); API typecheck exit 0
  (.lane/final-api-typecheck.log). All runs sequential, --maxWorkers=1, TMPDIR in-worktree.
- No flakes encountered; no A/B needed. No locale files touched (guard untouched).

## Commits (stack28/world-parity, base 92a3ae6b)
- 22dc7c0a item 97 (payload channel) + pin correction (1, justified in commit)
- 5fd46850 item 71 (scheduler receipt)
- 59b63ebe items 79 + 70 (untested-key label; server-only counts pin)
- 3c2b45d0 items 68–80 stale-claim pins (parity-rewalk.test.ts) + this plan
- (final) this verification record
