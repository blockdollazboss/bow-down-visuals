/**
 * world-room-invites.ts — Creator Room invites (stack900 Lane B4;
 * owner ruling Oct 29, 2026: "Build real room invites — pick a
 * person, they accept or decline").
 *
 * The pure half of the feature: the decisions (who may invite,
 * what refuses and in what words), the wire DTO, and the two
 * announcements. The routes in routes/world.ts own the DB reads
 * and writes; everything they decide runs through here so the
 * rules are testable without a database.
 *
 * The model, briefly: a Creator Room is its host's place
 * (`creator:<slug>`, owned by the creator profile's user id). An
 * invite is a row in world_room_invites (migration 0300) naming
 * the host and a MEMBER — a user id picked from the member
 * directory, never an email string. Accepting records the answer
 * on the row; the member then walks in through the palace's
 * EXISTING doorway (the room read + doorway transfer). This
 * feature builds no second door and no second lock: door locks
 * and person locks keep ruling entry exactly as before.
 *
 * Exactly-once is structural, twice over:
 *  - the create bell fires only behind a landed insert, and the
 *    table's partial unique index allows ONE pending row per
 *    (room, invitee) — a replayed or raced create dies before
 *    either a second row or a second bell exists;
 *  - the accept bell fires only behind the conditional update
 *    that flips a still-pending row — a replayed accept finds
 *    nothing pending and fires nothing.
 */
import { notifyUserEvent, type UserEventInput } from "./push-events";
import { creatorRoomName } from "./world-palace";
import { logger } from "./logger";

export const ROOM_INVITE_PENDING = "pending";
export const ROOM_INVITE_ACCEPTED = "accepted";
export const ROOM_INVITE_DECLINED = "declined";

export type RoomInviteStatus =
  | typeof ROOM_INVITE_PENDING
  | typeof ROOM_INVITE_ACCEPTED
  | typeof ROOM_INVITE_DECLINED;

/* ── The wire DTO ──────────────────────────────────────────────────── */

export interface WorldRoomInviteDto {
  id: string;
  roomId: string;
  slug: string;
  /** The room's name as its host's place: "{Host}'s Room". */
  roomName: string;
  /** The host who sent the invite (the room's owner). */
  hostName: string;
  hostAvatarUrl: string | null;
  status: RoomInviteStatus;
  createdAt: string;
  respondedAt: string | null;
}

export interface RoomInviteRowLike {
  id: string;
  roomId: string;
  roomSlug: string;
  inviterUserId: string;
  inviteeUserId: string;
  status: string;
  createdAt: Date;
  respondedAt: Date | null;
}

export interface RoomInviteHostFacts {
  displayName: string;
  avatarUrl: string | null;
}

function asStatus(raw: string): RoomInviteStatus {
  return raw === ROOM_INVITE_ACCEPTED || raw === ROOM_INVITE_DECLINED
    ? raw
    : ROOM_INVITE_PENDING;
}

/** One invite row + its host's public facts → the wire DTO. A host
 *  profile that has gone away reads as a plain "A Creator Room" —
 *  never a fabricated name. */
export function roomInviteDto(
  row: RoomInviteRowLike,
  host: RoomInviteHostFacts | null,
): WorldRoomInviteDto {
  return {
    id: row.id,
    roomId: row.roomId,
    slug: row.roomSlug,
    roomName: host ? creatorRoomName(host.displayName) : "A Creator Room",
    hostName: host?.displayName ?? "A creator",
    hostAvatarUrl: host?.avatarUrl ?? null,
    status: asStatus(row.status),
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
  };
}

/* ── The decisions ─────────────────────────────────────────────────── */

export type RoomInviteDecision = { ok: true } | { ok: false; status: number; error: string };

/**
 * May this caller send this invite? The order matters: the room
 * door closes first (a room that is missing OR not the caller's
 * is the same 404 the room reads give — a stranger learns nothing
 * and changes nothing, the house rule from the dressing desk),
 * then the pick itself, then the standing rows.
 */
export function decideRoomInviteCreate(input: {
  /** The creator profile at the slug (any visibility — ownership
   *  is the caller's proof, exactly as the dressing write). */
  roomProfile: { userId: string } | null;
  callerUserId: string;
  /** The raw body value: must name a member by user id. */
  inviteeUserId: unknown;
  /** The invitee's member record (their creator profile), when
   *  the named user id belongs to a member at all. */
  inviteeProfile: { userId: string; displayName: string } | null;
  /** A pending invite from this room to this member stands. */
  existingPending: boolean;
  /** An accepted invite stands — the member is already in. */
  existingAccepted: boolean;
}): RoomInviteDecision {
  const inviteeUserId =
    typeof input.inviteeUserId === "string" && input.inviteeUserId.trim().length > 0
      ? input.inviteeUserId.trim()
      : null;
  if (!inviteeUserId) {
    return { ok: false, status: 400, error: "Pick a person to invite — an invite names a member." };
  }
  if (!input.roomProfile || input.roomProfile.userId !== input.callerUserId) {
    return {
      ok: false,
      status: 404,
      error: "That room isn't open — it may be private, or it isn't yours to invite to.",
    };
  }
  if (inviteeUserId === input.callerUserId) {
    return { ok: false, status: 400, error: "That's you — your own room is already yours." };
  }
  if (!input.inviteeProfile) {
    return {
      ok: false,
      status: 404,
      error: "That person isn't a member here — pick someone from the member list.",
    };
  }
  if (input.existingAccepted) {
    return {
      ok: false,
      status: 409,
      error: `${input.inviteeProfile.displayName} is already in your room — no second invite needed.`,
    };
  }
  if (input.existingPending) {
    return {
      ok: false,
      status: 409,
      error: `Your invite to ${input.inviteeProfile.displayName} is already out — it's still waiting on them.`,
    };
  }
  return { ok: true };
}

/**
 * May this caller answer this invite? Only its invitee, and only
 * while it still waits: somebody else's invite is the same 404
 * as a missing one, and an answered invite has nothing left to
 * decide (the conditional update in the route is the race-proof
 * half of this rule — this decider is the words).
 */
export function decideRoomInviteRespond(input: {
  invite: { inviteeUserId: string; status: string } | null;
  callerUserId: string;
}): RoomInviteDecision {
  if (!input.invite || input.invite.inviteeUserId !== input.callerUserId) {
    return { ok: false, status: 404, error: "That invite isn't yours — or it's already gone." };
  }
  if (input.invite.status !== ROOM_INVITE_PENDING) {
    return { ok: false, status: 409, error: "You've already answered that invite — nothing left to decide." };
  }
  return { ok: true };
}

/* ── The announcements ───────────────────────────────────────────────
 * Both bells ride the one event door (notifyUserEvent) under the
 * SOCIAL category: an invite is a social interaction, so the bell
 * always lands and the device ping obeys the member's social
 * preference (default OFF — the stack800 push-families rule).
 * Declining is deliberately silent: no bell, no guilt mechanics. */

export function buildRoomInviteEvent(opts: {
  inviteeUserId: string;
  inviterName: string;
  roomName: string;
}): UserEventInput {
  return {
    userId: opts.inviteeUserId,
    category: "social",
    kind: "room_invite",
    title: `🦈 ${opts.inviterName} invited you to ${opts.roomName}`,
    body: "The invite waits in the Creator Rooms — accept it and the room is yours to walk into.",
    link: "/world",
  };
}

export function buildRoomInviteAcceptedEvent(opts: {
  inviterUserId: string;
  inviteeName: string;
  roomName: string;
}): UserEventInput {
  return {
    userId: opts.inviterUserId,
    category: "social",
    kind: "room_invite_accepted",
    title: `🦈 ${opts.inviteeName} accepted your invite to ${opts.roomName}`,
    body: "They're in — look for them in the palace.",
    link: "/world",
  };
}

type RoomInviteEventNotifier = (input: UserEventInput) => Promise<unknown>;
let _roomInviteEventNotifier: RoomInviteEventNotifier = notifyUserEvent;
/** Test seam — never used outside tests. */
export function __setRoomInviteEventNotifier(fn: RoomInviteEventNotifier | null): void {
  _roomInviteEventNotifier = fn ?? notifyUserEvent;
}

/** Best-effort: a ping failure never fails the invite that landed. */
export async function notifyRoomInviteCreated(opts: {
  inviteeUserId: string;
  inviterName: string;
  roomName: string;
}): Promise<void> {
  try {
    await _roomInviteEventNotifier(buildRoomInviteEvent(opts));
  } catch (err) {
    logger.error({ err }, "[world] room-invite announcement failed");
  }
}

/** Best-effort: a ping failure never fails the answer that landed. */
export async function notifyRoomInviteAccepted(opts: {
  inviterUserId: string;
  inviteeName: string;
  roomName: string;
}): Promise<void> {
  try {
    await _roomInviteEventNotifier(buildRoomInviteAcceptedEvent(opts));
  } catch (err) {
    logger.error({ err }, "[world] room-invite-accepted announcement failed");
  }
}
