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
 *
 * Wave III (#92) extends the seam again: the 2D studio's "Behind me"
 * green-screen depth — the BackgroundChanger kit's modes, quality,
 * backdrop selection and fine-tune — carried into the wave-I studio
 * desk. The processing path is the kit itself (no second keyer, no
 * second settings shape): the desk owns a changer exactly like
 * BroadcastStudio does, and the fine-tune settings ride the kit's
 * own device store (greenscreen-finetune.ts), so the cutout tuned
 * on the 2D studio is the cutout the hall studio runs. Going live
 * and its effects are free on the 2D site; they are free here.
 *
 * Wave IV (#95) extends the seam once more: the scene kit's
 * per-source chroma key — the follow-on wave III named — rides the
 * #89 controller relay into the hall. The section at the end of
 * this file is the running studio's Preview-scene camera sources,
 * published in the controller state; a change sends the protocol's
 * scene.chroma.update command and the studio executes it through
 * Stage.updateSource — SourcesPanel's own write — so the kit's
 * applyChromaKey keys the source in the stage compositor exactly
 * as a studio-side flip would. There is no in-world Stage and no
 * second keyer, here as everywhere on this seam. Free, exactly as
 * on the page.
 */

import type {
  BackgroundMode, BackgroundQuality, BackgroundEngineKind, EngineStatusDetail,
} from "../stream-kit/background-changer";
import type { GreenScreenFineTune } from "../stream-kit/greenscreen-finetune";
import type { ChromaSettings } from "../stream-kit/scenes";
import { parseChromaUpdate, type ChromaUpdate } from "../stream-controller";
import {
  isSelectionActive, type BackdropSelection,
} from "../stream-kit/backdrop-selection";

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

interface GuestRosterRow {
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
const GUEST_NAME_MAX = 40;
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

interface ScheduledStreamsView {
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

interface ControllerDeskView {
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

const PREMIERE_DURATION_MIN = 10;
const PREMIERE_DURATION_MAX = 14400;

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
  "Camera effects, noise cancellation / voice effects, and camera + mic switching ride the same BackgroundChanger the #92 desk now owns — named follow-ons, not yet carried",
  "RTMP ingest: the server's door exists (lib/rtmp-ingest, migration 0194) but opens only when the deployment sets LIVE_RTMP_INGEST=on — no member rail on either surface can switch it. The key doors and the ingest URL the key read returns are already carried (#85)",
] as const;

/* ── #92 Behind me — the green-screen depth ─────────────────────────
   The 2D studio's "Behind me" panel (BroadcastStudio), carried into
   the wave-I studio desk on the SAME kit: BroadcastStudio owns a
   BackgroundChanger and everything downstream drinks its output
   stream; the desk now does exactly that (its transport publishes
   the changer's stream, so a mode/fine-tune/backdrop move lands in
   the live broadcast the same way it does on the page). Every table
   below mirrors the panel's own — the selects ARE the menu, exactly
   like the loyalty menus above. */

export const BACKGROUND_MODE_OPTIONS = [
  { mode: "green", label: "Green Screen" },
  { mode: "blur", label: "Blur" },
  { mode: "image", label: "Backdrop" },
  { mode: "none", label: "Original" },
] as const satisfies ReadonlyArray<{ mode: BackgroundMode; label: string }>;

export const BACKGROUND_QUALITY_OPTIONS = [
  { quality: "auto", label: "Auto" },
  { quality: "pro", label: "Pro" },
  { quality: "tasks", label: "MediaPipe" },
] as const satisfies ReadonlyArray<{ quality: BackgroundQuality; label: string }>;

/** BroadcastStudio's engine status line, verbatim wording: the
 *  engine ACTUALLY live, never the wanted one dressed up. */
export function engineKindLabel(kind: BackgroundEngineKind): string {
  return kind === "pro" ? "Pro" : kind === "tasks" ? "MediaPipe Tasks" : "Off";
}

/** BroadcastStudio's fallback note, verbatim: a fallen-back engine
 *  reads as a fallback with its real reason, or nothing at all. */
export function engineFallbackNote(detail: EngineStatusDetail | null): string | null {
  if (!detail?.fellBack) return null;
  return detail.reason === "pro-stopped"
    ? "Pro engine stopped on this device — camera is running plain. Try MediaPipe, or reopen the studio."
    : detail.reason === "tasks-stopped"
      ? "MediaPipe engine stopped on this device — camera is running plain. Try Pro, or reopen the studio."
      : detail.reason === "tasks-init-failed"
        ? "MediaPipe engine couldn't start on this device — camera is running plain."
        : "Pro engine couldn't start on this device — camera is running plain.";
}

/** BroadcastStudio's engine-down rule, verbatim: 'off' is only a
 *  FAILURE when a backdrop mode is in play and the kit is carrying
 *  an engine error. An engine off because the creator is on
 *  Original (raw by choice, no error) must not read as "couldn't
 *  load" or lock the backdrop pills. */
export function engineDownFromStatus(kind: BackgroundEngineKind, mode: BackgroundMode, hasEngineError: boolean): boolean {
  return kind === "off" && !(mode === "none" && !hasEngineError);
}

/** The backdrop grid's active rule, verbatim: the selection is the
 *  active tile only while Backdrop mode is showing it (a held pick
 *  in Green Screen mode is a pick, not the painted background). */
export function backdropTileActive(
  selection: BackdropSelection,
  candidate: BackdropSelection,
  mode: BackgroundMode,
): boolean {
  return isSelectionActive(selection, candidate) && mode === "image";
}

/* The Fine-tune sliders (greenscreen-finetune.ts): every row
   drives ONE real pipeline parameter, live — the module header
   there carries the census of what each one honestly moves.
   `modes` gates the backdrop-specific rows (blur radius exists
   only in Blur mode, backdrop dim only behind a photo). Mirrors
   BroadcastStudio's FINE_TUNE_SLIDERS table row for row. */
export const GREENSCREEN_FINE_TUNE_SLIDERS: Array<{
  key: keyof GreenScreenFineTune;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  modes: BackgroundMode[];
  format: (v: number) => string;
}> = [
  {
    key: "sensitivity",
    label: "Cut sensitivity",
    hint: "Up: faint edges stop counting as you. Down: wispy hair and soft edges survive.",
    min: -50,
    max: 50,
    step: 1,
    modes: ["green", "blur", "image"],
    format: (v) => (v > 0 ? `+${v}` : `${v}`),
  },
  {
    key: "edgeShift",
    label: "Edge size",
    hint: "Shrink pulls the cut in — it kills the colour halo. Grow pushes it out — it fills gaps.",
    min: -3,
    max: 3,
    step: 1,
    modes: ["green", "blur", "image"],
    format: (v) => (v > 0 ? `+${v}` : `${v}`),
  },
  {
    key: "softness",
    label: "Edge softness",
    hint: "More softens the rim between you and the background; less makes it crisper.",
    min: -2,
    max: 3,
    step: 1,
    modes: ["green", "blur", "image"],
    format: (v) => (v > 0 ? `+${v}` : `${v}`),
  },
  {
    key: "smoothing",
    label: "Motion smoothing",
    hint: "Up calms edge flicker while you sit still. Down follows fast moves tighter.",
    min: 0,
    max: 100,
    step: 1,
    modes: ["green", "blur", "image"],
    format: (v) => `${v}%`,
  },
  {
    key: "spill",
    label: "Green spill cleanup",
    hint: "Pulls the green fringe off your edges — from the green screen or the room light.",
    min: 0,
    max: 100,
    step: 1,
    modes: ["green", "blur", "image"],
    format: (v) => `${v}%`,
  },
  {
    key: "blur",
    label: "Background blur",
    hint: "How soft the room behind you melts.",
    min: 0,
    max: 40,
    step: 1,
    modes: ["blur"],
    format: (v) => `${v}px`,
  },
  {
    key: "dim",
    label: "Backdrop dim",
    hint: "Darkens the photo behind you so you stand out against it.",
    min: 0,
    max: 85,
    step: 1,
    modes: ["image"],
    format: (v) => `${v}%`,
  },
];

/** The sliders a mode shows — BroadcastStudio's modes gate,
 *  verbatim (Original shows none: there is no cutout to tune). */
export function fineTuneSlidersForMode(mode: BackgroundMode): typeof GREENSCREEN_FINE_TUNE_SLIDERS {
  return GREENSCREEN_FINE_TUNE_SLIDERS.filter((s) => s.modes.includes(mode));
}

export const LIVE_WAVE3_PROMOTIONS = [
  "#92 Behind me in the hall Screen panel: the 2D studio's green-screen depth on the SAME BackgroundChanger kit BroadcastStudio runs — background modes (Green Screen / Blur / Backdrop / Original), quality (Auto / Pro / MediaPipe), the backdrop picker (built-in scenes, your own photo upload, a pasted image link — backdrop-selection's ONE selection), and the fine-tune sliders over greenscreen-finetune's shared device settings (the same bdv-greenscreen-finetune store the 2D studio reads, so a tuned cutout follows the creator between surfaces), with the engine's live status and any fallback spoken plainly. Free, exactly as on the page",
] as const;

/* ── #95 Per-source chroma key — the controller deck ────────────────
   The scene kit's per-source chroma key (scenes.ts cameraMode
   "chroma") was wave III's named follow-on: it rides the stage
   compositor, which has no in-world instance — and still doesn't.
   The honest route is the #89 controller deck driving a running
   studio: the protocol now carries scene.chroma.update { sceneId,
   sourceId, cameraMode, chroma? }; the studio's stage half
   executes it through Stage.updateSource, SourcesPanel's own
   write, and the kit's applyChromaKey does the keying in the
   compositor. The desk renders the Preview scene's camera sources
   from the studio's published cameraSources state and confirms a
   press only on the exact requested mode + settings in the next
   publish — nothing optimistic, no keyer on this side of the
   wire, no in-world compositor faked. */

export type { ChromaSettings };

/** The command a per-source chroma change sends over the controller
 *  relay. The stage validates the args through the protocol's
 *  parseChromaUpdate — the only validator; the desk's readiness
 *  gate below is the same read — so an invalid update applies
 *  nothing there and never confirms here. */
export const SOURCE_CHROMA_UPDATE_COMMAND = "scene.chroma.update" as const;

/** SourcesPanel's camera-mode pills, in the panel's order with the
 *  panel's labels — the selects ARE the menu. */
export const CAMERA_MODE_OPTIONS = [
  { mode: "kit", label: "Studio backdrop" },
  { mode: "chroma", label: "Green screen" },
] as const satisfies ReadonlyArray<{ mode: "kit" | "chroma"; label: string }>;

/** The kit's creation defaults (scenes.ts createSource — the same
 *  fallback stage.ts keys with): what a camera source is born
 *  carrying, and the desk's starting values for a source whose
 *  stored settings are null. */
export const CHROMA_DEFAULTS: ChromaSettings = { color: "#00FF00", similarity: 0.32, smoothness: 0.12 };

/** SourcesPanel's tuning sliders, in the panel's order with the
 *  panel's labels and caps (the panel stores slider ÷ 100, so each
 *  cap here is the stored cap × 100 — the same maxima the protocol
 *  validator enforces). */
export const CHROMA_SLIDERS = [
  { key: "similarity", label: "Similarity", max: 90 },
  { key: "smoothness", label: "Smoothness", max: 60 },
] as const satisfies ReadonlyArray<{ key: "similarity" | "smoothness"; label: string; max: number }>;

/** The settings a source's controls show: its stored settings, or
 *  the kit defaults it will be keyed with when it carries none. */
export function chromaSettingsFor(source: { chroma: ChromaSettings | null }): ChromaSettings {
  return source.chroma ?? CHROMA_DEFAULTS;
}

/** The relay args for one change — parameters only: the ids, the
 *  mode, and (when keying) the key settings. For the "kit" flip
 *  the settings are omitted entirely, exactly the panel's
 *  mode-only patch, so a source's stored settings persist. */
export function chromaUpdateArgs(update: ChromaUpdate): Record<string, unknown> {
  return update.cameraMode === "chroma" && update.chroma
    ? {
        sceneId: update.sceneId,
        sourceId: update.sourceId,
        cameraMode: "chroma",
        chroma: { ...update.chroma },
      }
    : { sceneId: update.sceneId, sourceId: update.sourceId, cameraMode: update.cameraMode };
}

/** The desk's send gate: an update is ready exactly when the
 *  protocol validator accepts the args it builds — one validator,
 *  read by both sides of the wire, so they can never disagree. */
export function isChromaUpdateReady(update: ChromaUpdate): boolean {
  return parseChromaUpdate(chromaUpdateArgs(update)) !== null;
}

/** The section's closing note — SourcesPanel's own explainer for
 *  what green-screen mode does, carried verbatim. */
export const SOURCE_CHROMA_NOTE =
  "Green screen mode keys the raw camera — point it at a green backdrop and tune Similarity until the backdrop disappears, then Smoothness to soften the edge.";

export const LIVE_WAVE4_PROMOTIONS = [
  "#95 Per-source chroma key on the hall's Stream Controller deck: the running studio's Preview-scene camera sources, each with SourcesPanel's mode pills (Studio backdrop / Green screen), key color, and Similarity / Smoothness sliders, relayed as the controller protocol's scene.chroma.update command — the studio executes it through Stage.updateSource, the panel's own write (mode-only patch for the flip, so stored settings persist; settings ride when keying), the kit's applyChromaKey keys the source in the stage compositor, and the deck confirms only on the exact requested mode + settings in the studio's published cameraSources state. No second keyer is built and no in-world compositor is faked. Free, exactly as on the page",
] as const;
