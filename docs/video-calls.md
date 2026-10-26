# Video calls in Messages — Phase 1 (Stack-200 lane `rem-video-calls`)

1:1 video calls docked **inside Messages** — never a standalone page.
WebRTC peer-to-peer media; signaling over the existing LiveWsGateway;
a DB ledger for in-thread history. No paid provider, $0 of media cost.

## ⚠ Provisional migration — JOIN LANE ACTION REQUIRED

The ledger table lands as **`lib/db/migrations/9999-video-calls.sql`
(PROVISIONAL number)**. The join lane must renumber it into the next
real migration slot at integration time and update the reference in
`artifacts/api-server/src/routes/video-calls.ts` (header comment).
The schema source of truth is `lib/db/src/schema/video-calls.ts`
(already in sync). Until the migration runs, the feature degrades
honestly: history reads return an empty list, call starts answer
`503 calls_unavailable`, and the Messages UI explains itself.

## Shape

| Piece | Where |
|---|---|
| Pure brain (gate, state machine, ICE, frame contract) | `artifacts/api-server/src/lib/video-calls.ts` |
| Signaling hub (per-user sockets, relay rule) | `artifacts/api-server/src/lib/video-call-signaling.ts` |
| REST + WS routes, ring timer, block sever | `artifacts/api-server/src/routes/video-calls.ts` |
| Block handler hook | `artifacts/api-server/src/routes/community.ts` (`severVideoCallsForConversation`) |
| Schema + provisional migration | `lib/db/src/schema/video-calls.ts`, `lib/db/migrations/9999-video-calls.sql` |
| Client brain (labels mirror, merge, peer session) | `artifacts/bow-down-visuals/src/lib/video-call.ts` |
| Dock UI (call bar, ring card, call panel) | `artifacts/bow-down-visuals/src/components/messages/VideoCallDock.tsx` |
| Page wiring (history interleave, call-back) | `artifacts/bow-down-visuals/src/pages/messages.tsx` |
| TURN relay (coturn on the Oracle VM) | `infra/coturn/` (template, installer, README) |

## Contract

- REST: `GET /api/dm/call-config`, `POST /api/dm/:id/call`,
  `GET /api/dm/:id/calls`, `POST /api/dm/calls/:callId/accept|decline|end`.
- WS: `/api/dm/calls/ws?token=…` — session-token verified; events
  `call.ring / call.accepted / call.declined / call.ended / call.busy /
  call.signal / call.hello`; client frames `call.signal` (≤32 KB) and
  `call.ping` (25 s app-level keepalive).
- Ring window 45 s → settles `missed`. One live call per person; a
  busy callee settles the new attempt `busy` without ringing.
- Every settlement is exactly-once through `settleCall` (REST action,
  ring timer, block sever, and socket disconnect all funnel there).

## Privacy — inherited from DMs, exactly

- Only `inbox` conversations can ring. `request` threads answer
  `403 not_accepted` (accept the message request first — a call must
  never be a dumber interruption than a message). `blocked` answers
  `403 blocked`.
- A block landing mid-ring or mid-call **severs** it (settled
  `blocked`, both clients told).
- Signaling re-checks privacy **per frame** at relay time — a block
  stops the very next SDP/ICE frame.
- Guests cannot call: no account, no conversation, no token — REST
  answers 401, the socket closes 4401.
- The ledger stores no content, no SDP, no ICE. Media is DTLS
  end-to-end between the two browsers.

## Controls

Call / ring / accept / decline / cancel / hang up; mute and
camera-off (track `enabled`, instant, no renegotiation); camera flip
(getUserMedia with the other facingMode + `replaceTrack`); live
duration clock; missed calls render in-thread with a **Call back**
door.

## TURN relay status

coturn bundle lives in `infra/coturn/`. **Installed on the VM on
Oct 26, 2026** (when the SSH path through the transparent proxy
recovered): `setup.sh` completed — service `coturn` active, host
firewall opened + persisted, loopback STUN self-test passed. The
secret was generated on the box and never left it. Two owner steps
remain (OCI console ingress rules for 3478/relay ports + Render env
carrying the secret) — exact click-paths in `infra/coturn/README.md`.
Until the OCI ingress lands, 3478 is not reachable from the public
internet (verified Oct 26: port 22 answers externally, 3478 does
not); calls still work STUN-only for direct-reachable pairs, and the
ICE config never fakes a relay.

## Both themes

The dock uses the Messages page palette (near-black ground, gold
accent, white/10 structure), which the site's global theme tables
remap into the light theme — call UI renders designed in both, like
the rest of the thread around it.

## Phase 2 (not in this lane)

Group calls, `turns:`/TLS on 5349, push-notification rings for
closed pages, renegotiation (screen share), call recording (never
planned — calls are private by design).
