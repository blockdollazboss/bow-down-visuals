/**
 * listening-party — the Music Hall booking seam (World Events 3.2).
 *
 * The palace events backbone already runs listening parties end to
 * end on the server: POST /api/world/events books one (any member,
 * Music Hall only, the queue is catalog track ids in order), the
 * scheduler takes the jukebox with the queue at the hour under the
 * host's name, and slot end returns open queueing. This module is
 * the pure client half of the booking form in the Music Hall panel:
 * the queue fold, the request builder (mirroring the server's
 * window/payload rules so a bad booking is refused HERE with the
 * same words, not after a round trip), the error copy, the "mine"
 * normalizer, and the playlist fold onto the site's playlist rails.
 *
 * The rules mirrored from lib/world-events (server truth — this
 * module never widens them): title ≤ 120 chars; queue 1–20 catalog
 * track ids (track:<uuid>); a slot is 5 minutes – 4 hours; it may
 * start at most ~5 minutes in the past and at most 30 days ahead;
 * one room, one event at a time (the server answers 409 SLOT_TAKEN).
 */
import { MUSIC_HALL_ID } from "./palace-layout";
import type { StreamPlaylist } from "@/lib/streaming";

export const LISTENING_PARTY_ROOM_ID = MUSIC_HALL_ID;

/** The server caps a party queue at 20 tracks. */
export const PARTY_QUEUE_MAX = 20;

/** Duration presets the form offers, in minutes. */
export const PARTY_DURATION_PRESETS_MIN = [30, 60, 90, 120] as const;

export const PARTY_MIN_DURATION_MIN = 5;
export const PARTY_MAX_DURATION_MIN = 4 * 60;
export const PARTY_MAX_AHEAD_MS = 30 * 24 * 3600_000;
/** The server forgives a start up to one min-duration in the past. */
export const PARTY_START_GRACE_MS = 5 * 60_000;

const CATALOG_TRACK_ID = /^track:[0-9a-f-]{36}$/i;
const BARE_TRACK_UUID = /^[0-9a-f-]{36}$/i;

/** One pickable song, in the jukebox catalog's own shape. */
export interface PartyQueueItem {
  /** Catalog id: track:<uuid>. */
  id: string;
  title: string;
  creatorName: string | null;
  durationSec: number;
}

/* ── The queue fold ─────────────────────────────────────────────── */

export type ToggleResult =
  | { queue: PartyQueueItem[]; outcome: "added" | "removed" }
  | { queue: PartyQueueItem[]; outcome: "full" };

/** Tap-to-pick: a song in the queue comes out; a new one appends in
 *  tap order (the party plays the queue in order). The 20 cap is
 *  judged here so the form can say so before the server has to. */
export function togglePartyQueueItem(queue: PartyQueueItem[], item: PartyQueueItem): ToggleResult {
  if (queue.some((q) => q.id === item.id)) {
    return { queue: queue.filter((q) => q.id !== item.id), outcome: "removed" };
  }
  if (queue.length >= PARTY_QUEUE_MAX) return { queue, outcome: "full" };
  return { queue: [...queue, item], outcome: "added" };
}

/** Move one queued song a step earlier (-1) or later (+1). Out-of-
 *  range moves are honest no-ops returning the same list. */
export function movePartyQueueItem(queue: PartyQueueItem[], index: number, dir: -1 | 1): PartyQueueItem[] {
  const target = index + dir;
  if (index < 0 || index >= queue.length || target < 0 || target >= queue.length) return queue;
  const next = [...queue];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}

/* ── The request builder ────────────────────────────────────────── */

export interface ListeningPartyDraft {
  title: string;
  startsAtMs: number;
  durationMin: number;
  queue: PartyQueueItem[];
  playlistId?: string | null;
}

export interface ListeningPartyBody {
  kind: "listening_party";
  roomId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  payload: { trackIds: string[]; playlistId: string | null };
}

export type BuildResult = { ok: true; body: ListeningPartyBody } | { ok: false; error: string };

/** Validate a draft against the server's booking rules and shape
 *  the POST body. `nowMs` is injected so the window math is pure. */
export function buildListeningPartyBody(draft: ListeningPartyDraft, nowMs: number): BuildResult {
  const title = draft.title.trim();
  if (!title) return { ok: false, error: "Give the party a name first." };
  if (title.length > 120) return { ok: false, error: "That name is too long — 120 characters at most." };
  if (draft.queue.length === 0) {
    return { ok: false, error: "Pick at least one song — a party needs a queue." };
  }
  if (draft.queue.length > PARTY_QUEUE_MAX) {
    return { ok: false, error: `A party queue holds at most ${PARTY_QUEUE_MAX} songs.` };
  }
  if (draft.queue.some((q) => !CATALOG_TRACK_ID.test(q.id))) {
    return { ok: false, error: "One of those songs isn't a catalog track the jukebox can play." };
  }
  if (draft.durationMin < PARTY_MIN_DURATION_MIN) {
    return { ok: false, error: "A party slot is at least 5 minutes." };
  }
  if (draft.durationMin > PARTY_MAX_DURATION_MIN) {
    return { ok: false, error: "A party slot is at most 4 hours." };
  }
  if (!Number.isFinite(draft.startsAtMs)) {
    return { ok: false, error: "Pick a start time for the party." };
  }
  if (draft.startsAtMs < nowMs - PARTY_START_GRACE_MS) {
    return { ok: false, error: "That start time is already past." };
  }
  if (draft.startsAtMs > nowMs + PARTY_MAX_AHEAD_MS) {
    return { ok: false, error: "Parties can be booked at most 30 days ahead." };
  }
  const startsAt = new Date(draft.startsAtMs);
  const endsAt = new Date(draft.startsAtMs + draft.durationMin * 60_000);
  return {
    ok: true,
    body: {
      kind: "listening_party",
      roomId: LISTENING_PARTY_ROOM_ID,
      title,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      payload: {
        trackIds: draft.queue.map((q) => q.id),
        playlistId: draft.playlistId?.trim() ? draft.playlistId.trim() : null,
      },
    },
  };
}

/* ── Server answers, in the panel's words ───────────────────────── */

/** Map a failed booking response to the words the form shows. The
 *  server's own message wins when it sent one (it names the rule);
 *  the known codes get the form's plainer phrasing first. */
export function listeningPartyErrorCopy(status: number, payload: unknown): string {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const code = typeof p["error"] === "string" ? p["error"] : "";
  const message = typeof p["message"] === "string" ? p["message"] : "";
  switch (code) {
    case "SLOT_TAKEN":
      return "The Music Hall is already booked at that time — pick another hour.";
    case "INVALID_WINDOW":
      return message || "That time doesn't work — a slot is 5 minutes to 4 hours, up to 30 days ahead.";
    case "INVALID_PAYLOAD":
      return message || "That queue can't play — every song must be a published catalog track.";
    case "ROOM_MISMATCH":
      return "Listening parties live in the Music Hall.";
    default:
      break;
  }
  if (status === 401 || status === 403) return "Sign in as a member to book the Music Hall.";
  if (message) return message;
  return "The booking didn't land — nothing was scheduled. Try again.";
}

/* ── "Mine": the host's own bookings ────────────────────────────── */

export interface MyParty {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "live";
  trackCount: number;
}

/** Normalize GET /api/world/events/mine into the member's upcoming
 *  listening parties: this room, this kind, still on the calendar
 *  (scheduled or live, not yet ended), soonest first. Anything else
 *  the endpoint returns (stage shows, drops, finished parties) is
 *  not this list's business. */
export function normalizeMyParties(raw: unknown, nowMs: number): MyParty[] {
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as { events?: unknown }).events)
      ? ((raw as { events: unknown[] }).events as unknown[])
      : Array.isArray(raw)
        ? (raw as unknown[])
        : [];
  const out: MyParty[] = [];
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (r["kind"] !== "listening_party" || r["roomId"] !== LISTENING_PARTY_ROOM_ID) continue;
    if (r["status"] !== "scheduled" && r["status"] !== "live") continue;
    const id = typeof r["id"] === "string" ? r["id"] : "";
    const title = typeof r["title"] === "string" ? r["title"] : "";
    const startsAt = typeof r["startsAt"] === "string" ? r["startsAt"] : "";
    const endsAt = typeof r["endsAt"] === "string" ? r["endsAt"] : "";
    if (!id || !title || !startsAt || !endsAt) continue;
    if (!(Date.parse(endsAt) > nowMs)) continue;
    const payload = r["payload"] && typeof r["payload"] === "object" ? (r["payload"] as Record<string, unknown>) : {};
    const trackIds = Array.isArray(payload["trackIds"]) ? payload["trackIds"] : [];
    out.push({
      id,
      title,
      startsAt,
      endsAt,
      status: r["status"] as "scheduled" | "live",
      trackCount: trackIds.length,
    });
  }
  return out.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/* ── The playlist fold ──────────────────────────────────────────── */

/** Fold one of the member's site playlists into a party queue, in
 *  playlist order: only resolved TRACK items can ride the jukebox
 *  (a video has no place in a listening queue), each becoming its
 *  catalog id. `skipped` counts everything that didn't carry —
 *  videos, unresolvable items, duplicates, and anything past the
 *  20 cap — so the form can say honestly what made it in. */
export function playlistQueueFold(playlist: StreamPlaylist): { items: PartyQueueItem[]; skipped: number } {
  const items: PartyQueueItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const entry of playlist.resolved_items ?? []) {
    if (entry.kind !== "track") {
      skipped++;
      continue;
    }
    const t = entry.item;
    const bare = String(t.id ?? "");
    if (!BARE_TRACK_UUID.test(bare) || seen.has(bare) || t.is_published === false) {
      skipped++;
      continue;
    }
    if (items.length >= PARTY_QUEUE_MAX) {
      skipped++;
      continue;
    }
    seen.add(bare);
    items.push({
      id: `track:${bare}`,
      title: t.title,
      creatorName: null,
      durationSec: typeof t.duration_sec === "number" ? t.duration_sec : 0,
    });
  }
  return { items, skipped };
}

/* ── The start-time input ───────────────────────────────────────── */

/** The form's default start: the next full hour from `nowMs`,
 *  as a datetime-local value (local wall clock, minute precision). */
export function partyStartInputValue(nowMs: number): string {
  const d = new Date(nowMs);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInputValue(d.getTime());
}

/** Format an instant as a datetime-local value in local time. */
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse a datetime-local value back to an instant (local time).
 *  An empty or malformed value reads null — the form's problem to
 *  name, never a silent NaN downstream. */
export function parsePartyStartInput(value: string): number | null {
  if (!value.trim()) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
