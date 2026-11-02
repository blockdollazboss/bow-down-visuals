/**
 * show-invites.ts — Invite-to-a-show (stack1300, Ring 3.8), the
 * World client's half: the wire seam for the show invites the
 * server keeps in world_show_invites (migration 0313; decisions
 * and announcements in the api-server's lib/world-show-invites).
 *
 * The model: a show is one palace-calendar happening with a host,
 * a room and an hour. Its host invites a MEMBER (picked from the
 * member directory — the room invites' candidate list, reused
 * whole) to that specific show; the invite carries the show's
 * identity (event id, title, kind, room, window) and lands as a
 * tell the invitee answers here. Accepting records the answer;
 * walking in stays the calendar's own room walk (calendarEvent-
 * Action off the invite's kind + room — the SAME doorway every
 * calendar row offers) — this seam builds no second door.
 *
 * The endpoints (routes/world-show-invites.ts):
 *   POST /api/world/events/:eventId/invites   send (host only)
 *   GET  /api/world/show-invites/mine         my standing invites
 *   POST /api/world/show-invites/:id/accept   the yes
 *   POST /api/world/show-invites/:id/decline  the no (silent)
 * The picker's member list is the room invites' endpoint, reused:
 *   GET  /api/world/room-invites/candidates?q=
 * and the host's own shows come from the calendar backbone:
 *   GET  /api/world/events/mine
 */
import {
  calendarEventAction,
  normalizeCalendarEvents,
  type CalendarEvent,
} from "./palace-calendar";

export type ShowInviteStatus = "pending" | "accepted" | "declined";

export interface WorldShowInvite {
  id: string;
  /** The world_events row this invite names — the show's id, so
   *  the walk and the calendar never re-derive which show it is. */
  eventId: string;
  eventTitle: string;
  eventKind: string;
  /** The palace room the show stands in — the walk's target. */
  roomId: string;
  startsAt: string;
  endsAt: string;
  /** The host who sent the invite (the show's host). */
  hostName: string;
  hostAvatarUrl: string | null;
  status: ShowInviteStatus;
  createdAt: string;
  respondedAt: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v ? v : fallback;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function parseShowInviteStatus(v: unknown): ShowInviteStatus {
  return v === "accepted" || v === "declined" ? v : "pending";
}

/** One invite DTO at the boundary: an id and a show id or it isn't
 *  an invite; an unknown status reads as still-waiting, never as
 *  an answer nobody gave. */
export function parseWorldShowInvite(raw: unknown): WorldShowInvite | null {
  if (!isRecord(raw)) return null;
  const id = str(raw["id"]);
  const eventId = str(raw["eventId"]);
  if (!id || !eventId) return null;
  const hostName = str(raw["hostName"], "A creator");
  return {
    id,
    eventId,
    eventTitle: str(raw["eventTitle"], "A palace show"),
    eventKind: str(raw["eventKind"]),
    roomId: str(raw["roomId"]),
    startsAt: str(raw["startsAt"]),
    endsAt: str(raw["endsAt"]),
    hostName,
    hostAvatarUrl: strOrNull(raw["hostAvatarUrl"]),
    status: parseShowInviteStatus(raw["status"]),
    createdAt: str(raw["createdAt"]),
    respondedAt: strOrNull(raw["respondedAt"]),
  };
}

/** The mine payload → my standing invites, split by their state.
 *  Malformed rows drop out; a malformed body is no invites. */
export function parseShowInvitesMine(payload: unknown): {
  pending: WorldShowInvite[];
  accepted: WorldShowInvite[];
} {
  if (!isRecord(payload)) return { pending: [], accepted: [] };
  const parseList = (v: unknown): WorldShowInvite[] =>
    Array.isArray(v) ? v.map(parseWorldShowInvite).filter((i) => i !== null) : [];
  return { pending: parseList(payload["pending"]), accepted: parseList(payload["accepted"]) };
}

export function createShowInvitePath(eventId: string): string {
  return `/api/world/events/${encodeURIComponent(eventId)}/invites`;
}

export function showInvitesMinePath(): string {
  return "/api/world/show-invites/mine";
}

export function showInviteAcceptPath(id: string): string {
  return `/api/world/show-invites/${encodeURIComponent(id)}/accept`;
}

export function showInviteDeclinePath(id: string): string {
  return `/api/world/show-invites/${encodeURIComponent(id)}/decline`;
}

/** One invite call, house style (the room invites' shape): the
 *  session token rides as a Bearer header, and a refusal throws an
 *  Error carrying the server's own plain-words reason — the desk
 *  shows the server's words, never a local guess at them. */
async function showInviteCall(
  path: string,
  token: string | null,
  fallbackError: string,
  init?: { method?: string; body?: unknown },
): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const message =
      payload && typeof payload["error"] === "string" && payload["error"]
        ? (payload["error"] as string)
        : fallbackError;
    throw new Error(message);
  }
  return payload ?? {};
}

/** My standing invites (pending + accepted). Throws with the
 *  server's plain-words reason on failure — the desk shows it and
 *  offers the retry. */
export async function fetchShowInvitesMine(
  token: string | null,
): Promise<{ pending: WorldShowInvite[]; accepted: WorldShowInvite[] }> {
  const payload = await showInviteCall(
    showInvitesMinePath(),
    token,
    "Couldn't load your invites. Try again.",
  );
  return parseShowInvitesMine(payload);
}

/** Send an invite from my show to one picked member. Resolves with
 *  the server's recorded invite; a refusal (a duplicate already
 *  out, the show over, a non-member) throws the server's words. */
export async function sendShowInvite(
  eventId: string,
  inviteeUserId: string,
  token: string | null,
): Promise<WorldShowInvite> {
  const payload = await showInviteCall(
    createShowInvitePath(eventId),
    token,
    "Couldn't send that invite. Try again.",
    { method: "POST", body: { inviteeUserId } },
  );
  const invite = parseWorldShowInvite(payload["invite"]);
  if (!invite) throw new Error("Couldn't send that invite. Try again.");
  return invite;
}

/** Answer an invite. Accept resolves with the recorded invite (its
 *  kind + room are the door the caller walks through next, on the
 *  existing entry path); decline resolves with nothing to show. */
export async function answerShowInvite(
  id: string,
  answer: "accept" | "decline",
  token: string | null,
): Promise<WorldShowInvite | null> {
  const payload = await showInviteCall(
    answer === "accept" ? showInviteAcceptPath(id) : showInviteDeclinePath(id),
    token,
    "Couldn't answer that invite. Try again.",
    { method: "POST", body: {} },
  );
  return answer === "accept" ? parseWorldShowInvite(payload["invite"]) : null;
}

/* ── The walk + the host's pickable shows ─────────────────────────── */

/** Where accepting takes the invitee: the calendar's own action
 *  for the invite's kind + room — a room walk for the show kinds,
 *  the winners-circle station for a contest, and "none" for a kind
 *  this client doesn't know (the row then reads look-only rather
 *  than wearing a button that goes nowhere). One source of walk
 *  truth: the calendar's, never a second table here. */
export function showInviteAction(
  invite: Pick<WorldShowInvite, "eventKind" | "roomId" | "eventId" | "eventTitle" | "hostName" | "startsAt" | "endsAt">,
): ReturnType<typeof calendarEventAction> {
  return calendarEventAction({
    id: invite.eventId,
    kind: invite.eventKind,
    title: invite.eventTitle,
    roomId: invite.roomId,
    hostName: invite.hostName,
    startsAt: invite.startsAt,
    endsAt: invite.endsAt,
    status: "scheduled",
    theme: null,
    note: null,
  });
}

/** The host's own shows that can still take an invite, from the
 *  GET /api/world/events/mine payload: still standing (scheduled
 *  or live) with the window not yet closed, soonest first. Done,
 *  cancelled and already-ended shows are not invitable — the same
 *  rule the server enforces, so the picker never offers a send
 *  the server would refuse. */
export function upcomingInvitableShows(payload: unknown, nowMs: number): CalendarEvent[] {
  return normalizeCalendarEvents(payload)
    .filter(
      (e) =>
        (e.status === "scheduled" || e.status === "live") && Date.parse(e.endsAt) > nowMs,
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
