# STACK-100 #2 — MOVEMENT-FEEL lane (items 56–60) — lane record

Branch: `stack28/world-feel` @ base 1e32717d → tip 5c2088d6
Commits: 5698ccac (59) · 3e588d97 (57) · 5c2088d6 (56/58/60 pins)
No migrations, no price changes, no deletions, no push, no new locale keys.
No API code touched.

Facet C's line citations proved fabricated throughout (again): every claim
below was re-verified BY DESCRIPTION against the shipped tree.

## Per-item status

### 56 — Camera collision — PINNED (facet claim STALE)
- Facet said: `collisionStart` is never assigned; the camera passes through
  everything. **No `collisionStart` symbol exists anywhere in the tree.**
- Truth: camera collision shipped as round-1 item 44. palace-layout.ts
  exports `cameraPointFree` (room camClamp + every room's CAMERA-TALL
  footprints inflated by CAMERA_PROP_MARGIN 0.3) and `pullInCamera`
  (segment-walk pull-in, not endpoint-only). hall-scene `applyFlatCamera`
  clamps the third-person spot to the room's camClamp and then pulls it in
  via pullInCamera every frame; per-district tests already pin
  cameraPointFree per room.
- Pins added (feel-rewalk.test.ts): applyFlatCamera body (function slice)
  contains the pullInCamera call + camClamp; `collisionStart` absent from
  hall-scene; monument pull-in behaviour (desired spot inside the monument
  → pulled to a free point on the figure's side); free spot untouched.

### 57 — Stride & bob — DONE (half stale, half real build)
- Facet said: stride/bob math is dead code with no call site. **Stale for
  bob/stride**: stepMover drives the self mover (moveRig) and every peer
  mover (figure tick) each frame; applyActionPose composes
  `mover.bobY + rig.poseY` onto every figure; the first-person camera rides
  `selfMover.bobY * 0.45`; reduced-motion silences bob at the source.
- **Real gap**: `MoverState.stepCount` — computed and unit-tested, promised
  by its own doc comment to "the footstep hook (dust, sound)" — had ZERO
  consumers in the tree.
- Built the dust half of the hook (no footstep-sound rail exists, so no
  sound consumer was faked): new pure module `step-dust.ts` (fixed ring
  pool of 240 puffs, 0.55 s life, golden-angle drift, colour-fade render
  buffers, `stepsLanded` counter reading with re-baseline on decrease) +
  hall-scene `serviceStepDust(dt)`: reads self + peer step-count increments
  per frame (new `AvatarRig.lastStepCount`), raises ≤3 puffs per figure per
  frame at the figure's feet into ONE lazily built additive Points cloud on
  the scene root (survives look rebuilds), disposes with the scene.
  Reduced-motion screens raise no new puffs. movement.ts comment now names
  the real reader and drops the sound promise.
- Pins: step-dust.test.ts (7 tests: counter reading, life schedule,
  drift/rise, ring recycle, buffer fade) + wiring pins in feel-rewalk.

### 58 — Gate passability semantics — PINNED (facet claim STALE)
- Facet said: gates/door zones are called "passable" while pushing the
  walker out (enterGate / settle-figure). **No "passable" string exists in
  src; no enterGate/settle-figure functions exist; no world-colliders.ts
  file exists.**
- Truth: the shipped vocabulary is already truthful and movement reads
  exactly it — `PlazaGate.kind: "gate"|"marker"` + `open` (palace-layout)
  mirrored by `DistrictThresholdKind` (district-gates), with gateRects
  deriving collision from the kind (open gate = its two posts only, closed
  gate = whole span, marker = plinth), and PALACE_DOORS portals genuinely
  walkable via isWalkable/resolvePalaceMove. All six district thresholds
  are kind "gate", open: true.
- Pins added at the MOVEMENT level (existing pins were rect-level):
  resolvePalaceMove carries a walker through each of the six gates' gaps
  into the correct district room (room + entered asserted); each gate's
  post refuses a crossing; every PALACE_DOORS portal centre isWalkable;
  "passable" absent from both collider sources; both lists all-open-gates.

### 59 — Gamepad LT/RT — DONE (facet half stale)
- Facet said: buttons 6/7 indexed but never consumed. **Half stale**: RT
  (7) was already consumed (sprint, held, with L3). **LT (6) was genuinely
  dead** — the pad's only unindexed job.
- No push-to-talk rail exists in the tree (no PTT seam in voice.ts /
  world-client / world.tsx), so a PTT binding would have been fake. LT now
  steps the voice-mode ring BACKWARD on the press edge — the exact inverse
  of A's forward step, through the same page control:
  gamepad.ts `intent.voiceBack` + `GamepadEdges.lt`; voice-toggle.ts
  `prevVoiceMode` (proven inverse of nextVoiceMode for every mode);
  hall-scene `onPadVoiceBack` consumed in tickFlatMove; world.tsx wires it
  to `setVoiceMode(prevVoiceMode(...))` beside onPadToggleVoice.
- One mechanical test fix, assertions unchanged and noted in the commit:
  gamepad.test.ts's hand-written prev-edges literal gained `lt: true` for
  the new required GamepadEdges field.
- Tests: LT edge discipline + LT-steals-nothing + RT-keeps-sprint
  (gamepad.test), prevVoiceMode cycle + inverse property (voice-toggle.test),
  scene/page wiring pins (feel-rewalk).

### 60 — Touch height control — PINNED (facet premise STALE)
- Facet/board premise: phone walkers cannot climb what pads and keys can.
  **No input has a climb control**: there is no jump/step key on keyboard,
  no height button on the gamepad, no touch control — height is resolved
  for every input alike by segmentWalkable (STEP_UP_MAX / STEP_DOWN_MAX
  between samples), because tickFlatMove merges keyboard, gamepad and the
  touch stick into the same fwd/strafe and moveRig's resolvePalaceMove
  reads no input source. A dedicated touch "step-up" control would be a
  no-op button — a fake binding — so the item is pinned, not built.
- Pins: tickFlatMove slice shows the stick merge (this.stick.dx/dy),
  pollGamepad and KeyW feeding one moveRig; moveRig slice contains
  resolvePalaceMove and no this.stick / this.keys / pollGamepad reference;
  a 6 cm-step (stick-granularity) walk climbs the west terraces tier by
  tier to groundHeightAt 0.95, every step moving. (The z 14.2 lane is the
  clear run: a planter stands on the tiers at (−27.3, 15.8) and its solid
  footprint rightly refuses the z 15 lane — a solid inside a zone wins.)

## ⚠️ Discovery the coordinator must rule on (items 48–55, NOT this lane)
The board records movement-core items 48–55 as DONE via lane tip 4f93a797,
merged be8d0c41. In THIS tree the merge brought only the lane's first three
commits (bd63b9e6 server figure-y, b0f4490b server height tables, d78037cc
client layout/step zones). The lane's CLIENT SCENE half —
8f25bd71 "items 48/50/53/54 (client): Y-follow, settles, true-height
rendering, the wire carries y" (easeFigureHeight in movement.ts, rig-Y
easing + groundY in hall-scene, sendMove carrying y) plus df064f61 — exists
ONLY on the unmerged branch `stack28/world-move`. Consequences in the
shipped tree: height-GATED movement is real (you cannot cross a tall edge;
step zones decide where you may stand), but no figure ever RENDERS at
height — the self rig's group y is hard-set to 0, peers compose only
bobY+poseY, and world-client sendMove still sends `y: 0`. So in-world,
climbing a terrace currently reads as walking onto its footprint at floor
level. This lane did NOT cherry-pick the other lane's commits (a merge
decision, and its hall-scene hunks would collide with this lane's); the
fix is to merge stack28/world-move (2 commits, 6 files, +142/−27) or
re-drive that half. Item 60's pins deliberately pin only the
movement/input layer, never a rendered-height claim.

## Verification (finished logs in this .lane/)
- Baseline (before any edit): feel-baseline-world.log — FE world suites
  102 files / 1,864 tests PASS, exit 0.
- Final: feel-final-world.log — FE world suites (src/lib/world +
  src/components/world, sequential, --maxWorkers=1) **104 files / 1,890
  tests PASS, exit 0**. Delta +2 files / +26 tests = step-dust 7 +
  feel-rewalk 16 + gamepad 2 + voice-toggle 1. No existing test weakened,
  deleted or skipped (one type-literal field added, see item 59).
- FE typecheck: feel-final-typecheck.log — `tsc -p tsconfig.json --noEmit`
  exit 0, empty log.
- Targeted runs: feel-item59-tests.log (44/44), feel-item57-tests.log
  (18/18), feel-rewalk-tests.log (16/16).
- API suites not run: no API code touched (items are client-side, as
  briefed).

## Conflict-risk notes for integration
- hall-scene.ts hunks (3 commits touch it): item 59 — one field
  (onPadVoiceBack) beside onPadToggleVoice + one line in tickFlatMove;
  item 57 — step-dust import block, AvatarRig.lastStepCount field +
  buildAvatar init, scene step-dust fields beside selfMover, the
  serviceStepDust method inserted immediately before serviceLoopFeeds,
  one call line after the self applyActionPose in tick, one teardown block
  in dispose(). All additive; no existing line rewritten except none.
  Highest overlap risk is with any lane also editing the figure tick /
  serviceLoopFeeds area or AvatarRig's field list.
- world.tsx: item 59 only — one import line (prevVoiceMode) + one callback
  assignment directly under scene.onPadToggleVoice (the same block the
  studio/voice lane previously edited for the voice headline; the hunk is
  adjacent, not overlapping).
- palace-layout.ts / district-gates.ts / movement.ts logic: untouched
  (movement.ts: comment only). New files step-dust.ts / step-dust.test.ts /
  feel-rewalk.test.ts conflict with nothing.
