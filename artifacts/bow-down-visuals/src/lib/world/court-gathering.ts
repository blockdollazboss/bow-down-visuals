/**
 * court-gathering.ts — the Royal Court gathering seam
 * (UPGRADE-PROGRAM 3.6, stack1300).
 *
 * The palace events backbone runs court gatherings end to end on
 * the server: POST /api/world/events books one (Royal Court Chamber
 * only — the chamber's room id is the rule's requiredRoomId; the
 * HOUSE only, refused ADMIN_REQUIRED — the drop precedent), and at
 * the hour the scheduler heralds the court palace-wide with the
 * Front Row presented from the King's court seats, read at fire
 * time. Until this seam, NO client anywhere sent
 * kind:"royal_court": the Chamber was furnished (the Front Row
 * Gallery, the Season Marks Wall, the Crowns stand, the Winners'
 * Circle) but no gathering could be called from inside the World.
 * This module is the pure client half of the gathering door in the
 * Front Row Gallery's panel: the Chamber slate fold, the request
 * builder (mirroring the server's window/payload rules so a bad
 * booking is refused HERE before it round-trips), the refusal copy
 * map, and the "mine" normalizer.
 *
 * The rules mirrored from lib/world-events (server truth — this
 * module never widens them): title ≤ 120 chars; the payload is an
 * optional occasion line, trimmed and capped to 140 (the office-
 * hours agenda's shape); a slot is 5 minutes – 4 hours; it may
 * start at most ~5 minutes in the past and at most 30 days ahead;
 * one room, one event at a time (the server answers 409
 * SLOT_TAKEN). Who is honored is never payload and never a client
 * claim — the presentation is the server's fire-time read.
 *
 * Copy discipline matches stage-booking.ts: the seam returns stable
 * error CODES, never sentences — the panel resolves them through
 * the worldCourtGathering catalog (all 10 locales). A failed
 * booking whose server answer carries its own message keeps the
 * server's words verbatim (the rails' own copy wins), except the
 * two codes whose refusal IS the booking rule (ADMIN_REQUIRED,
 * SLOT_TAKEN), which the catalog phrases canonically.
 */
import { ROYAL_COURT_ID } from "./palace-layout";
import {
  parsePartyStartInput,
  partyStartInputValue,
  toLocalInputValue,
} from "./listening-party";

export { parsePartyStartInput as parseCourtStartInput, partyStartInputValue as courtStartInputValue, toLocalInputValue as courtLocalInputValue };

/** The one room a court gathering may book — the rule's requiredRoomId. */
export const COURT_ROOM_ID = ROYAL_COURT_ID;

export const COURT_BOOK_PATH = "/api/world/events";
export const COURT_SLATE_PATH = "/api/world/events";
export const COURT_MINE_PATH = "/api/world/events/mine";

export function courtCancelPath(id: string): string {
  return `/api/world/events/${encodeURIComponent(id)}`;
}

/** Duration presets the form offers, in minutes. */
export const COURT_DURATION_PRESETS_MIN = [30, 60, 90, 120] as const;

/** The occasion line's cap — the server's own (office-hours shape). */
export const COURT_NOTE_MAX_CHARS = 140;

const COURT_MIN_DURATION_MIN = 5;
const COURT_MAX_DURATION_MIN = 4 * 60;
const COURT_MAX_AHEAD_MS = 30 * 24 * 3600_000;
/** The server forgives a start up to one min-duration in the past. */
const COURT_START_GRACE_MS = 5 * 60_000;

/* ── The request builder ────────────────────────────────────────── */

/** Every way the form can refuse a draft before it round-trips —
 *  a code, resolved to words by the panel's catalog. */
export type CourtDraftError =
  | "titleRequired"
  | "titleTooLong"
  | "durationTooShort"
  | "durationTooLong"
  | "startRequired"
  | "startPast"
  | "startTooFar";

export interface CourtGatheringDraft {
  title: string;
  /** The optional occasion line (the gathering's stated purpose). */
  note: string;
  startsAtMs: number;
  durationMin: number;
}

export interface CourtGatheringBody {
  kind: "royal_court";
  roomId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  payload: { note?: string };
}

export type CourtBuildResult =
  | { ok: true; body: CourtGatheringBody }
  | { ok: false; error: CourtDraftError };

/** Validate a draft against the server's booking rules and shape
 *  the POST body. `nowMs` is injected so the window math is pure. */
export function buildCourtGatheringBody(draft: CourtGatheringDraft, nowMs: number): CourtBuildResult {
  const title = draft.title.trim();
  if (!title) return { ok: false, error: "titleRequired" };
  if (title.length > 120) return { ok: false, error: "titleTooLong" };
  if (!Number.isFinite(draft.durationMin) || draft.durationMin < COURT_MIN_DURATION_MIN) {
    return { ok: false, error: "durationTooShort" };
  }
  if (draft.durationMin > COURT_MAX_DURATION_MIN) {
    return { ok: false, error: "durationTooLong" };
  }
  if (!Number.isFinite(draft.startsAtMs)) {
    return { ok: false, error: "startRequired" };
  }
  if (draft.startsAtMs < nowMs - COURT_START_GRACE_MS) {
    return { ok: false, error: "startPast" };
  }
  if (draft.startsAtMs > nowMs + COURT_MAX_AHEAD_MS) {
    return { ok: false, error: "startTooFar" };
  }
  /* The occasion line rides exactly as the server sanitizes it:
   * trimmed, capped to a line, omitted when empty. */
  const note = draft.note.trim().slice(0, COURT_NOTE_MAX_CHARS);
  const startsAt = new Date(draft.startsAtMs);
  const endsAt = new Date(draft.startsAtMs + draft.durationMin * 60_000);
  return {
    ok: true,
    body: {
      kind: "royal_court",
      roomId: COURT_ROOM_ID,
      title,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      payload: note ? { note } : {},
    },
  };
}

/* ── Server answers, in the panel's words ───────────────────────── */

/** A failed booking resolved to words: either the server's own
 *  message verbatim (the rails' copy wins), or a catalog key the
 *  panel translates. The booking-rule refusals resolve to keys —
 *  ADMIN_REQUIRED is the gate this whole form exists behind. */
export type CourtServerError =
  | { kind: "message"; message: string }
  | { kind: "key"; key: CourtServerErrorKey };

export type CourtServerErrorKey =
  | "refusedHouse"
  | "slotTaken"
  | "signIn"
  | "notBookable"
  | "failed";

export function courtGatheringError(status: number, payload: unknown): CourtServerError {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const code = typeof p["error"] === "string" ? p["error"] : "";
  const message = typeof p["message"] === "string" ? p["message"] : "";
  switch (code) {
    case "ADMIN_REQUIRED":
      /* The refusal that proves the gate: court gatherings are
       * called by the house. The words are the catalog's canonical
       * phrasing of the rule. */
      return { kind: "key", key: "refusedHouse" };
    case "SLOT_TAKEN":
      return { kind: "key", key: "slotTaken" };
    case "ROOM_MISMATCH":
    case "UNKNOWN_ROOM":
      /* The form only ever sends the Chamber — a mismatch answer
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

/* ── The Chamber slate: gatherings on the calendar ──────────────── */

export interface ChamberGathering {
  id: string;
  title: string;
  hostName: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "live";
  /** The occasion line, when the booking carries one. */
  note: string | null;
}

function parseGatheringRow(raw: unknown): ChamberGathering | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r["kind"] !== "royal_court" || r["roomId"] !== COURT_ROOM_ID) return null;
  if (r["status"] !== "scheduled" && r["status"] !== "live") return null;
  const id = typeof r["id"] === "string" ? r["id"] : "";
  const title = typeof r["title"] === "string" ? r["title"] : "";
  const startsAt = typeof r["startsAt"] === "string" ? r["startsAt"] : "";
  const endsAt = typeof r["endsAt"] === "string" ? r["endsAt"] : "";
  if (!id || !title || !startsAt || !endsAt) return null;
  const payload = r["payload"] && typeof r["payload"] === "object" ? (r["payload"] as Record<string, unknown>) : {};
  return {
    id,
    title,
    hostName: typeof r["hostName"] === "string" && r["hostName"] ? r["hostName"] : "Creator",
    startsAt,
    endsAt,
    status: r["status"],
    note: typeof payload["note"] === "string" && payload["note"] ? payload["note"] : null,
  };
}

/** Fold the public slate (GET /api/world/events) into the
 *  Chamber's gatherings: this room, this kind, still on the
 *  calendar (scheduled or live, not yet ended), soonest first.
 *  STRICT in the drop-bench idiom: a malformed answer returns
 *  null = a FAILED read, never a painted-empty list — the panel's
 *  failure state and its empty state stay separate sentences. */
export function parseChamberGatherings(raw: unknown, nowMs: number): ChamberGathering[] | null {
  if (!raw || typeof raw !== "object") return null;
  const events = (raw as Record<string, unknown>)["events"];
  if (!Array.isArray(events)) return null;
  return events
    .map(parseGatheringRow)
    .filter((g): g is ChamberGathering => g !== null)
    .filter((g) => Date.parse(g.endsAt) > nowMs)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/* ── "Mine": the caller's own court gatherings ──────────────────── */

export interface MyGathering {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "live";
  note: string | null;
}

/** Normalize GET /api/world/events/mine into the caller's upcoming
 *  court gatherings: this room, this kind, still on the calendar
 *  (scheduled or live, not yet ended), soonest first. Anything else
 *  the endpoint returns (shows, parties, drops, finished rows) is
 *  not this list's business. */
export function normalizeMyGatherings(raw: unknown, nowMs: number): MyGathering[] {
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as { events?: unknown }).events)
      ? ((raw as { events: unknown[] }).events as unknown[])
      : Array.isArray(raw)
        ? (raw as unknown[])
        : [];
  const out: MyGathering[] = [];
  for (const e of list) {
    const g = parseGatheringRow(e);
    if (!g) continue;
    if (!(Date.parse(g.endsAt) > nowMs)) continue;
    out.push({
      id: g.id,
      title: g.title,
      startsAt: g.startsAt,
      endsAt: g.endsAt,
      status: g.status,
      note: g.note,
    });
  }
  return out.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
