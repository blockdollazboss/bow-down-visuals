# Item 100 — Voice reliability: TURN relay evaluation + honest connection state

## What the voice stack was (traced)

- Mesh: `artifacts/bow-down-visuals/src/lib/world/voice.ts` — `VoiceMesh`,
  one `RTCPeerConnection` per voice peer (server cap 12, room-wide,
  proximity only in receive gains). Newcomer offers; members answer.
- ICE config before this item: a single hardcoded STUN server
  (`stun:stun.l.google.com:19302`) in `createBrowserPeerConnection()`.
  **No TURN relay, no config source, no env support anywhere** — the
  same STUN-only shape exists in the two sibling meshes
  (`lib/go-live/guest-mesh.ts`, `components/trust/StageRooms.tsx`),
  which are OUT of this item's scope (World proximity voice only).
- Connection state before this item: **nothing surfaced it.** The PC's
  `connectionState` was never read; a pair that failed ICE negotiation
  (symmetric NAT / strict firewall) produced silent dead air with no
  signal to the user and no recovery short of leaving/rejoining voice.

## Half 1 — Honest connection state (BUILT)

- `VoiceMesh` now tracks every pair's state via `onconnectionstatechange`
  (+ a landed `ontrack` stream counts as connected; a later real
  `failed` still overrides). States are the three honest words:
  `connecting` / `connected` / `failed` (`disconnected` maps to
  connecting — the browser is still retrying; only its `failed`
  verdict is reported as failure).
- New pure helpers in `voice.ts`: `mapRtcConnectionState`,
  `summarizeVoiceConnections` (empty/connected/connecting/partial/
  failed + the failed peer ids), `voiceConnectionHeadline` (plain
  words; the all-failed headline says the network may be blocking
  peer-to-peer voice and that text still works).
- The mesh emits the full snapshot through the new optional
  `onPeerConnectionStates` dep on every change / peer join / drop.
- `VoiceMesh.retryPeer(peerId)`: tears a dead pair down and offers
  fresh on a new PC (mic re-attached). Refuses unknown peers and a
  mesh that already left.
- UI (`pages/world.tsx`, members-only voice footer — guests never see
  it, guest law untouched): an aggregate chip with
  `data-testid="world-voice-conn-state"` showing the headline while in
  voice, and a **Retry connection** button
  (`data-testid="world-voice-retry"`) whenever any pair has failed,
  retrying every failed pair. Alone in voice → no chip (nobody to
  connect to — no fake "connected").

## Half 2 — TURN relay: evaluation + config seam (BUILT, relay itself NOT stood up)

No TURN support existed, so per the brief this half is a working
config seam + this evaluation. No servers stood up, no services
bought, no credentials in code or commits.

### The seam (works today, end to end)

1. **Server (sanctioned config source):** `GET /api/world/voice-config`
   (`requireAuth` — members only, since voice is members-only)
   returns `{ turnServers: [...] }` built by
   `artifacts/api-server/src/lib/world-voice-config.ts` from env:
   - `WORLD_TURN_URLS` — comma-separated `turn:`/`turns:` URLs
   - `WORLD_TURN_USERNAME`
   - `WORLD_TURN_CREDENTIAL`
   All-or-nothing and fail-closed: any missing/invalid half serves an
   honest empty list. Until the env is set, the endpoint serves
   `{ turnServers: [] }` — the relay is OFF, truthfully.
2. **Client:** `lib/world/voice-ice.ts` — `fetchVoiceIceServers()`
   asks that endpoint at Join-voice time (Authorization header, same
   as the rest of the World page), `buildIceServers()` produces
   `[STUN default, ...validated TURN entries (cap 4)]`, and
   `createBrowserPeerConnection(iceServers)` consumes it. Every
   failure (offline, 401, junk JSON, malformed TURN entry) fails open
   to exactly today's STUN-only behaviour, and fails closed per-entry:
   a half credential pair or non-`turn:` URL is dropped, never
   half-used. Credentials exist only in server env and in the live
   session's memory — never stored, logged, or committed.

### What the owner would need to stand up a relay (owner's money/infra call)

Option A — **self-hosted coturn** (open source, the usual pick):
- A small always-on VM (the relay is bandwidth-, not CPU-bound) with
  a public IP, UDP/TCP 3478 (+ 5349 for TLS) and a relay port range
  (e.g. UDP 49152–65535) open; a DNS name; a static shared secret or
  a long-term username/credential.
- Cost shape: the VM itself (small instances are typically in the
  ~$5–10/mo class) **plus bandwidth** — every relayed voice minute
  transits the box twice. Voice is ~30–50 kbps per stream, mesh cap
  is 12 per room, so a room-full hour is on the order of a few
  hundred MB. Fits comfortably beside the existing infrastructure
  IF the host allows the UDP port range (check before committing —
  some hosts restrict it).
- Then set the three `WORLD_TURN_*` env vars on the API service and
  redeploy. **No code change needed — the seam above is the whole
  integration.**
- Known limitation to accept with static credentials: anyone signed
  in can read the served credential from the endpoint response, so
  rotate it if abused; the upgrade path is time-limited credentials
  (coturn `--use-auth-secret` / TURN REST API, HMAC-signed ephemeral
  usernames) — a small follow-up in `world-voice-config.ts` only,
  the client seam already just consumes what it is served.

Option B — **metered TURN service** (no box to run): providers such
as Twilio Network Traversal, Cloudflare Calls/Realtime TURN, Xirsys,
or Metered offer TURN as a metered API (typically priced per GB
relayed, some with a free tier). Same integration: they issue a
URL + username + credential → set the same three env vars. Less to
operate, ongoing per-GB cost, and one more vendor holding a (minor)
piece of the stack.

Option C — do nothing: voice keeps working on the large majority of
networks (STUN suffices wherever NAT is cone-shaped), and as of this
item the minority that can't connect at least SEE that it failed,
why it likely failed, and get a retry — instead of dead air.

### Recommendation (for the owner to rule on, NOT actioned)

Option A on a small dedicated VM when voice reliability starts
mattering for launch: fixed, predictable cost, no per-GB meter, and
the credential-rotation story is in-house. Option B if standing up
any new box is a hard no. Either way the only step at decision time
is env + redeploy.

## Untouched, per constraints

Mesh behaviour otherwise unchanged (cap 12, newcomer-offers except
the deliberate retry re-offer, proximity gains, mute/deafen law);
guest law untouched (no guest voice surfaces — the state chip and
retry live inside the members-only in-voice footer); no schema /
migrations; no scene-lane files touched.
