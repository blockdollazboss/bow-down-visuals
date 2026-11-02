/**
 * stage-booking.ts — the Throne Hall stage-show booking seam
 * (UPGRADE-PROGRAM 3.1, stack1300).
 *
 * The palace events backbone already runs stage shows end to end on
 * the server: POST /api/world/events books one (Throne Hall only —
 * the hall's room id is the rule's requiredRoomId; Front Row members
 * of the King's court + the house only, refused FRONT_ROW_REQUIRED),
 * the scheduler takes the hall's screen at the hour with the booked
 * content — a catalog video (video:<uuid> / replay:<uuid> from the
 * screen catalog) or "live", the stage opening for the host — and
 * slot end returns the screen to the King's Reel. Until this seam,
 * NO client anywhere sent kind:"stage_show": the palace's headline
 * appointment verb was API-only. This module is the pure client half
 * of the booking form on the Kingdom Board: the screen-catalog fold,
 * the request builder (mirroring the server's window/payload rules
 * so a bad booking is refused HERE before it round-trips), the
 * refusal copy map, and the "mine" normalizer.
 *
 * The rules mirrored from lib/world-events (server truth — this
 * module never widens them): title ≤ 120 chars; content is "live"
 * or one catalog id; a slot is 5 minutes – 4 hours; it may start at
 * most ~5 minutes in the past and at most 30 days ahead; one room,
 * one event at a time (the server answers 409 SLOT_TAKEN).
 *
 * Copy discipline: the seam returns stable error CODES, never
 * sentences — the panel resolves them through the worldStageBooking
 * catalog (all 10 locales). A failed booking whose server answer
 * carries its own message keeps the server's words verbatim (the
 * rails' own copy wins), except the two codes whose refusal IS the
 * booking rule (FRONT_ROW_REQUIRED, SLOT_TAKEN), which the catalog
 * phrases canonically.
 */
import { HALL_ROOM_ID } from "./palace-layout";
import {
  parsePartyStartInput,
  partyStartInputValue,
  toLocalInputValue,
} from "./listening-party";

export { parsePartyStartInput as parseStageStartInput, partyStartInputValue as stageStartInputValue, toLocalInputValue as stageLocalInputValue };

/** The one room a stage show may book — the rule's requiredRoomId. */
export const STAGE_ROOM_ID = HALL_ROOM_ID;

export const STAGE_BOOK_PATH = "/api/world/events";
export const STAGE_MINE_PATH = "/api/world/events/mine";
export const STAGE_SCREEN_CATALOG_PATH = "/api/world/screen-catalog";

export function stageCancelPath(id: string): string {
  return `/api/world/events/${encodeURIComponent(id)}`;
}

/** Duration presets the form offers, in minutes. */
export const STAGE_DURATION_PRESETS_MIN = [30, 60, 90, 120] as const;

const STAGE_MIN_DURATION_MIN = 5;
const STAGE_MAX_DURATION_MIN = 4 * 60;
const STAGE_MAX_AHEAD_MS = 30 * 24 * 3600_000;
/** The server forgives a start up to one min-duration in the past. */
const STAGE_START_GRACE_MS = 5 * 60_000;

const CATALOG_VIDEO_ID = /^(video|replay):[0-9a-f-]{36}$/i;

/* ── The screen catalog fold ────────────────────────────────────── */

/** One pickable screen item, in the catalog's own shape (ids only
 *  ever identify content — the server re-derives the URL when the
 *  show reaches the room). */
export interface StageContentItem {
  /** Catalog id: video:<uuid> or replay:<uuid>. */
  id: string;
  title: string;
  creatorName: string | null;
  durationSec: number;
}

function parseCatalogRow(raw: unknown): StageContentItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r["id"] === "string" ? r["id"] : "";
  if (!CATALOG_VIDEO_ID.test(id)) return null;
  const title = typeof r["title"] === "string" ? r["title"].trim() : "";
  if (!title) return null;
  return {
    id,
    title,
    creatorName: typeof r["creatorName"] === "string" && r["creatorName"] ? r["creatorName"] : null,
    durationSec: typeof r["durationSec"] === "number" && Number.isFinite(r["durationSec"]) ? r["durationSec"] : 0,
  };
}

/** Fold GET /api/world/screen-catalog into the picker's two shelves.
 *  Malformed rows drop out — a row the room couldn't play is never
 *  offered. A wholly malformed answer folds to two empty shelves;
 *  the panel's load state (not this fold) owns the failure word. */
export function parseScreenCatalog(raw: unknown): { mine: StageContentItem[]; pub: StageContentItem[] } {
  const empty = { mine: [] as StageContentItem[], pub: [] as StageContentItem[] };
  if (!raw || typeof raw !== "object") return empty;
  const catalog = (raw as Record<string, unknown>)["catalog"];
  if (!catalog || typeof catalog !== "object") return empty;
  const c = catalog as Record<string, unknown>;
  const fold = (v: unknown): StageContentItem[] =>
    Array.isArray(v) ? v.map(parseCatalogRow).filter((x): x is StageContentItem => x !== null) : [];
  return { mine: fold(c["mine"]), pub: fold(c["public"]) };
}

/* ── The content choice ─────────────────────────────────────────── */

/** What plays on the hall's screen: the host's own live stage, or
 *  one catalog video/replay. */
export type StageContentChoice =
  | { type: "live" }
  | { type: "catalog"; item: StageContentItem };

/** The payload ref the backbone runs: "live", or the catalog id. */
export function stageContentRef(choice: StageContentChoice): string {
  return choice.type === "live" ? "live" : choice.item.id;
}

/* ── The request builder ────────────────────────────────────────── */

/** Every way the form can refuse a draft before it round-trips —
 *  a code, resolved to words by the panel's catalog. */
export type StageDraftError =
  | "titleRequired"
  | "titleTooLong"
  | "contentInvalid"
  | "durationTooShort"
  | "durationTooLong"
  | "startRequired"
  | "startPast"
  | "startTooFar";

export interface StageShowDraft {
  title: string;
  startsAtMs: number;
  durationMin: number;
  content: StageContentChoice;
}

export interface StageShowBody {
  kind: "stage_show";
  roomId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  payload: { contentRef: string };
}

export type StageBuildResult =
  | { ok: true; body: StageShowBody }
  | { ok: false; error: StageDraftError };

/** Validate a draft against the server's booking rules and shape
 *  the POST body. `nowMs` is injected so the window math is pure. */
export function buildStageShowBody(draft: StageShowDraft, nowMs: number): StageBuildResult {
  const title = draft.title.trim();
  if (!title) return { ok: false, error: "titleRequired" };
  if (title.length > 120) return { ok: false, error: "titleTooLong" };
  const contentRef = stageContentRef(draft.content);
  if (contentRef !== "live" && !CATALOG_VIDEO_ID.test(contentRef)) {
    return { ok: false, error: "contentInvalid" };
  }
  if (!Number.isFinite(draft.durationMin) || draft.durationMin < STAGE_MIN_DURATION_MIN) {
    return { ok: false, error: "durationTooShort" };
  }
  if (draft.durationMin > STAGE_MAX_DURATION_MIN) {
    return { ok: false, error: "durationTooLong" };
  }
  if (!Number.isFinite(draft.startsAtMs)) {
    return { ok: false, error: "startRequired" };
  }
  if (draft.startsAtMs < nowMs - STAGE_START_GRACE_MS) {
    return { ok: false, error: "startPast" };
  }
  if (draft.startsAtMs > nowMs + STAGE_MAX_AHEAD_MS) {
    return { ok: false, error: "startTooFar" };
  }
  const startsAt = new Date(draft.startsAtMs);
  const endsAt = new Date(draft.startsAtMs + draft.durationMin * 60_000);
  return {
    ok: true,
    body: {
      kind: "stage_show",
      roomId: STAGE_ROOM_ID,
      title,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      payload: { contentRef },
    },
  };
}

/* ── Server answers, in the panel's words ───────────────────────── */

/** A failed booking resolved to words: either the server's own
 *  message verbatim (the rails' copy wins), or a catalog key the
 *  panel translates. The booking-rule refusals resolve to keys —
 *  FRONT_ROW_REQUIRED is the gate this whole form exists behind. */
export type StageServerError =
  | { kind: "message"; message: string }
  | { kind: "key"; key: StageServerErrorKey };

export type StageServerErrorKey =
  | "refusedFrontRow"
  | "slotTaken"
  | "signIn"
  | "notBookable"
  | "failed";

export function stageBookingError(status: number, payload: unknown): StageServerError {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const code = typeof p["error"] === "string" ? p["error"] : "";
  const message = typeof p["message"] === "string" ? p["message"] : "";
  switch (code) {
    case "FRONT_ROW_REQUIRED":
      /* The refusal that proves the gate: a member who holds no
       * Front Row seat (and isn't the house) cannot book the stage.
       * The words are the catalog's canonical phrasing of the rule. */
      return { kind: "key", key: "refusedFrontRow" };
    case "SLOT_TAKEN":
      return { kind: "key", key: "slotTaken" };
    case "ROOM_MISMATCH":
    case "UNKNOWN_ROOM":
      /* The form only ever sends the Throne Hall — a mismatch answer
       * means the rail moved; say so plainly, no invented reason. */
      return { kind: "key", key: "notBookable" };
    default:
      break;
  }
  if (message) return { kind: "message", message };
  if (status === 401) return { kind: "key", key: "signIn" };
  if (status === 403) return { kind: "key", key: "notBookable" };
  return { kind: "key", key: "failed" };
}

/* ── "Mine": the host's own stage bookings ──────────────────────── */

export interface MyShow {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "live";
  /** "live", or the catalog id on the screen. */
  contentRef: string;
}

/** Normalize GET /api/world/events/mine into the member's upcoming
 *  stage shows: this room, this kind, still on the calendar
 *  (scheduled or live, not yet ended), soonest first. Anything else
 *  the endpoint returns (parties, drops, finished shows) is not
 *  this list's business. */
export function normalizeMyShows(raw: unknown, nowMs: number): MyShow[] {
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as { events?: unknown }).events)
      ? ((raw as { events: unknown[] }).events as unknown[])
      : Array.isArray(raw)
        ? (raw as unknown[])
        : [];
  const out: MyShow[] = [];
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (r["kind"] !== "stage_show" || r["roomId"] !== STAGE_ROOM_ID) continue;
    if (r["status"] !== "scheduled" && r["status"] !== "live") continue;
    const id = typeof r["id"] === "string" ? r["id"] : "";
    const title = typeof r["title"] === "string" ? r["title"] : "";
    const startsAt = typeof r["startsAt"] === "string" ? r["startsAt"] : "";
    const endsAt = typeof r["endsAt"] === "string" ? r["endsAt"] : "";
    if (!id || !title || !startsAt || !endsAt) continue;
    if (!(Date.parse(endsAt) > nowMs)) continue;
    const payload = r["payload"] && typeof r["payload"] === "object" ? (r["payload"] as Record<string, unknown>) : {};
    const contentRef = typeof payload["contentRef"] === "string" ? payload["contentRef"] : "";
    out.push({
      id,
      title,
      startsAt,
      endsAt,
      status: r["status"] as "scheduled" | "live",
      contentRef,
    });
  }
  return out.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
