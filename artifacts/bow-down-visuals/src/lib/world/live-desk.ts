/**
 * live-desk.ts — Live Wave I (stack-100 #85–#87): the pure seam for
 * the hall Screen panel's live desks.
 *
 * Every rail here is the 2D Go Live studio's own, verbatim:
 *  - #85 studio: GET /api/live-streams/status, the stream-kit
 *    transport (createStreamTransport — POST /api/live-streams with
 *    the SITE_DESTINATION, then the transport's own pipe: WHIP or
 *    the own-server chunk ingest; stop() ends via
 *    POST /api/live-streams/:id/end), the ingest-key doors
 *    (GET/reveal/regenerate/revoke/PATCH /api/live-streams/ingest-key),
 *    the saved destination keys (reachApi — /api/reach/destinations)
 *    and channel loyalty (reachApi — /api/reach/loyalty/:profileId +
 *    its settings PUT and redemption queue/resolve rails), with the
 *    profile id from GET /api/creator-profiles/me exactly like
 *    LoyaltySettingsPanel resolves it.
 *  - #86 guests & backstage: lib/go-live/guest-api.ts host doors
 *    (mint/list/revoke invites, promote/demote/remove guests, host
 *    backstage history/post) + the BackstageClient socket — the same
 *    client GuestPanel rides.
 *  - #87 join as guest: guest-api's guest doors (readInvite,
 *    joinAsGuest, guestSession, guestHeartbeat, guestLeave, guest
 *    backstage history/post) + BackstageClient with the guest token —
 *    the same rails live-guest.tsx rides. A signed-in MEMBER joins a
 *    stream as its guest participant; this is NOT the palace-guest
 *    (unauthenticated visitor) concept — the desks render only inside
 *    the Screen panel, which the World already gates to signed-in
 *    members, so palace guests gain no voice anywhere from this wave.
 *
 * Nothing here invents an endpoint or a price: going live, invites,
 * backstage and joining are all free rails on the 2D site, and the
 * desks charge nothing.
 */

/* ── #85 studio rails ─────────────────────────────────────────────── */

export const LIVE_STATUS_PATH = "/api/live-streams/status";
export const LIVE_STREAM_PATH = (id: string) => `/api/live-streams/${encodeURIComponent(id)}`;
export const LIVE_STREAM_END_PATH = (id: string) => `/api/live-streams/${encodeURIComponent(id)}/end`;
export const INGEST_KEY_PATH = "/api/live-streams/ingest-key";
export const INGEST_KEY_REVEAL_PATH = "/api/live-streams/ingest-key/reveal";
export const INGEST_KEY_REGENERATE_PATH = "/api/live-streams/ingest-key/regenerate";
export const INGEST_KEY_REVOKE_PATH = "/api/live-streams/ingest-key/revoke";
export const MY_PROFILE_PATH = "/api/creator-profiles/me";

/** LoyaltySettingsPanel's fixed menus — the selects ARE the menu. */
export const LOYALTY_WATCH_MENU = [0, 5, 10, 20] as const;
export const LOYALTY_CHAT_MENU = [0, 1, 2, 5] as const;
export const LOYALTY_TIP_MENU = [0, 5, 10] as const;
export const LOYALTY_CUSTOM_COST_MENU = [500, 1000, 2500, 5000] as const;

export interface LiveStatusView {
  configured: boolean;
  transport: "own" | "cloudflare" | null;
  liveStream: { id: string; title: string; viewerCount: number } | null;
}

export function normalizeLiveStatus(raw: unknown): LiveStatusView {
  const d = (raw ?? {}) as Record<string, unknown>;
  const live = (d["live_stream"] ?? null) as Record<string, unknown> | null;
  return {
    configured: d["configured"] === true,
    transport: d["transport"] === "own" || d["transport"] === "cloudflare" ? d["transport"] : null,
    liveStream: live && typeof live["id"] === "string"
      ? {
          id: live["id"],
          title: typeof live["title"] === "string" ? live["title"] : "Live stream",
          viewerCount: typeof live["viewer_count"] === "number" ? live["viewer_count"] : 0,
        }
      : null,
  };
}

/** The studio's title gate, verbatim: a stream needs a title. */
export function streamTitleReady(title: string): boolean {
  return title.trim().length >= 1 && title.trim().length <= 200;
}

/** IngestKeyPanel's rule: an existing key can never be re-shown —
 *  only the minting response carries it, exactly once. */
export function ingestKeyShownOnce(plainKey: string | null | undefined): boolean {
  return typeof plainKey === "string" && plainKey.length > 0;
}

/* ── #86 guests & backstage ───────────────────────────────────────── */

/** GuestPanel's invite defaults: 4 hours, no join cap unless set. */
export const INVITE_EXPIRY_OPTIONS = [
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 1440, label: "24 hours" },
  { minutes: 10080, label: "7 days" },
] as const;

export interface GuestRosterRow {
  id: string;
  displayName: string;
  state: string;
  active: boolean;
  onStage: boolean;
}

/** listGuestInvites' guests, filtered the way GuestPanel filters:
 *  only backstage / on_stage sessions are in the room. */
export function normalizeGuestRoster(raw: unknown): GuestRosterRow[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: GuestRosterRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const g = r as Record<string, unknown>;
    if (typeof g["id"] !== "string" || typeof g["display_name"] !== "string") continue;
    const state = typeof g["state"] === "string" ? g["state"] : "";
    out.push({
      id: g["id"],
      displayName: g["display_name"],
      state,
      active: state === "backstage" || state === "on_stage",
      onStage: state === "on_stage",
    });
  }
  return out.filter((g) => g.active);
}

/** The full invite URL the host shares — GuestPanel builds it from
 *  the mint response's invite_path on the page origin. */
export function inviteShareUrl(origin: string, invitePath: string): string {
  return `${origin}${invitePath}`;
}

/** Backstage chat's server rule, mirrored for the composer:
 *  1–500 characters (live-guests.ts bodySchema). */
export const BACKSTAGE_SAY_MAX = 500;
export function backstageDraftReady(draft: string): boolean {
  const n = draft.trim().length;
  return n >= 1 && n <= BACKSTAGE_SAY_MAX;
}

/* ── #87 join a stream as a guest ─────────────────────────────────── */

/**
 * Pull the invite token out of whatever the member pastes: a full
 * /live/guest/<token> link (any origin) or the bare token itself.
 * Returns null when there's nothing token-shaped to try — the read
 * rail is never fired on an empty box.
 */
export function extractInviteToken(pasted: string): string | null {
  const text = pasted.trim();
  if (!text) return null;
  const fromPath = text.match(/\/live\/guest\/([A-Za-z0-9_-]+)/);
  if (fromPath) return fromPath[1]!;
  if (/^[A-Za-z0-9_-]{8,}$/.test(text)) return text;
  return null;
}

/** live-guest.tsx's session-storage key for resuming a guest pass. */
export function guestStorageKey(inviteToken: string): string {
  return `bdv-guest:${inviteToken}`;
}

/** The join door's name rule (live-guests.ts): 1–40 characters. */
export const GUEST_NAME_MAX = 40;
export function guestNameReady(name: string): boolean {
  const n = name.trim().length;
  return n >= 1 && n <= GUEST_NAME_MAX;
}

/** A guest session is in the room only while backstage / on_stage. */
export function guestSessionActive(state: string | null | undefined): boolean {
  return state === "backstage" || state === "on_stage";
}

export const LIVE_WAVE1_PROMOTIONS = [
  "#85 Go Live studio in the hall Screen panel: status, camera + transport go-live/end, ingest key, destination keys, loyalty — the BroadcastStudio / IngestKeyPanel / DestinationKeysPanel / LoyaltySettingsPanel rails verbatim",
  "#86 Stream guests & backstage in the hall: guest-api host doors (mint/list/revoke invites, promote/demote/remove) + host backstage chat over REST and the BackstageClient socket",
  "#87 Join a stream as a guest in the hall: guest-api guest doors (read invite, join, session, heartbeat, backstage chat, leave) + BackstageClient with the guest token — signed-in members only; palace guests gain no voice",
] as const;

export const LIVE_NATIVE_FOLLOW_ONS = [
  "Stream scheduling/management in-world stays with stack-100 #88 (the Palace Calendar remains read-only this wave)",
  "The full Stream Controller deck (scenes/transitions/remote) stays with #89 — promote here moves the guest's server state; the 2D studio's scene compositing is not rebuilt in-world",
  "Dedicated stream chat + follow rail on the watch side stays with #90",
] as const;
