# Video-call TURN relay — self-hosted coturn on the owner's Oracle VM

Phase 1 video calls are WebRTC peer-to-peer. Most pairs connect
directly (STUN), but calls across symmetric NATs / strict firewalls
need a relay. The relay is **coturn on the owner's existing Oracle VM
(141.148.45.254 — the WireGuard box)**: $0, no Twilio, no paid
provider, media never touches Render.

```
caller browser ──WebRTC media (DTLS, end-to-end encrypted)──▶ callee browser
       │                        │ direct when NAT allows,
       │                        └ via coturn 141.148.45.254:3478 when not
       └─ signaling (SDP/ICE) ─▶ Render API ─▶ callee's call socket
```

How the app uses it (code: `artifacts/api-server/src/lib/video-calls.ts`):

- `GET /api/dm/call-config` (and the call start/accept responses)
  serve the ICE config. With the env below set, members get STUN +
  this relay with an **ephemeral credential pair** the server signs
  per member (HMAC-SHA1 over `<expiry>:<userId>`, 1-day TTL) from
  `VIDEO_CALL_TURN_SECRET` — the secret itself never leaves the
  server, and no client ever sees a reusable password.
- All-or-nothing: if the TURN env is half-set, the server serves
  STUN only and the UI stays honest — a broken relay entry is never
  served.
- `VIDEO_CALL_*` env wins; `WORLD_TURN_*` (World voice) is honored
  as a fallback so one box can serve both surfaces with one config.

## Files here

- `turnserver.conf.template` — the relay config (auth-secret mode,
  private-range peers denied, quotas, TLS section left off for
  Phase 2).
- `setup.sh` — the idempotent installer that runs **on the VM**:
  apt install, secret generation (on-box, root-only, never printed),
  config render, service enable, host-firewall rules, STUN
  self-test.

## Remaining owner steps

`setup.sh` (run from this repo against the VM by the build lane)
covers everything on the box itself. Two steps can only be done by
the owner — they live in the owner's cloud console, and one carries
the secret:

### Owner step 1 — OCI console ingress (cloud firewall)

OCI Console → Compute → Instances → `my-vpn` → Subnet → Security
Lists (or the instance's NSG) → Add Ingress Rules, source `0.0.0.0/0`:

| Protocol | Dest. port | Notes |
|---|---|---|
| UDP | 3478 | TURN/STUN |
| TCP | 3478 | TURN over TCP (fallback) |
| UDP | 49152–65535 | relay range |

Until this exists, the relay answers on the box itself (loopback
self-test passes) but browsers cannot reach it — calls fall back to
direct/STUN paths, which still work for most home networks.

### Owner step 2 — Render env (carries the secret)

Render → `bow-down-visuals` web service → Environment → Add:

```
VIDEO_CALL_TURN_URLS=turn:141.148.45.254:3478?transport=udp,turn:141.148.45.254:3478?transport=tcp
VIDEO_CALL_TURN_SECRET=<contents of /etc/bowdown-turn-secret on the VM>
```

Read the secret on the VM with `sudo cat /etc/bowdown-turn-secret`
and paste it directly into Render — never into chat, email, or this
repo. Then redeploy/restart the web service. (Same pair of values on
the staging service too, when staging is awake.)

### Verify

1. On the VM: `systemctl status coturn`, `sudo tail /var/log/turnserver.log`.
2. Trickle-ICE (https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
   with the TURN URL above — an ephemeral username/credential pair
   can be read off a real `GET /api/dm/call-config` response while
   signed in. Seeing `srflx` AND `relay` candidates = relay alive.
3. Place a real call: one side on home Wi-Fi, the other on cellular
   with Wi-Fi off.

## Rollback

On the VM: `sudo systemctl disable --now coturn`, delete the three
iptables ACCEPT rules (3478 udp/tcp, 49152:65535 udp), and remove
the two Render env vars (the app returns to STUN-only, calls keep
working for direct-reachable pairs). WireGuard is untouched by
every step above.

## Notes / Phase 2

- `turns:` (TLS, port 5349) is configured-but-commented in the
  template: it needs a DNS name + cert for the box. WebRTC media is
  DTLS-encrypted end-to-end either way, so this is metadata privacy,
  not media security.
- The relay range (49152–65535) overlaps Linux's default ephemeral
  port range; on this box that is harmless (its outbound needs are
  tiny: WireGuard + apt), and coturn binds relay ports explicitly.
