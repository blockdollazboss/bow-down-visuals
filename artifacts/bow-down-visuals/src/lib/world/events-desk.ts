/* ─── Events desk seam (stack1100 world parity, mechanical) ──────
   The Community Hall's events section, on the community router's
   own rails — the same /api/events endpoints pages/events.tsx and
   pages/event-detail.tsx call:

     GET  /api/events              → { events: [dto] } (public list,
                                     soonest first, host card joined)
     POST /api/events              → create (creators only — the
                                     rail answers 403 with its own
                                     honest line when the caller has
                                     no creator profile)
     POST /api/events/:id/rsvp     → 201 { ok: true }; 409 when the
                                     caller is already on the list
     POST /api/events/:id/unrsvp   → cancel

   The event DTO is snake_case by contract (community.ts toEventDto:
   starts_at / rsvp_count / cover_url / destination_url /
   ticket_url, plus the list's joined host card). This seam
   normalizes it once so the desk never renders a raw row.

   RSVP state honesty: the list rail does NOT say which events the
   caller already RSVP'd on an earlier visit — there is no per-row
   flag to read. The desk therefore learns it from the server's own
   answer: an RSVP tap that comes back 409 ("You're already on the
   list") flips the row to on-the-list, exactly the truth the rail
   holds. Nothing is guessed or stored as fact beyond the session's
   own confirmed answers. */

export const EVENTS_PATH = "/api/events";

export function eventRsvpPath(eventId: string): string {
  return `/api/events/${encodeURIComponent(eventId)}/rsvp`;
}

export function eventUnrsvpPath(eventId: string): string {
  return `/api/events/${encodeURIComponent(eventId)}/unrsvp`;
}

/** The rail's kind enum (@workspace/db EVENT_KINDS) with the events
 *  page's own filter labels. */
export const EVENT_KIND_OPTIONS = [
  { key: "stream", label: "Stream" },
  { key: "drop", label: "Drop" },
  { key: "premiere", label: "Premiere" },
  { key: "other", label: "Other" },
] as const;

export type EventKindKey = (typeof EVENT_KIND_OPTIONS)[number]["key"];

export function eventKindLabel(kind: string): string {
  return EVENT_KIND_OPTIONS.find((k) => k.key === kind)?.label ?? "Event";
}

export interface WorldEvent {
  id: string;
  title: string;
  description: string;
  kind: string;
  startsAt: string;
  coverUrl: string | null;
  destinationUrl: string | null;
  ticketUrl: string | null;
  rsvpCount: number;
  hostName: string | null;
  hostSlug: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Normalize the list rail's answer. Returns null when the payload
 *  is not the shape the rail promises (a failed attempt — the desk
 *  shows its error state and retries, never an empty board painted
 *  over a broken answer). A genuinely empty list normalizes to []. */
export function normalizeWorldEvents(payload: unknown): WorldEvent[] | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["events"])) return null;
  const out: WorldEvent[] = [];
  for (const raw of root["events"]) {
    const row = asRecord(raw);
    if (!row) return null;
    const id = str(row["id"]);
    const title = str(row["title"]);
    const startsAt = str(row["starts_at"]);
    if (!id || !title || !startsAt) return null;
    const host = asRecord(row["host"]);
    out.push({
      id,
      title,
      description: str(row["description"]),
      kind: str(row["kind"]) || "other",
      startsAt,
      coverUrl: strOrNull(row["cover_url"]),
      destinationUrl: strOrNull(row["destination_url"]),
      ticketUrl: strOrNull(row["ticket_url"]),
      rsvpCount: num(row["rsvp_count"]),
      hostName: host ? strOrNull(host["display_name"]) : null,
      hostSlug: host ? strOrNull(host["slug"]) : null,
    });
  }
  return out;
}

/** When-line for a row: "Fri, Nov 6 · 7:00 PM" in the viewer's own
 *  locale, or the raw string when the date won't parse (never a
 *  fabricated "Invalid Date"). */
export function eventWhenLabel(startsAt: string): string {
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return startsAt;
  const day = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

/* ─── Create form ──────────────────────────────────────────────────
   The events page's create body, field for field: title trimmed,
   starts_at as an ISO instant, kind from the rail's enum, the two
   URLs trimmed-or-null. The rail re-validates everything (title
   1–120, starts_at a real datetime, kind in the enum). */

export interface EventCreateForm {
  title: string;
  description: string;
  /** The datetime-local input's value ("2026-11-06T19:00"). */
  startsAtLocal: string;
  kind: string;
  destinationUrl: string;
  ticketUrl: string;
}

export function eventCreateReady(form: EventCreateForm): boolean {
  if (form.title.trim().length === 0 || form.title.trim().length > 120) return false;
  if (!EVENT_KIND_OPTIONS.some((k) => k.key === form.kind)) return false;
  const starts = new Date(form.startsAtLocal);
  return form.startsAtLocal.length > 0 && !Number.isNaN(starts.getTime());
}

export function buildEventCreateBody(form: EventCreateForm): Record<string, unknown> {
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    starts_at: new Date(form.startsAtLocal).toISOString(),
    kind: form.kind,
    destination_url: form.destinationUrl.trim() || null,
    ticket_url: form.ticketUrl.trim() || null,
  };
}

/** The RSVP tap's outcome, from the rail's own status: 201 = newly
 *  on the list; 409 = already on it (the desk flips the row either
 *  way — both are the server saying the caller IS on the list). */
export function rsvpLanded(status: number): boolean {
  return status === 201 || status === 409;
}
