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
 *
 * Wave II (#88–#91) extends the same seam below: stream scheduling
 * on GoLiveMain's /api/discord/streams doors, the Stream Controller
 * deck on its per-account relay socket, live-watch parity on
 * live-watch.tsx's doors, and premiere scheduling on reachApi's
 * premiere doors. All four are free rails on the 2D site too.
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
  liveStream: {
    id: string;
    title: string;
    viewerCount: number;
    /** The server-written broadcast start (item 98: `started_at` is
     *  written in the api-server go-live start path — POST create on
     *  both transports and the RTMP ingest start — so EVERY surface
     *  that starts a broadcast publishes it, and this ONE shared
     *  status read is where every surface reads it back). Null only
     *  when the server didn't say — never a client-side guess. */
    startedAt: string | null;
  } | null;
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
          startedAt: typeof live["started_at"] === "string" ? live["started_at"] : null,
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

/* ── #88 stream scheduling / management ─────────────────────────────
   The 2D stream management surface is GoLiveMain's Schedule section
   (pages/go-live.tsx), and its rails are the discord-stream doors:
   GET /api/discord/streams (upcoming + recent, newest first),
   POST /api/discord/streams { title, game?, scheduled_for? }
   (scheduleSchema: title 1–200, game ≤100, ISO datetime with offset),
   DELETE /api/discord/streams/:id (cancel). There is NO edit/PATCH
   rail anywhere in the 2D site — an edit in-world is therefore the
   honest composite the rails allow: prefill the form from the row,
   POST the replacement first, and only then DELETE the old row, so
   a failed save never loses the original plan. */

export const SCHEDULED_STREAMS_PATH = "/api/discord/streams";
export const SCHEDULED_STREAM_PATH = (id: string) => `/api/discord/streams/${encodeURIComponent(id)}`;

export interface ScheduledStreamRow {
  id: string;
  title: string;
  game: string | null;
  status: "scheduled" | "live" | "ended";
  scheduledFor: string | null;
  endedAt: string | null;
  vodUrl: string | null;
}

export interface ScheduledStreamsView {
  upcoming: ScheduledStreamRow[];
  recent: ScheduledStreamRow[];
}

/** GoLiveMain's split, verbatim: upcoming = status "scheduled";
 *  recent = the first 5 ended. Live rows belong to neither list —
 *  the announce panel owns the live one on the 2D page, and the
 *  studio desk owns it here. */
export function normalizeScheduledStreams(raw: unknown): ScheduledStreamsView {
  const d = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(d["streams"]) ? d["streams"] : [];
  const all: ScheduledStreamRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const s = r as Record<string, unknown>;
    if (typeof s["id"] !== "string" || typeof s["title"] !== "string") continue;
    const status = s["status"];
    if (status !== "scheduled" && status !== "live" && status !== "ended") continue;
    all.push({
      id: s["id"],
      title: s["title"],
      game: typeof s["game"] === "string" ? s["game"] : null,
      status,
      scheduledFor: typeof s["scheduled_for"] === "string" ? s["scheduled_for"] : null,
      endedAt: typeof s["ended_at"] === "string" ? s["ended_at"] : null,
      vodUrl: typeof s["vod_url"] === "string" ? s["vod_url"] : null,
    });
  }
  return {
    upcoming: all.filter((s) => s.status === "scheduled"),
    recent: all.filter((s) => s.status === "ended").slice(0, 5),
  };
}

/** scheduleSchema's gates, mirrored for the form: a title of 1–200
 *  trimmed characters; the game line is optional, ≤100. */
export function scheduleDraftReady(title: string, game: string): boolean {
  const t = title.trim();
  return t.length >= 1 && t.length <= 200 && game.trim().length <= 100;
}

/** datetime-local value → the ISO-with-offset string the POST rail
 *  takes (GoLiveMain's `new Date(when).toISOString()`, verbatim).
 *  An empty box means "no date set", exactly like the 2D form. */
export function scheduleWhenIso(localValue: string): string | undefined {
  if (!localValue) return undefined;
  const ms = new Date(localValue).getTime();
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** An existing row's instant → the datetime-local box's value
 *  (local wall time, minute precision) for the edit prefill. */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ── #89 Stream Controller deck ─────────────────────────────────────
   The 2D controller surface (pages/stream-controller.tsx) is the
   StreamDeck component driven by ControllerRemoteClient over the
   per-account relay socket /api/live/controller/ws?role=remote —
   pairing is by verified account session, never a code: a remote
   can only ever reach its OWN studio. The in-world desk is that
   exact client + deck, docked in the Screen panel. Its other half —
   the stage side that executes commands — is the studio itself
   (BroadcastStudio's bridge); the wave-I in-world studio does not
   publish controller state, so the deck honestly reports "Studio
   not open" until the member's studio (2D tab, or a future stage
   bridge) is running — the same state the phone remote shows. */

export const CONTROLLER_WS_PATH = "/api/live/controller/ws";

export interface ControllerDeskView {
  started: boolean;
  socketUp: boolean;
  stageConnected: boolean;
  live: boolean;
  label: string | null;
}

/** stream-controller.tsx's status line, verbatim wording. */
export function controllerStatusLine(v: ControllerDeskView): string {
  if (!v.started) return "Connecting…";
  if (!v.socketUp) return "Reconnecting…";
  if (!v.stageConnected) return "Studio not open";
  return v.live ? `Live — controlling ${v.label}` : `Connected — controlling ${v.label ?? "your studio"}`;
}

/** stream-controller.tsx's unavailable note, verbatim wording and
 *  precedence (no stage beats a dropped socket). */
export function controllerUnavailableNote(v: Pick<ControllerDeskView, "socketUp" | "stageConnected">): string | null {
  if (!v.stageConnected) return "Open the studio — this remote connects to it automatically.";
  if (!v.socketUp) return "Connection dropped — reconnecting. Controls pause until it's back.";
  return null;
}

/* ── #90 live-watch parity in the hall ──────────────────────────────
   The watch side of the hall screen, on live-watch.tsx's rails:
   GET /api/live-streams/:id (the public stream DTO), the presence
   heartbeat POST /api/live-streams/:id/heartbeat { session_id }
   every 15s while live (so the viewer count the creator sees is
   real), the dedicated stream chat (LiveChatPanel — the watch
   page's own panel, with its server-enforced chat rules, slow
   mode, mutes and moderation riding the live-chat rails), the
   follow rail (FollowButton + useFollowStates on the discovery
   rails, plus PushAlertsToggle) and the public on-stage guest
   chips (publicOnStageGuests). This is the AUDIENCE chat — wholly
   distinct from wave I's private backstage chat. */

export const WATCH_HEARTBEAT_PATH = (id: string) => `/api/live-streams/${encodeURIComponent(id)}/heartbeat`;

export interface WatchStreamView {
  id: string;
  title: string;
  status: string;
  viewerCount: number;
  peakViewers: number;
  creator: { id: string; slug: string; displayName: string; avatarUrl: string | null } | null;
}

export function normalizeWatchStream(raw: unknown): WatchStreamView | null {
  const d = (raw ?? {}) as Record<string, unknown>;
  const s = (d["stream"] ?? null) as Record<string, unknown> | null;
  if (!s || typeof s["id"] !== "string") return null;
  const c = (s["creator"] ?? null) as Record<string, unknown> | null;
  return {
    id: s["id"],
    title: typeof s["title"] === "string" ? s["title"] : "Live stream",
    status: typeof s["status"] === "string" ? s["status"] : "",
    viewerCount: typeof s["viewer_count"] === "number" ? s["viewer_count"] : 0,
    peakViewers: typeof s["peak_viewers"] === "number" ? s["peak_viewers"] : 0,
    creator: c && typeof c["id"] === "string" && typeof c["slug"] === "string"
      ? {
          id: c["id"],
          slug: c["slug"],
          displayName: typeof c["display_name"] === "string" ? c["display_name"] : "Creator",
          avatarUrl: typeof c["avatar_url"] === "string" ? c["avatar_url"] : null,
        }
      : null,
  };
}

export function watchHeartbeatBody(sessionId: string): { session_id: string } {
  return { session_id: sessionId };
}

/** The hall watch desk watches the stream ON the big screen — the
 *  Screen state the room broadcasts (mode "live" + a streamId).
 *  Anything else (Reel, watch-party video) has no stream chat or
 *  follow rail to mirror. */
export function watchStreamIdFromScreen(screen: { mode: string; streamId: string | null } | null): string | null {
  return screen && screen.mode === "live" && typeof screen.streamId === "string" && screen.streamId
    ? screen.streamId
    : null;
}

/* ── #91 premiere / broadcast scheduling ────────────────────────────
   The 2D premiere flow (SchedulePremiereForm on /premiere + the
   /broadcast page) rides reachApi's premiere doors verbatim:
   POST /api/reach/premieres { clipId, title, durationSeconds,
   scheduledAt } (premiereCreateSchema: clip uuid, title 1–200,
   duration 10–14400 seconds, a future ISO start), GET
   /api/reach/premieres/upcoming, POST /api/reach/premieres/:id/cancel
   (owner-only, scheduled-only — the server enforces both). The clip
   picker is the form's own: GET /api/generated-clips, keeping only
   status "completed". The upcoming list is site-wide; a row is
   yours when its creator is your profile (/api/creator-profiles/me,
   wave I's resolution) — only yours offer the cancel door. */

export const GENERATED_CLIPS_PATH = "/api/generated-clips";
export const PREMIERES_UPCOMING_PATH = "/api/reach/premieres/upcoming";
export const PREMIERE_CREATE_PATH = "/api/reach/premieres";
export const PREMIERE_CANCEL_PATH = (id: string) => `/api/reach/premieres/${encodeURIComponent(id)}/cancel`;

export interface FinishedClipOption {
  id: string;
  title: string;
}

/** SchedulePremiereForm's picker rule: finished videos only. */
export function normalizeFinishedClips(raw: unknown): FinishedClipOption[] {
  const d = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(d["clips"]) ? d["clips"] : Array.isArray(raw) ? raw : [];
  const out: FinishedClipOption[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const c = r as Record<string, unknown>;
    if (typeof c["id"] !== "string" || c["status"] !== "completed") continue;
    out.push({ id: c["id"], title: typeof c["title"] === "string" && c["title"] ? c["title"] : "Untitled video" });
  }
  return out;
}

export const PREMIERE_DURATION_MIN = 10;
export const PREMIERE_DURATION_MAX = 14400;

/** premiereCreateSchema + the route's future-start rule, mirrored:
 *  a picked clip, a 1–200 title, a whole duration in range, and a
 *  start time that is still ahead of us. */
export function premiereDraftReady(draft: {
  clipId: string;
  title: string;
  durationSeconds: number;
  whenLocal: string;
}, nowMs: number): boolean {
  if (!draft.clipId) return false;
  const t = draft.title.trim();
  if (t.length < 1 || t.length > 200) return false;
  if (!Number.isInteger(draft.durationSeconds) || draft.durationSeconds < PREMIERE_DURATION_MIN || draft.durationSeconds > PREMIERE_DURATION_MAX) return false;
  if (!draft.whenLocal) return false;
  const start = new Date(draft.whenLocal).getTime();
  return !Number.isNaN(start) && start > nowMs;
}

/** A row on the site-wide upcoming list is the member's own when
 *  its creator card is their profile — those rows (and only those)
 *  carry the cancel door the server would honour. */
export function isOwnPremiere(premiere: { creator: { id: string } | null }, myProfileId: string | null): boolean {
  return !!myProfileId && premiere.creator?.id === myProfileId;
}

export const LIVE_WAVE2_PROMOTIONS = [
  "#88 Stream scheduling/management in the hall Screen panel: GET/POST/DELETE /api/discord/streams — schedule, cancel, recent history, and edit as prefill + POST-replacement-then-DELETE (the 2D rails carry no PATCH; a failed save keeps the original)",
  "#89 Stream Controller deck in the hall: the StreamDeck component driven by ControllerRemoteClient over the per-account /api/live/controller/ws relay — scenes, cut/fade transitions, mic/camera/record, go-live and press-and-hold end, confirmed state only",
  "#90 Live-watch parity in the hall: the big screen's live stream gets LiveChatPanel (the watch page's dedicated stream chat, its rules server-enforced), the follow rail (FollowButton + PushAlertsToggle), on-stage guest chips and the 15s presence heartbeat",
  "#91 Premiere scheduling in the hall: SchedulePremiereForm's rails via reachApi (create from finished clips, site-wide upcoming list, owner cancel) — free rails, nothing charged",
] as const;

export const LIVE_NATIVE_FOLLOW_ONS = [
  "Premiere edit/reschedule has no rail (the 2D flow offers create + cancel only) — in-world it is cancel + schedule anew, same as the website",
  "The controller deck's stage half lives in the studio that executes commands: the wave-I in-world studio does not yet publish ControllerStageClient state, so the deck drives a running 2D studio exactly like the phone remote does",
  "Broadcast channels (/broadcast) are posting surfaces, not scheduling — they stay with their own surface; #91 covers the premiere/broadcast scheduling the /broadcast page itself hosts",
] as const;
