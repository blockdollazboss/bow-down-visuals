# AUDIT FACET C — Movement, presence, voice (verbatim, worker 39784d1d)
MOVEMENT/CLIMBABLE-Y:
- C-M1 WorldFigure has NO y (world-palace.ts:135-143); MoveBodySchema v:z.number() (z-as-y legacy name); no jump/gravity/ramp/stair logic anywhere in world-client.ts. Server validates XZ only.
- C-M2 Heights/terraces are WALLS: layout `grounds` rects (per-step 0.28m bounds in palace-layout.ts) excluded from walkable; figure forced y=0 always (hall-scene.ts:4139). District thresholds are the only z-boundary transfers.
- C-M3 Client collision = axis-separated resolveBlocked over layout spec (world-client.ts:124-150); server NEVER re-checks collision — trusts client mid-segments. TRUE opening for client Y: server clamps y to a per-room ceiling or validates against room grounds map — neither exists yet.
CAMERA:
- C-C1 NO camera collision: collisionStart never assigned (hall-scene.ts:3530); thirdPersonCamera has no clamp vs walls/figures — camera passes through walls/props.
- C-C2 stride/bob math exists (movement.ts:68-84) but NOT wired into the render loop (grep: no call site) — dead code; entry camera glide uses its own lerp.
COLLISION COVERAGE (world-colliders.ts:56-104):
- C-K1 Gate-collision flag is INVERTED/misleading: threshold gates + door zones called "passable" but both PUSH the walker out (enterGate/settle-figure).
- C-K2 garden fine props (bird silhouettes, carp cutouts) NOT in blocked spec — context-dependent honesty call.
- C-K3 jewellery cases partially blocked: blockers at 5/8 positions; 3 unblocked cases walkable through.
VOICE:
- C-V1 world-voice-config.ts is STATIC-ONLY (one env username/credential, all-or-nothing, no expiry/rotation); no per-user ephemeral creds — code-side TURN readiness item: ephemeral HMAC cred support in the config rail (server signs per-session short-lived creds when WORLD_TURN_SECRET set).
- C-V2 connection state keys off connectionState events + ontrack override (voice.ts:330-365) — solid; remaining surface is partial-failure granularity? Facet found state model sound.
- C-V3 character-voice.ts:36 SHAPE_LABELS parallel array (pitch/rate labels for ALL 55 rows) — drift-prone duplication.
- C-V4 onPeerConnectionStates typed via ReturnType<typeof summarizeVoiceConnections>; summary recomputed on EVERY snapshot incl. join/partway states.
PRESENCE:
- C-P1 Ghost sweep runs on the DIRECTORY request path (world-palace.ts:974 setInterval 90s) — truthful but coupled to request traffic.
- C-P2 stale counters closed over singleton cleanup (world-palace.ts:1147-1222) — relies on closure state.
- C-P3 NO ghost iconography with 2+ room members present; "quiet" caption only renders when room has exactly 1 member — silent-empty-room signal gap in mixed rooms.
- C-P4 figure depths recompute per frame even when idle (hall-scene.ts:4130) — 30-cap loop ok, minor waste (overlaps E-15).
INPUT:
- C-I1 Gamepad: buttons 6/7 (LT/RT) INDEXED but never consumed — two dead triggers on every pad.
- C-I2 Touch zones: LEFT_SIDE only for look-drag; no second virtual stick / dedicated touch-jump zone (ties to climbable-Y input).
