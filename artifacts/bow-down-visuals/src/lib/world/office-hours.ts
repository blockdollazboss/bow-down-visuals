/**
 * office-hours.ts — Office Hours' pure client seam (UPGRADE-PROGRAM
 * 3.7, stack-20 #17). A creator holds court in their own Creator
 * Room at a set hour; the booking rides the palace calendar
 * (world_events, kind "office_hours", migration 0159):
 *   POST   /api/world/events          book (auth; own room only)
 *   GET    /api/world/events?roomId=  the room's public slate
 *   GET    /api/world/events/mine     the host's own bookings
 *   DELETE /api/world/events/:id      cancel (host or admin)
 *
 * PRESENCE TRUTH: everything here speaks about the SCHEDULE — a
 * session is "in session" when the clock is inside its booked
 * window. Whether the host's body is actually standing in the room
 * is the presence layer's read (the room's occupant count and live
 * roster), and no copy in this seam claims it: the marker says the
 * hours are ON, never that the host is physically here.
 */
import { creatorRoomId } from "./palace-layout";

export { creatorRoomId };

/* ─── Shapes ──────────────────────────────────────────────────────── */

export interface OfficeHoursSession {
  id: string;
  title: string;
  note: string | null;
  hostName: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "live";
}

/** The room detail DTO's officeHours field (routes/world.ts): the
 *  room's current-or-next session, state pre-computed server-side
 *  from the booked window. */
export interface CreatorRoomOfficeHours {
  id: string;
  title: string;
  note: string | null;
  startsAt: string;
  endsAt: string;
  state: "in-session" | "upcoming";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

export function parseCreatorRoomOfficeHours(raw: unknown): CreatorRoomOfficeHours | null {
  if (!isRecord(raw)) return null;
  const id = str(raw["id"]);
  const startsAt = str(raw["startsAt"]);
  const endsAt = str(raw["endsAt"]);
  if (!id || !startsAt || !endsAt) return null;
  return {
    id,
    title: str(raw["title"], "Office hours"),
    note: typeof raw["note"] === "string" && raw["note"] ? raw["note"] : null,
    startsAt,
    endsAt,
    state: raw["state"] === "in-session" ? "in-session" : "upcoming",
  };
}

/** One row of a world-events read (slate or mine) → a session, or
 *  null when the row isn't an office-hours booking. Mine rows carry
 *  done/cancelled history too — the caller decides which statuses
 *  to show; the parser only insists the row is well-formed. */
export function parseOfficeHoursEvent(raw: unknown): (OfficeHoursSession & { status: string }) | null {
  if (!isRecord(raw)) return null;
  if (raw["kind"] !== "office_hours") return null;
  const id = str(raw["id"]);
  const startsAt = str(raw["startsAt"]);
  const endsAt = str(raw["endsAt"]);
  const status = str(raw["status"]);
  if (!id || !startsAt || !endsAt || !status) return null;
  const payload = isRecord(raw["payload"]) ? raw["payload"] : {};
  return {
    id,
    title: str(raw["title"], "Office hours"),
    note: typeof payload["note"] === "string" && payload["note"] ? (payload["note"] as string) : null,
    hostName: str(raw["hostName"], "Creator"),
    startsAt,
    endsAt,
    status: status as OfficeHoursSession["status"],
  };
}

export function parseOfficeHoursEvents(payload: unknown): (OfficeHoursSession & { status: string })[] {
  const list =
    isRecord(payload) && Array.isArray(payload["events"])
      ? payload["events"]
      : Array.isArray(payload)
        ? payload
        : null;
  if (!list) return [];
  return list.map(parseOfficeHoursEvent).filter((s) => s !== null);
}

/** The session a room's marker should name right now: the one whose
 *  window holds the clock, else the soonest that hasn't ended.
 *  Cancelled/done rows and ended windows never name a marker. */
export function currentOrNextSession(
  sessions: (OfficeHoursSession & { status: string })[],
  nowMs: number,
): OfficeHoursSession | null {
  const open = sessions
    .filter(
      (s) =>
        (s.status === "scheduled" || s.status === "live") &&
        Date.parse(s.endsAt) > nowMs,
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return open[0] ?? null;
}

/* ─── The marker ──────────────────────────────────────────────────── */

export interface OfficeHoursMarker {
  /** True while the clock is inside the booked window. */
  inSession: boolean;
  headline: string;
  detail: string;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtDayTime(iso: string, nowMs: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date(nowMs);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const day = sameDay
    ? "Today"
    : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${day} · ${fmtTime(iso)}`;
}

/** The room marker's words. The headline is the schedule talking:
 *  "Office hours — <host>"; the detail names the window so nobody
 *  mistakes a booking for a body (see the presence-truth note at
 *  the top of this file). Accepts either the detail DTO's field or
 *  a slate session — both are the same booking read two ways. */
export function officeHoursMarker(
  session: { title: string; note: string | null; startsAt: string; endsAt: string } | null,
  hostName: string,
  nowMs: number,
): OfficeHoursMarker | null {
  if (!session) return null;
  const start = Date.parse(session.startsAt);
  const end = Date.parse(session.endsAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= nowMs) return null;
  const inSession = start <= nowMs;
  const host = hostName.trim() || "Creator";
  const notePart = session.note ? ` — ${session.note}` : "";
  if (inSession) {
    return {
      inSession: true,
      headline: `Office hours — ${host}`,
      detail: `${session.title}${notePart} · in session until ${fmtTime(session.endsAt)} — the room is open, come in and ask.`,
    };
  }
  return {
    inSession: false,
    headline: `Office hours — ${host}`,
    detail: `${session.title}${notePart} · next session ${fmtDayTime(session.startsAt, nowMs)}.`,
  };
}

/** A session's when, for schedule rows: "Today · 7:00 PM – 8:00 PM"
 *  or "Fri, Oct 23 · 7:00 PM – 8:00 PM". */
export function officeHoursSessionWhen(
  session: { startsAt: string; endsAt: string },
  nowMs: number,
): string {
  return `${fmtDayTime(session.startsAt, nowMs)} – ${fmtTime(session.endsAt)}`;
}

/* ─── Booking (the host's form) ───────────────────────────────────── */

/** The booking window rules, mirrored from the server's (the server
 *  is the authority — these only keep the form honest before it
 *  asks): 5 minutes to 4 hours, at most 30 days out. */
export const OFFICE_HOURS_DURATIONS_MIN = [30, 60, 90, 120] as const;
export const OFFICE_HOURS_MIN_DURATION_MIN = 5;
export const OFFICE_HOURS_MAX_DURATION_MIN = 240;
export const OFFICE_HOURS_MAX_AHEAD_MS = 30 * 24 * 3600_000;

export interface OfficeHoursForm {
  title: string;
  note: string;
  /** A datetime-local value ("YYYY-MM-DDTHH:mm"), read as local time. */
  startLocal: string;
  durationMin: number;
}

export type BookingBuild =
  | {
      ok: true;
      body: {
        kind: "office_hours";
        roomId: string;
        title: string;
        startsAt: string;
        endsAt: string;
        payload: { note?: string };
      };
    }
  | { ok: false; error: string };

export function buildOfficeHoursBooking(slug: string, form: OfficeHoursForm, nowMs: number): BookingBuild {
  const title = form.title.trim().slice(0, 120) || "Office hours";
  const note = form.note.trim().slice(0, 140);
  const start = new Date(form.startLocal);
  if (Number.isNaN(start.getTime())) {
    return { ok: false, error: "Pick a start time for the session." };
  }
  if (
    !Number.isFinite(form.durationMin) ||
    form.durationMin < OFFICE_HOURS_MIN_DURATION_MIN ||
    form.durationMin > OFFICE_HOURS_MAX_DURATION_MIN
  ) {
    return { ok: false, error: "A session runs between 5 minutes and 4 hours." };
  }
  if (start.getTime() < nowMs - OFFICE_HOURS_MIN_DURATION_MIN * 60_000) {
    return { ok: false, error: "That start time is already past — pick the next hour." };
  }
  if (start.getTime() > nowMs + OFFICE_HOURS_MAX_AHEAD_MS) {
    return { ok: false, error: "Sessions book at most 30 days ahead." };
  }
  const end = new Date(start.getTime() + form.durationMin * 60_000);
  return {
    ok: true,
    body: {
      kind: "office_hours",
      roomId: creatorRoomId(slug),
      title,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      payload: note ? { note } : {},
    },
  };
}

/** A datetime-local value for the next full hour from `nowMs`. */
export function nextHourLocalValue(nowMs: number): string {
  const d = new Date(nowMs);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalValue(d);
}

/** The same wall-clock time, `days` later — the form's one-tap
 *  "same time next week" after a booking lands. */
export function plusDaysLocalValue(localValue: string, days: number): string {
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return localValue;
  d.setDate(d.getDate() + days);
  return toLocalValue(d);
}

function toLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Booking refusals in plain words. The server's own message is
 *  already honest copy — it wins whenever it arrives; the map only
 *  covers the codes whose raw form is a code, not a sentence. */
export function officeHoursErrorCopy(status: number, body: unknown): string {
  const rec = isRecord(body) ? body : {};
  const code = typeof rec["error"] === "string" ? rec["error"] : "";
  const message = typeof rec["message"] === "string" ? rec["message"] : "";
  if (code === "SLOT_TAKEN") {
    return "Your room already has something booked in that window — pick another hour.";
  }
  if (message) return message;
  if (status === 401) return "Sign in to book your office hours.";
  if (status === 403) return "That booking isn't yours to make.";
  if (status === 400) return "That session doesn't fit the calendar's rules — check the time and length.";
  return "The booking wouldn't land — try again.";
}

/* ─── Endpoints ───────────────────────────────────────────────────── */

export function officeHoursSlatePath(roomId: string): string {
  return `/api/world/events?roomId=${encodeURIComponent(roomId)}`;
}

export const OFFICE_HOURS_BOOK_PATH = "/api/world/events";
export const OFFICE_HOURS_MINE_PATH = "/api/world/events/mine";

export function officeHoursCancelPath(id: string): string {
  return `/api/world/events/${encodeURIComponent(id)}`;
}
