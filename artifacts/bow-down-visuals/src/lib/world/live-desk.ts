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
 * Wave IV (#93) extends the seam once more: the changer follow-ons
 * wave III named — camera effects, noise cancellation / voice
 * effects, camera + mic switching and the mirror — carried into the
 * same studio desk, on the same BackgroundChanger the desk already
 * owns. The menus below ARE the kit's own libraries (CAMERA_EFFECTS
 * / VOICE_EFFECTS), the spoken notes are BroadcastStudio's own
 * words, and every pick drives the kit's own method or rides into
 * its construction config exactly like the page's — never a
 * World-only shadow setting. Free on the page; free here.
 * Wave IV (#94) extends the seam once more: the Go Live scene
 * presets ride the #89 controller relay into the hall. The picker
 * in the section below is the stream-kit preset registry itself,
 * and a pick sends the controller protocol's scene.preset.apply
 * command to the member's running studio, whose stage executes it
 * through applyScenePreset — the ScenesPanel's own application
 * path, landing in Preview, never straight to Program. There is
 * no in-world Stage and none is faked: the deck drives the real
 * studio exactly like the phone remote does. A preset never starts
 * a camera or a share and charges nothing, here as on the page.
 */

import {
  CAMERA_EFFECTS,
  type BackgroundMode, type BackgroundQuality, type BackgroundEngineKind, type EngineStatusDetail,
} from "../stream-kit/background-changer";
import {
  VOICE_EFFECTS, type NoiseCancellationLevel, type VoiceIsolatorStatus,
} from "../stream-kit/voice-isolator";
import type { GreenScreenFineTune } from "../stream-kit/greenscreen-finetune";
import {
  SCENE_PRESETS, scenePresetById, type ScenePreset,
} from "../stream-kit/scene-presets";
import {
  isSelectionActive, type BackdropSelection,
} from "../stream-kit/backdrop-selection";
import { getCreditCost } from "../credit-costs";
import type {
  RequestRulesDto, CatalogSongDto, SongRequestDto,
} from "../song-requests";

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
  "The scene kit's per-source chroma key (scenes.ts cameraMode 'chroma') rides the stage compositor, which has no in-world instance — the in-world route to scenes is the #89 controller deck driving a running 2D studio. #92 carries the camera kit's own green screen (the BackgroundChanger matte), never a second keyer",
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

/* ── #93 Camera & voice — the changer's follow-ons, carried ─────────
   Wave III named these as follow-ons riding "the same
   BackgroundChanger the #92 desk now owns"; this section carries
   them. The desk's Camera & voice card drives the ONE changer the
   studio desk already constructs — its camera-effect library, its
   VoiceIsolator chain (noise cancellation + voice effects), its
   camera/mic switching and its mirror — through the kit's own
   methods, with picks made before the camera starts held in state
   and ridden into the construction config, exactly BroadcastStudio's
   hand. The menus below are the kit's own libraries, not copies:
   the selects ARE the menu, exactly like the background tables
   above. */

/** The camera-effect menu: the kit's CAMERA_EFFECTS library itself
 *  (background-changer.ts) — the same array BroadcastStudio renders
 *  its preset row from. */
export const CAMERA_EFFECT_OPTIONS = CAMERA_EFFECTS;

/** The voice-effect menu: the kit's VOICE_EFFECTS library itself
 *  (voice-isolator.ts) — the same array BroadcastStudio renders its
 *  preset rack from. */
export const VOICE_EFFECT_OPTIONS = VOICE_EFFECTS;

/** BroadcastStudio's noise-cancellation pills, in the page's order
 *  with the page's labels. The page's default is "on": a fresh desk
 *  starts where a fresh studio starts. */
export const NOISE_CANCELLATION_OPTIONS = [
  { level: "off", label: "Off" },
  { level: "on", label: "On" },
  { level: "max", label: "Max" },
] as const satisfies ReadonlyArray<{ level: NoiseCancellationLevel; label: string }>;

export const NOISE_CANCELLATION_DEFAULT: NoiseCancellationLevel = "on";

/** The Camera & voice card's opening line — BroadcastStudio's
 *  initial voice note, verbatim: before the camera runs, the honest
 *  state of the voice chain is that it starts with the camera. */
export const CAMERA_VOICE_OPENING_NOTE = "Noise cancellation starts with the camera.";

/** BroadcastStudio's held-pick note for noise cancellation,
 *  verbatim: with no changer running yet, the pick is held and the
 *  creator is told what it means — off passes the mic through
 *  unchanged; on/max start with the camera. */
export function noiseHeldNote(level: NoiseCancellationLevel): string {
  return level === "off"
    ? "Noise cancellation is off — your mic will pass through unchanged."
    : "Noise cancellation will start with the camera.";
}

/** BroadcastStudio's held-pick note for a voice effect, verbatim:
 *  "none" reads as effects off; any other pick names the effect
 *  that will be on the creator's voice when the camera starts. An
 *  id the kit doesn't carry names nothing — the desk only renders
 *  the kit's own library, so this fallback is unreachable from the
 *  card; it exists so the helper never invents a label. */
export function voiceEffectHeldNote(effectId: string): string {
  if (effectId === "none") return "Voice effects are off.";
  const label = VOICE_EFFECTS.find((e) => e.id === effectId)?.label;
  return label ? `${label} will be on your voice when you start the camera.` : "Voice effects are off.";
}

/** The live noise truth, spoken the kit's way: the VoiceIsolator's
 *  own status message (which carries the ML fallback at Max — the
 *  isolator runs at On and says so), or nothing when the kit has
 *  nothing to say. Never the wanted level dressed up as the live
 *  one. */
export function noiseStatusLine(status: (VoiceIsolatorStatus & { error?: unknown }) | null): string | null {
  return status?.message ? status.message : null;
}

/** Device switching's honest gate: the selects exist only when the
 *  browser exposed the device lists. When enumeration itself is
 *  unavailable the kit's list methods throw UNSUPPORTED — the card
 *  then shows the reason and NO select, never a dead picker over a
 *  capability this browser doesn't have. */
export function deviceSwitchingAvailable(enumerationFailed: boolean): boolean {
  return !enumerationFailed;
}

/* ── Wave IV — Stream Copilot + Live Stage automation ─────────────
   The /go-live Live hub's other half (StreamCopilotSection, with
   LiveStageDesk docked under it), carried into the same Screen
   panel on the panels' own rails verbatim:

   - Stream Copilot: POST /api/stream-copilot/prep { streamTitle,
     topic, platform } and POST /api/stream-copilot/clip-plan
     { recap, topic } — 100 VB each. The credit-costs registry rows
     ARE the price source (derived below, never re-typed); the rail
     charges before the model call and refunds on failure. The desk
     mirrors the page's honesty end to end: the spend goes through
     the standing confirmed door (useConfirmedApi), a 402 /
     out_of_credits answer reads as an honest not-enough-Bucs line,
     and the profile balance refreshes after a settled call. HONEST
     SCOPE (the rail's own words): prep and post-stream only — never
     presented as live assistance.
   - Live Stage automation: GET/PATCH /api/live-prefs (the Stage
     Manager switches, its link rules, and the Auto-Highlights
     switch — free), and per stream: GET /api/live-streams/mine
     (the picker), GET …/:id/stage-manager (muted, the active pin,
     trouble flags), POST …/stage-manager/mute { muted },
     POST …/stage-manager/unpin, GET …/:id/highlights,
     POST …/highlights/:pid/approve | dismiss | refresh, and
     GET …/:id/class-roster for class streams. Approving a cut is
     the ONE charged verb here, at LiveStageDesk's own confirm
     override (200 VB — the approve rail carries no registry row;
     its price is the Streamer Clips rail's per-clip price, charged
     and refunded server-side, and the page states 200 in both its
     confirm override and its button). Nothing posts without the
     creator's yes, and the co-host never acts on a person — flags
     are for the creator's call, exactly as the 2D desk says. */

export const COPILOT_PREP_PATH = "/api/stream-copilot/prep";
export const COPILOT_CLIP_PLAN_PATH = "/api/stream-copilot/clip-plan";
export const LIVE_PREFS_PATH = "/api/live-prefs";
export const MY_STREAMS_PATH = "/api/live-streams/mine";
export const STAGE_MANAGER_PATH = (id: string) => `/api/live-streams/${encodeURIComponent(id)}/stage-manager`;
export const STAGE_MANAGER_MUTE_PATH = (id: string) => `${STAGE_MANAGER_PATH(id)}/mute`;
export const STAGE_MANAGER_UNPIN_PATH = (id: string) => `${STAGE_MANAGER_PATH(id)}/unpin`;
export const HIGHLIGHTS_PATH = (id: string) => `/api/live-streams/${encodeURIComponent(id)}/highlights`;
export const HIGHLIGHT_APPROVE_PATH = (id: string, proposalId: string) =>
  `${HIGHLIGHTS_PATH(id)}/${encodeURIComponent(proposalId)}/approve`;
export const HIGHLIGHT_DISMISS_PATH = (id: string, proposalId: string) =>
  `${HIGHLIGHTS_PATH(id)}/${encodeURIComponent(proposalId)}/dismiss`;
export const HIGHLIGHT_REFRESH_PATH = (id: string, proposalId: string) =>
  `${HIGHLIGHTS_PATH(id)}/${encodeURIComponent(proposalId)}/refresh`;
export const CLASS_ROSTER_PATH = (id: string) => `/api/live-streams/${encodeURIComponent(id)}/class-roster`;

/** The registry is the price source: derived, never re-typed. A
 *  missing row reads −1 so a pin fails loudly instead of a desk
 *  quietly confirming a made-up number (the catalog-desk pattern). */
export const COPILOT_PREP_COST = getCreditCost(COPILOT_PREP_PATH)?.cost ?? -1;
export const COPILOT_PREP_FEATURE = getCreditCost(COPILOT_PREP_PATH)?.feature ?? "";
export const COPILOT_CLIP_PLAN_COST = getCreditCost(COPILOT_CLIP_PLAN_PATH)?.cost ?? -1;
export const COPILOT_CLIP_PLAN_FEATURE = getCreditCost(COPILOT_CLIP_PLAN_PATH)?.feature ?? "";

/** LiveStageDesk's confirm override for approving a highlight cut,
 *  verbatim — number and feature words. */
export const HIGHLIGHT_CUT_COST_VB = 200;
export const HIGHLIGHT_CUT_FEATURE = "Auto-Highlights clip cut";

/** StreamCopilotSection's platform menu, verbatim: the chips ARE
 *  the menu (the prep schema caps platform at 40 chars). */
export const COPILOT_PLATFORMS = ["TikTok", "YouTube", "Twitch", "Instagram"] as const;

/** prepSchema's gates, mirrored for the form: a stream title of
 *  1–200 and a topic of 1–300 trimmed characters. */
export function copilotPrepReady(streamTitle: string, topic: string): boolean {
  const title = streamTitle.trim();
  const t = topic.trim();
  return title.length >= 1 && title.length <= 200 && t.length >= 1 && t.length <= 300;
}

/** clipPlanSchema's gate: a recap of 1–3000 trimmed characters
 *  (the topic line rides along, optional there, capped at 300). */
export function copilotClipPlanReady(recap: string): boolean {
  const r = recap.trim();
  return r.length >= 1 && r.length <= 3000;
}

/** The prep request body, exactly the page's: trimmed fields, the
 *  picked platform verbatim. */
export function buildCopilotPrepBody(input: { streamTitle: string; topic: string; platform: string }): {
  streamTitle: string;
  topic: string;
  platform: string;
} {
  return { streamTitle: input.streamTitle.trim(), topic: input.topic.trim(), platform: input.platform };
}

/** The clip-plan request body, exactly the page's: the trimmed
 *  recap plus the (optional) topic line. */
export function buildCopilotClipPlanBody(input: { recap: string; topic: string }): { recap: string; topic: string } {
  return { recap: input.recap.trim(), topic: input.topic.trim() };
}

export interface CopilotPrepView {
  checklist: string[];
  talkingPoints: string[];
  clipWatchFors: string[];
}

export interface CopilotClipMoment {
  timestampHint: string;
  title: string;
  description: string;
  whyItWorks: string;
}

/** The rail's own parseStringArray, mirrored: strings only,
 *  trimmed, empties dropped, capped per list. */
function cleanCopilotStrings(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, max);
}

export function normalizeCopilotPrep(raw: unknown): CopilotPrepView {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    checklist: cleanCopilotStrings(d["checklist"], 15),
    talkingPoints: cleanCopilotStrings(d["talkingPoints"], 12),
    clipWatchFors: cleanCopilotStrings(d["clipWatchFors"], 10),
  };
}

/** The rail's parseMoment rule, mirrored: a moment needs a title
 *  AND a description to exist; the rest default to empty. */
export function normalizeCopilotMoments(raw: unknown): CopilotClipMoment[] {
  const d = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(d["moments"]) ? d["moments"] : [];
  const out: CopilotClipMoment[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const m = r as Record<string, unknown>;
    const title = typeof m["title"] === "string" ? m["title"].trim() : "";
    const description = typeof m["description"] === "string" ? m["description"].trim() : "";
    if (!title || !description) continue;
    out.push({
      timestampHint: typeof m["timestampHint"] === "string" ? m["timestampHint"] : "",
      title,
      description,
      whyItWorks: typeof m["whyItWorks"] === "string" ? m["whyItWorks"] : "",
    });
  }
  return out.slice(0, 7);
}

/* ── the automation switches (LivePrefs) ────────────────────────── */

export interface LiveLinkRule {
  keyword: string;
  label: string;
  url: string;
}

/** The prefs DTO kept in its wire shape (snake_case, link rules
 *  riding as one list) — the PATCH body is this view verbatim,
 *  exactly like LiveStageDesk holds and saves it. */
export interface LivePrefsView {
  auto_highlights_enabled: boolean;
  stage_manager_enabled: boolean;
  stage_manager_pin_enabled: boolean;
  stage_manager_links_enabled: boolean;
  stage_manager_sting_enabled: boolean;
  stage_manager_flags_enabled: boolean;
  stage_manager_link_rules: LiveLinkRule[];
}

export function normalizeLivePrefs(raw: unknown): LivePrefsView {
  const d = (raw ?? {}) as Record<string, unknown>;
  const rules: LiveLinkRule[] = [];
  if (Array.isArray(d["stage_manager_link_rules"])) {
    for (const r of d["stage_manager_link_rules"]) {
      if (!r || typeof r !== "object") continue;
      const rule = r as Record<string, unknown>;
      if (typeof rule["keyword"] !== "string" || typeof rule["label"] !== "string" || typeof rule["url"] !== "string") continue;
      rules.push({ keyword: rule["keyword"], label: rule["label"], url: rule["url"] });
    }
  }
  return {
    auto_highlights_enabled: d["auto_highlights_enabled"] === true,
    stage_manager_enabled: d["stage_manager_enabled"] === true,
    stage_manager_pin_enabled: d["stage_manager_pin_enabled"] === true,
    stage_manager_links_enabled: d["stage_manager_links_enabled"] === true,
    stage_manager_sting_enabled: d["stage_manager_sting_enabled"] === true,
    stage_manager_flags_enabled: d["stage_manager_flags_enabled"] === true,
    stage_manager_link_rules: rules,
  };
}

/** The prefs PATCH body is the view itself — the rail takes any
 *  subset and LiveStageDesk sends the whole set, so the desk does
 *  the same: what you see switched is what gets saved. */
export function buildLivePrefsPatch(prefs: LivePrefsView): LivePrefsView {
  return { ...prefs, stage_manager_link_rules: prefs.stage_manager_link_rules.map((r) => ({ ...r })) };
}

/** RuleAdder's readiness rule, verbatim: a keyword of 2+ chars, a
 *  label, and a full http(s) link. */
export function linkRuleReady(keyword: string, label: string, url: string): boolean {
  return keyword.trim().length >= 2 && label.trim().length >= 1 && /^https?:\/\//i.test(url.trim());
}

/** RuleAdder's add, verbatim: the keyword is stored lower-cased,
 *  every field trimmed. */
export function buildLinkRule(keyword: string, label: string, url: string): LiveLinkRule {
  return { keyword: keyword.trim().toLowerCase(), label: label.trim(), url: url.trim() };
}

/** LiveStageDesk's adder cap: its form stops offering at 10 rules
 *  (the rail's own ceiling is 25 — the panel's menu is the panel's). */
export const LINK_RULES_UI_MAX = 10;

/* ── the per-stream stage desk ──────────────────────────────────── */

export interface StageStreamRow {
  id: string;
  title: string;
  status: string;
  isClass: boolean;
  ticketPriceVb: number | null;
  classCourseProductId: string | null;
  hasVod: boolean;
}

export function normalizeMyStreams(raw: unknown): StageStreamRow[] {
  const d = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(d["streams"]) ? d["streams"] : [];
  const out: StageStreamRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const s = r as Record<string, unknown>;
    if (typeof s["id"] !== "string") continue;
    out.push({
      id: s["id"],
      title: typeof s["title"] === "string" ? s["title"] : "Live stream",
      status: typeof s["status"] === "string" ? s["status"] : "",
      isClass: s["is_class"] === true,
      ticketPriceVb: typeof s["ticket_price_vb"] === "number" ? s["ticket_price_vb"] : null,
      classCourseProductId: typeof s["class_course_product_id"] === "string" ? s["class_course_product_id"] : null,
      hasVod: s["has_vod"] === true,
    });
  }
  return out;
}

/** LiveStageDesk's picker default, verbatim: the live stream if
 *  there is one, else the newest, else nothing. */
export function initialStageStreamId(streams: StageStreamRow[]): string {
  return streams.find((s) => s.status === "live")?.id ?? streams[0]?.id ?? "";
}

export interface StageStateView {
  muted: boolean;
  stagePinned: { body: string; authorName: string; pinnedUntil: string | null } | null;
  flags: Array<{ at: string; reason: string; messageId: string | null }>;
}

export function normalizeStageState(raw: unknown): StageStateView {
  const d = (raw ?? {}) as Record<string, unknown>;
  const pin = (d["stagePinned"] ?? null) as Record<string, unknown> | null;
  let stagePinned: StageStateView["stagePinned"] = null;
  if (pin && typeof pin === "object") {
    const msg = (pin["message"] ?? {}) as Record<string, unknown>;
    const author = (msg["author"] ?? {}) as Record<string, unknown>;
    stagePinned = {
      body: typeof msg["body"] === "string" ? msg["body"] : "",
      authorName: typeof author["displayName"] === "string" ? author["displayName"] : "",
      pinnedUntil: typeof pin["pinnedUntil"] === "string" ? pin["pinnedUntil"] : null,
    };
  }
  const flags: StageStateView["flags"] = [];
  if (Array.isArray(d["flags"])) {
    for (const f of d["flags"]) {
      if (!f || typeof f !== "object") continue;
      const flag = f as Record<string, unknown>;
      if (typeof flag["at"] !== "string" || typeof flag["reason"] !== "string") continue;
      flags.push({
        at: flag["at"],
        reason: flag["reason"],
        messageId: typeof flag["messageId"] === "string" ? flag["messageId"] : null,
      });
    }
  }
  return { muted: d["muted"] === true, stagePinned, flags };
}

export type HighlightProposalStatus = "proposed" | "approved" | "dismissed" | "posted";

export interface HighlightProposalView {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
  reason: string;
  status: HighlightProposalStatus;
  outputUrl: string | null;
}

export function normalizeHighlightProposals(raw: unknown): HighlightProposalView[] {
  const d = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(d["proposals"]) ? d["proposals"] : [];
  const out: HighlightProposalView[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const p = r as Record<string, unknown>;
    if (typeof p["id"] !== "string") continue;
    const status = p["status"];
    out.push({
      id: p["id"],
      startSec: typeof p["start_sec"] === "number" ? p["start_sec"] : 0,
      endSec: typeof p["end_sec"] === "number" ? p["end_sec"] : 0,
      title: typeof p["title"] === "string" ? p["title"] : "",
      reason: typeof p["reason"] === "string" ? p["reason"] : "",
      status: status === "approved" || status === "dismissed" || status === "posted" ? status : "proposed",
      outputUrl: typeof p["output_url"] === "string" ? p["output_url"] : null,
    });
  }
  return out;
}

export interface ClassRosterRow {
  userId: string;
  displayName: string;
  ticketId: string;
  priceVb: number;
  purchasedAt: string;
}

export function normalizeClassRoster(raw: unknown): ClassRosterRow[] {
  const d = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(d["roster"]) ? d["roster"] : [];
  const out: ClassRosterRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const e = r as Record<string, unknown>;
    if (typeof e["ticket_id"] !== "string") continue;
    out.push({
      userId: typeof e["user_id"] === "string" ? e["user_id"] : "",
      displayName: typeof e["display_name"] === "string" ? e["display_name"] : "Creator",
      ticketId: e["ticket_id"],
      priceVb: typeof e["price_vb"] === "number" ? e["price_vb"] : 0,
      purchasedAt: typeof e["purchased_at"] === "string" ? e["purchased_at"] : "",
    });
  }
  return out;
}

/** LiveStageDesk's proposal clock, verbatim. */
export function highlightClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ── #94 Scene presets on the controller deck ───────────────────────
   The 2D studio's Scene presets list (ScenesPanel over
   lib/stream-kit/scene-presets) had exactly one consumer and no
   in-world surface: there is no Stage in the World, and none is
   built here. The honest route is the one the seam already named
   for scenes — the #89 controller deck driving a running studio.
   The protocol now carries scene.preset.apply { presetId }; the
   studio's stage half executes it through applyScenePreset, the
   panel's own application path, so the scene that lands in the
   studio's Preview is built by the same code from the same
   registry, and Program is never touched. The picker below is the
   registry itself — the grid IS the menu, exactly like the
   background tables above. */

export type { ScenePreset };

/** The preset menu: the stream-kit registry itself (scene-presets.ts)
 *  — the same array ScenesPanel renders its list from. */
export const SCENE_PRESET_OPTIONS = SCENE_PRESETS;

/** The command a preset pick sends over the controller relay. The
 *  stage validates the id against the same registry (an unknown id
 *  applies nothing); the desk only ever renders registry ids. */
export const SCENE_PRESET_APPLY_COMMAND = "scene.preset.apply" as const;

/** The relay args for one pick — the preset id and nothing else:
 *  what a preset MEANS never travels the wire, only which one. */
export function scenePresetApplyArgs(presetId: string): { presetId: string } {
  return { presetId };
}

/** True only for ids the registry carries — the desk's render gate
 *  and the pin's parity check share this one read. */
export function isScenePresetId(presetId: string): boolean {
  return scenePresetById(presetId) !== null;
}

/** The picker's closing note — ScenesPanel's own words for what a
 *  preset does, carried verbatim: the applied scene waits in
 *  Preview for the creator's Take, exactly as on the page. */
export const SCENE_PRESET_PICKER_NOTE =
  "A preset adds a new scene to your studio and frames it in Preview — take it to Program when you're ready. Screen scenes still need you to start the share from the Screen source in the studio.";

export const LIVE_WAVE4_PROMOTIONS = [
  "#93 Camera & voice in the hall Screen panel: the changer follow-ons wave III named, carried on the SAME BackgroundChanger the #92 desk owns — camera-effect presets (the kit's CAMERA_EFFECTS library), noise cancellation (Off / On / Max) and voice-effect presets (the kit's VOICE_EFFECTS library) on its VoiceIsolator chain, camera + microphone switching through the kit's own device methods, and the mirror toggle — picks made before the camera starts held and ridden into the kit's construction config exactly like BroadcastStudio, the isolator's live status (including the Max ML fallback) spoken in the card, and device switching shown unavailable with its reason when this browser exposes no device lists. Free, exactly as on the page",
  "Wave IV Stream Copilot + Live Stage in the hall Screen panel: StreamCopilotSection's prep + clip-plan on its own rails (100 VB each from the credit-costs registry, through the confirmed-spend door, refund-on-failure on the rail) and LiveStageDesk's automation verbatim — /api/live-prefs switches + link rules, the per-stream Stage Manager state (mute, pin, trouble flags), Auto-Highlights proposals whose approve rides the desk's 200 VB confirm override (the rail charges the Streamer Clips price and refunds a failed cut; nothing posts without the creator's yes) and the class roster on /api/live-streams/:id/class-roster",
  "#94 Scene presets on the hall's Stream Controller deck: the Go Live preset registry (lib/stream-kit/scene-presets — Just You, Camera + Live Overlay, Screen + You in the Corner, Screen Only, Starting Soon, Be Right Back, Live as Your Avatar) as a picker under the #89 deck; a pick sends the controller relay's scene.preset.apply command and the running studio's stage executes it through applyScenePreset — the ScenesPanel's own application path (addScene → addSource → updateSource → setPreview), so the built scene lands in Preview with Program untouched, confirmed back to the deck by the studio's next state publish and nothing optimistic. Free, exactly as on the page",
] as const;
/* ── Song Requests (stack100 wave 3, item 17 / B11) ───────────────
   The 2D Song Requests surfaces (components/live/SongRequests.tsx),
   carried into the hall on their exact rails — ONE queue, two
   faces, here and on the website:
   - the fan face (SongRequestPanel on the live-watch page): GET
     /api/live/:id/song-requests (public — rules + catalog + queue),
     POST the same path with a Bearer token { songId, amountVb,
     idempotencyKey } to place a tipped request. Tips are the rail's
     own live-tip money (bounds + the creator's minimum come FROM
     the payload — nothing here invents an amount or a price).
   - the creator face (SongRequestDesk on the go-live page): GET /
     PUT /api/song-request-rules (my rules + my catalog + my current
     live stream id), and while live the queue doors on the same
     queue path — POST …/play-next, POST …/:requestId/skip (decline
     + refund), POST …/close (expire + refund the line).
   In-world the fan face docks into the watch desk (the stream on
   the big screen) and the creator face is its own desk in the same
   members-only Screen panel — the panel's gate is what keeps
   palace guests voiceless here, exactly like the other live desks. */

export const SONG_REQUESTS_PATH = (streamId: string) => `/api/live/${encodeURIComponent(streamId)}/song-requests`;
export const SONG_REQUEST_PLAY_NEXT_PATH = (streamId: string) => `${SONG_REQUESTS_PATH(streamId)}/play-next`;
export const SONG_REQUEST_CLOSE_PATH = (streamId: string) => `${SONG_REQUESTS_PATH(streamId)}/close`;
export const SONG_REQUEST_SKIP_PATH = (streamId: string, requestId: string) =>
  `${SONG_REQUESTS_PATH(streamId)}/${encodeURIComponent(requestId)}/skip`;
export const SONG_REQUEST_RULES_PATH = "/api/song-request-rules";

export interface SongRequestTipBounds {
  minVb: number;
  maxVb: number;
}

export interface SongRequestQueueView {
  streamId: string | null;
  available: boolean;
  rules: RequestRulesDto;
  refundCopy: string;
  tipBounds: SongRequestTipBounds | null;
  catalog: CatalogSongDto[];
  queue: SongRequestDto[];
}

export interface SongRequestRulesView {
  available: boolean;
  rules: RequestRulesDto;
  refundCopy: string;
  tipBounds: SongRequestTipBounds | null;
  catalog: CatalogSongDto[];
  liveStreamId: string | null;
}

/** The server's own defaults (api lib/song-requests.ts
 *  DEFAULT_REQUEST_RULES) — what a payload means when a field is
 *  absent, never an in-world invention. */
const SONG_REQUEST_DEFAULT_RULES: RequestRulesDto = {
  requestsOpen: true,
  catalogOnly: true,
  excludedSongIds: [],
  minTipVb: null,
};

function normalizeSongRequestRules(raw: unknown): RequestRulesDto {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    requestsOpen: typeof r["requestsOpen"] === "boolean" ? r["requestsOpen"] : SONG_REQUEST_DEFAULT_RULES.requestsOpen,
    catalogOnly: typeof r["catalogOnly"] === "boolean" ? r["catalogOnly"] : SONG_REQUEST_DEFAULT_RULES.catalogOnly,
    excludedSongIds: Array.isArray(r["excludedSongIds"])
      ? r["excludedSongIds"].filter((x): x is string => typeof x === "string")
      : [],
    minTipVb: typeof r["minTipVb"] === "number" && Number.isInteger(r["minTipVb"]) ? r["minTipVb"] : null,
  };
}

/** The rail's tip bounds, or null when the payload didn't carry
 *  them — unknown bounds block the tip form (the gate below), they
 *  are never guessed. */
function normalizeSongRequestTipBounds(raw: unknown): SongRequestTipBounds | null {
  const b = (raw ?? {}) as Record<string, unknown>;
  return typeof b["minVb"] === "number" && typeof b["maxVb"] === "number"
    ? { minVb: b["minVb"], maxVb: b["maxVb"] }
    : null;
}

function normalizeSongRequestCatalog(raw: unknown): CatalogSongDto[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: CatalogSongDto[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const s = r as Record<string, unknown>;
    if (typeof s["id"] !== "string" || typeof s["title"] !== "string") continue;
    out.push({
      id: s["id"],
      title: s["title"],
      durationSec: typeof s["durationSec"] === "string" ? s["durationSec"] : null,
      excluded: s["excluded"] === true,
    });
  }
  return out;
}

const SONG_REQUEST_STATUSES = ["queued", "playing", "played", "skipped", "expired"] as const;

function normalizeSongRequestQueue(raw: unknown): SongRequestDto[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: SongRequestDto[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const q = r as Record<string, unknown>;
    if (typeof q["id"] !== "string" || typeof q["songTitle"] !== "string") continue;
    if (typeof q["amountVb"] !== "number" || !Number.isFinite(q["amountVb"])) continue;
    const status = q["status"];
    if (typeof status !== "string" || !(SONG_REQUEST_STATUSES as readonly string[]).includes(status)) continue;
    const fan = (q["fan"] ?? {}) as Record<string, unknown>;
    out.push({
      id: q["id"],
      streamId: typeof q["streamId"] === "string" ? q["streamId"] : "",
      songId: typeof q["songId"] === "string" ? q["songId"] : null,
      songTitle: q["songTitle"],
      amountVb: q["amountVb"],
      status: status as SongRequestDto["status"],
      position: typeof q["position"] === "number" ? q["position"] : null,
      fanUserId: typeof q["fanUserId"] === "string" ? q["fanUserId"] : "",
      fan: {
        displayName: typeof fan["displayName"] === "string" ? fan["displayName"] : "Fan",
        avatarUrl: typeof fan["avatarUrl"] === "string" ? fan["avatarUrl"] : null,
        slug: typeof fan["slug"] === "string" ? fan["slug"] : null,
      },
      refunded: q["refunded"] === true,
      createdAt: typeof q["createdAt"] === "string" ? q["createdAt"] : "",
      playedAt: typeof q["playedAt"] === "string" ? q["playedAt"] : null,
    });
  }
  return out;
}

/** The public queue read (fan face), normalized: the rows the desk
 *  renders ARE the rail's rows — same ids, order, statuses,
 *  positions, amounts and refund flags, so the in-world queue can
 *  never drift from the queue the 2D surfaces show. */
export function normalizeSongRequestQueuePayload(raw: unknown): SongRequestQueueView {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    streamId: typeof d["streamId"] === "string" ? d["streamId"] : null,
    available: d["available"] === true,
    rules: normalizeSongRequestRules(d["rules"]),
    refundCopy: typeof d["refundCopy"] === "string" ? d["refundCopy"] : "",
    tipBounds: normalizeSongRequestTipBounds(d["tipBounds"]),
    catalog: normalizeSongRequestCatalog(d["catalog"]),
    queue: normalizeSongRequestQueue(d["queue"]),
  };
}

/** The creator's rules read (creator face): rules + catalog + the
 *  creator's own live stream id the queue controls dock to. */
export function normalizeSongRequestRulesPayload(raw: unknown): SongRequestRulesView {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    available: d["available"] === true,
    rules: normalizeSongRequestRules(d["rules"]),
    refundCopy: typeof d["refundCopy"] === "string" ? d["refundCopy"] : "",
    tipBounds: normalizeSongRequestTipBounds(d["tipBounds"]),
    catalog: normalizeSongRequestCatalog(d["catalog"]),
    liveStreamId: typeof d["liveStreamId"] === "string" ? d["liveStreamId"] : null,
  };
}

/** The fan submit's body, verbatim (submitSchema): the song pick,
 *  the whole-VB tip, and the intent key that makes a retried tap
 *  the same request instead of a second charge. */
export function songRequestSubmitBody(songId: string, amountVb: number, idempotencyKey: string): {
  songId: string;
  amountVb: number;
  idempotencyKey: string;
} {
  return { songId, amountVb, idempotencyKey };
}

/** The rules save's body, verbatim (rulesSchema): the four rule
 *  fields, nothing else rides along. */
export function songRequestRulesBody(rules: RequestRulesDto): RequestRulesDto {
  return {
    requestsOpen: rules.requestsOpen,
    catalogOnly: rules.catalogOnly,
    excludedSongIds: [...rules.excludedSongIds],
    minTipVb: rules.minTipVb,
  };
}

/** The fan form's tip gate, mirroring the server's own rule: a
 *  whole amount inside the rail's bounds AND at or above the
 *  creator's minimum when they set one. Unknown bounds (a malformed
 *  read) submit nothing. */
export function songRequestTipReady(
  amountRaw: string,
  rules: RequestRulesDto,
  tipBounds: SongRequestTipBounds | null,
): boolean {
  if (!tipBounds) return false;
  const n = Number(amountRaw);
  if (!Number.isInteger(n)) return false;
  if (n < tipBounds.minVb || n > tipBounds.maxVb) return false;
  if (rules.minTipVb !== null && n < rules.minTipVb) return false;
  return true;
}

/** The rules form's minimum-tip box: blank means "no minimum"
 *  (null — exactly what the rail stores); a typed minimum must be
 *  a whole amount inside the rail's bounds (rulesSchema's rule). */
export function songRequestMinTipReady(minTipRaw: string, tipBounds: SongRequestTipBounds | null): boolean {
  const t = minTipRaw.trim();
  if (t === "") return true;
  if (!tipBounds) return false;
  const n = Number(t);
  return Number.isInteger(n) && n >= tipBounds.minVb && n <= tipBounds.maxVb;
}

export function songRequestMinTipValue(minTipRaw: string): number | null {
  const t = minTipRaw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}

/** The catalog songs a fan can actually pick — the server already
 *  flags the creator's exclusions on each row. */
export function songRequestRequestableSongs(view: Pick<SongRequestQueueView, "catalog">): CatalogSongDto[] {
  return view.catalog.filter((s) => !s.excluded);
}

export const LIVE_SONG_REQUESTS_PROMOTION =
  "Song Requests in the hall Screen panel (stack100 item 17): the creator's queue desk — request rules on GET/PUT /api/song-request-rules and, while live, the queue doors (play-next / skip + refund / close + refund the line) — plus the fan request panel docked into the watch desk (up-front rules and refund copy, the live queue, tipped requests with an idempotency key) on GET/POST /api/live/:id/song-requests. One queue, two faces: the 2D SongRequests surfaces' rails verbatim, tips exactly as the rail bounds them";
