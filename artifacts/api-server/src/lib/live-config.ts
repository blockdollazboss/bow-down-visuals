import { isStreamConfigured } from "./cloudflare-stream";

/* ── Go Live transport selection ──────────────────────────────────────────
   The broadcast studio publishes through one of two transports, chosen
   by env — the studio learns the choice from GET /live-streams/status
   and never offers a path the server hasn't selected:

   - "own" (default): our own server carries the stream. The browser
     sends the show to this API in short chunks; the API turns them into
     a live HLS feed and serves it to the watch page. No external keys,
     no per-minute provider bill — it rides the service the site already
     runs on. Ready unless explicitly switched off (LIVE_OWN_SERVER=off).

   - "cloudflare": WHIP/WebRTC through Cloudflare Stream. Ready only
     when its credentials are set (CLOUDFLARE_ACCOUNT_ID /
     CLOUDFLARE_STREAM_TOKEN) — until then create answers an honest 503.

   Selection is read from env at call time (never cached) so tests and
   ops can flip it without a code change. */

export type LiveTransportKind = "own" | "cloudflare";

export function selectedLiveTransport(env: NodeJS.ProcessEnv = process.env): LiveTransportKind {
  return env["LIVE_TRANSPORT"]?.trim().toLowerCase() === "cloudflare" ? "cloudflare" : "own";
}

export function isLiveTransportReady(
  kind: LiveTransportKind,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (kind === "cloudflare") return isStreamConfigured(env);
  return env["LIVE_OWN_SERVER"]?.trim().toLowerCase() !== "off";
}
