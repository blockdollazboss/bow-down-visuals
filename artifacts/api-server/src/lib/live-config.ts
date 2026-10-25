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

/* ── Stream tips + pinned messages (Stack 2) ──────────────────────────────
   Amounts are Visual Bucs — the site's credit unit, displayed as-is
   (the x100 convention: never single-digit money figures). The pin
   minimum is a single named constant so the owner can rule on it in
   one place: a tip at or above it pins its message to the top of
   chat for LIVE_TIP_PIN_DURATION_MS. The pin rides the tip — there
   is no separate pin charge. */
export const LIVE_TIP_MINIMUM_VB = 100;
export const LIVE_TIP_MAXIMUM_VB = 1_000_000;
export const LIVE_TIP_PIN_MINIMUM_VB = 500;
export const LIVE_TIP_PIN_DURATION_MS = 2 * 60 * 1000;

/* ── Ticketed live (Wave 4 #31) ──────────────────────────────────────────
   A creator-set ticket price for a stream, in Visual Bucs. The bounds
   mirror the tip range above (and the 100–1,000,000 VB range the owner
   ratified for World stage tips): below 100 VB a door is noise, above
   1,000,000 it is not a ticket. 0 / unset = a free stream. Named
   constants so the owner can rule on them in one place. */
export const LIVE_TICKET_MIN_VB = 100;
export const LIVE_TICKET_MAX_VB = 1_000_000;
/** Seat capacity bounds when a creator caps the room (null = no cap). */
export const LIVE_TICKET_MAX_CAPACITY = 100_000;

export function isLiveTransportReady(
  kind: LiveTransportKind,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (kind === "cloudflare") return isStreamConfigured(env);
  return env["LIVE_OWN_SERVER"]?.trim().toLowerCase() !== "off";
}
