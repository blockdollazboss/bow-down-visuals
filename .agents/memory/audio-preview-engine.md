---
name: Audio preview engine (Music Studio)
description: How the browser-only Web Audio multi-track preview engine decides live-update vs restart, and its lifecycle gotchas.
---

# Audio preview engine (Music Studio, Bow Down Visuals)

A browser-only Web Audio `AudioMixEngine` powers the Music Studio multi-track
preview. It is PREVIEW ONLY — there is no rendering / mastering / export path.

## Live-update vs restart classification
Param changes split into two classes; getting a change in the wrong class means
the user either hears nothing change or hears an audible gap:

- **Live (no restart, applied via `setTargetAtTime`):** per-stem volume, mute,
  solo, pan, and all master settings (volume, fade in/out).
- **Structural (require rebuilding sources):** adding / removing / replacing a
  stem (id or url change), and trim-start / trim-end / timeline start-offset.

**Why:** an `AudioBufferSourceNode` is one-shot — its buffer, start offset and
duration are fixed at `start()`. You cannot re-trim or swap the buffer of a
playing source, so trim/offset/topology changes must tear down and restart.

**How to apply:** `sync()` compares a `computeTopologySig` fingerprint
(id+url+startTime+trimStart+trimEnd per stem). If it changed while playing, it
calls `restartAt(currentPosition())` for a seamless restart; otherwise it only
calls `applyLiveParams()`. If you add a new structural field, add it to the
signature or live changes to it will be silently ignored during playback.

## Async-start race guard
`play()` and `restartAt()` are async (they await decode). A monotonic
`startToken` is bumped at the start of each, and on `pause()`/`stop()`. After the
await, they bail if `token !== this.startToken`. This prevents a stale in-flight
start from firing sources after the user paused/stopped or triggered a newer
start. Keep this invariant if you add more async start paths.

## Other notes
- Buffers are decoded once and cached by **url** (not stem id), so re-adding the
  same file is instant and pruning is by url-set membership.
- StrictMode double-invoke: the engine is created once via a ref guard; the
  unmount effect `dispose()`s it but it stays reusable (ctx recreated lazily,
  buffers re-fetched on next `sync`).
