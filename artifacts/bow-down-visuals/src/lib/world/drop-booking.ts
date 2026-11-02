/**
 * drop-booking.ts — the admin drop-spectacle booking seam
 * (UPGRADE-PROGRAM 3.4's booking half, stack1300).
 *
 * A drop spectacle is a house moment: POST /api/world/events books
 * one into any palace room, ADMIN ONLY (the route refuses
 * ADMIN_REQUIRED), and its Visual Bucs come out of the shared
 * weekly drop budget (≤1,000 VB/week across every drop rail — no
 * new issuance). At the hour the spectacle lands in its room,
 * heralded, first-come claims where it fell. The backbone has run
 * since migration 0145; until this seam the booking was API-only —
 * no surface anywhere could schedule one.
 *
 * This module is the pure client half of the /admin bench: the
 * room fold (the palace's own layout — the same 14 rooms the
 * route's PALACE_ROOM_DEFS names), the request builder mirroring
 * the server's sanitize + window rules, the refusal map, and the
 * strict slate parser for the bench's upcoming list. Strict in the
 * admin-bench idiom: a malformed slate answer is a FAILED read
 * (null), never a painted-empty list.
 *
 * The rules mirrored from lib/world-events (server truth — this
 * module never widens them): title ≤ 120 chars; amountVb an integer
 * 100–1,000 per claim ("A drop pays between 100 and 1000 Visual
 * Bucs per claim." — the rail's own words); claimCap an integer
 * 1–30; a slot is 5 minutes – 4 hours, at most ~5 minutes in the
 * past, at most 30 days ahead; one room, one event at a time.
 *
 * Copy discipline matches stage-booking.ts: stable error codes,
 * resolved through the admin.worldDrops catalog; the server's own
 * message wins verbatim when it arrives, except the booking-rule
 * refusal (ADMIN_REQUIRED) and SLOT_TAKEN, which the catalog
 * phrases canonically.
 */
import { PALACE_LAYOUT } from "./palace-layout";
import {
  parsePartyStartInput,
  partyStartInputValue,
  toLocalInputValue,
} from "./listening-party";

export { parsePartyStartInput as parseDropStartInput, partyStartInputValue as dropStartInputValue, toLocalInputValue as dropLocalInputValue };

export const DROP_BOOK_PATH = "/api/world/events";
export const DROP_SLATE_PATH = "/api/world/events";

export function dropCancelPath(id: string): string {
  return `/api/world/events/${encodeURIComponent(id)}`;
}

/** The rail's own numbers: per-claim amount bounds and the shared
 *  weekly envelope the spectacle's Bucs come out of. */
export const DROP_MIN_AMOUNT_VB = 100;
export const DROP_MAX_AMOUNT_VB = 1000;
export const DROP_WEEKLY_BUDGET_VB = 1000;
export const DROP_MIN_CLAIMS = 1;
export const DROP_MAX_CLAIMS = 30;

/** Duration presets the form offers, in minutes. */
export const DROP_DURATION_PRESETS_MIN = [30, 60, 90, 120] as const;

const DROP_MIN_DURATION_MIN = 5;
const DROP_MAX_DURATION_MIN = 4 * 60;
const DROP_MAX_AHEAD_MS = 30 * 24 * 3600_000;
const DROP_START_GRACE_MS = 5 * 60_000;

/* ── The room fold ──────────────────────────────────────────────── */

export interface DropRoom {
  id: string;
  name: string;
}

/** Every palace room a spectacle may land in — the layout's own
 *  rooms, which are exactly the route's PALACE_ROOM_DEFS set. */
export function dropRooms(): DropRoom[] {
  return Object.values(PALACE_LAYOUT).map((r) => ({ id: r.id, name: r.name }));
}

export function isDropRoomId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(PALACE_LAYOUT, id);
}

/* ── The request builder ────────────────────────────────────────── */

export type DropDraftError =
  | "titleRequired"
  | "titleTooLong"
  | "roomUnknown"
  | "amountRange"
  | "claimRange"
  | "durationTooShort"
  | "durationTooLong"
  | "startRequired"
  | "startPast"
  | "startTooFar";

export interface DropDraft {
  title: string;
  roomId: string;
  startsAtMs: number;
  durationMin: number;
  amountVb: number;
  claimCap: number;
}

export interface DropBody {
  kind: "drop";
  roomId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  payload: { amountVb: number; claimCap: number };
}

export type DropBuildResult =
  | { ok: true; body: DropBody }
  | { ok: false; error: DropDraftError };

/** Validate a draft against the server's booking rules and shape
 *  the POST body. `nowMs` is injected so the window math is pure. */
export function buildDropBody(draft: DropDraft, nowMs: number): DropBuildResult {
  const title = draft.title.trim();
  if (!title) return { ok: false, error: "titleRequired" };
  if (title.length > 120) return { ok: false, error: "titleTooLong" };
  if (!isDropRoomId(draft.roomId)) return { ok: false, error: "roomUnknown" };
  if (
    !Number.isInteger(draft.amountVb) ||
    draft.amountVb < DROP_MIN_AMOUNT_VB ||
    draft.amountVb > DROP_MAX_AMOUNT_VB
  ) {
    return { ok: false, error: "amountRange" };
  }
  if (
    !Number.isInteger(draft.claimCap) ||
    draft.claimCap < DROP_MIN_CLAIMS ||
    draft.claimCap > DROP_MAX_CLAIMS
  ) {
    return { ok: false, error: "claimRange" };
  }
  if (!Number.isFinite(draft.durationMin) || draft.durationMin < DROP_MIN_DURATION_MIN) {
    return { ok: false, error: "durationTooShort" };
  }
  if (draft.durationMin > DROP_MAX_DURATION_MIN) {
    return { ok: false, error: "durationTooLong" };
  }
  if (!Number.isFinite(draft.startsAtMs)) {
    return { ok: false, error: "startRequired" };
  }
  if (draft.startsAtMs < nowMs - DROP_START_GRACE_MS) {
    return { ok: false, error: "startPast" };
  }
  if (draft.startsAtMs > nowMs + DROP_MAX_AHEAD_MS) {
    return { ok: false, error: "startTooFar" };
  }
  const startsAt = new Date(draft.startsAtMs);
  const endsAt = new Date(draft.startsAtMs + draft.durationMin * 60_000);
  return {
    ok: true,
    body: {
      kind: "drop",
      roomId: draft.roomId,
      title,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      payload: { amountVb: draft.amountVb, claimCap: draft.claimCap },
    },
  };
}

/* ── Server answers, in the bench's words ───────────────────────── */

export type DropServerErrorKey = "refusedAdmin" | "slotTaken" | "signIn" | "failed";

export type DropServerError =
  | { kind: "message"; message: string }
  | { kind: "key"; key: DropServerErrorKey };

export function dropBookingError(status: number, payload: unknown): DropServerError {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const code = typeof p["error"] === "string" ? p["error"] : "";
  const message = typeof p["message"] === "string" ? p["message"] : "";
  switch (code) {
    case "ADMIN_REQUIRED":
      /* The booking-rule refusal: spectacles are booked by the
       * house. The bench only renders for admins, so this answer
       * means the session isn't the house's — say the rule. */
      return { kind: "key", key: "refusedAdmin" };
    case "SLOT_TAKEN":
      return { kind: "key", key: "slotTaken" };
    default:
      break;
  }
  if (message) return { kind: "message", message };
  if (status === 401) return { kind: "key", key: "signIn" };
  return { kind: "key", key: "failed" };
}

/* ── The upcoming list (strict parse) ───────────────────────────── */

export interface UpcomingDrop {
  id: string;
  title: string;
  roomId: string;
  hostName: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "live";
  amountVb: number;
  claimCap: number;
}

function parseDropRow(raw: unknown): UpcomingDrop | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r["kind"] !== "drop") return null;
  if (r["status"] !== "scheduled" && r["status"] !== "live") return null;
  const id = typeof r["id"] === "string" ? r["id"] : "";
  const title = typeof r["title"] === "string" ? r["title"] : "";
  const roomId = typeof r["roomId"] === "string" ? r["roomId"] : "";
  const startsAt = typeof r["startsAt"] === "string" ? r["startsAt"] : "";
  const endsAt = typeof r["endsAt"] === "string" ? r["endsAt"] : "";
  if (!id || !title || !roomId || !startsAt || !endsAt) return null;
  const payload = r["payload"] && typeof r["payload"] === "object" ? (r["payload"] as Record<string, unknown>) : {};
  return {
    id,
    title,
    roomId,
    hostName: typeof r["hostName"] === "string" && r["hostName"] ? r["hostName"] : "",
    startsAt,
    endsAt,
    status: r["status"],
    amountVb: typeof payload["amountVb"] === "number" ? payload["amountVb"] : 0,
    claimCap: typeof payload["claimCap"] === "number" ? payload["claimCap"] : 0,
  };
}

/** Parse GET /api/world/events into the bench's upcoming drops.
 *  STRICT: anything but an object carrying an events array is a
 *  failed read (null) — the bench shows its error state, never a
 *  painted-empty list. Rows that aren't open drops drop out;
 *  ended windows drop out; soonest first. */
export function parseUpcomingDrops(raw: unknown, nowMs: number): UpcomingDrop[] | null {
  if (!raw || typeof raw !== "object") return null;
  const events = (raw as Record<string, unknown>)["events"];
  if (!Array.isArray(events)) return null;
  return events
    .map(parseDropRow)
    .filter((d): d is UpcomingDrop => d !== null)
    .filter((d) => Date.parse(d.endsAt) > nowMs)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
