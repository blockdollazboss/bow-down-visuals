/**
 * world-show-invites.ts — Invite-to-a-show (stack1300, Ring 3.8 —
 * the remainder of "Invites + announcements"; the pattern is the
 * owner ruling of Oct 29, 2026: "Build real room invites — pick a
 * person, they accept or decline").
 *
 * The pure half of the feature: the decisions (who may invite,
 * what refuses and in what words), the wire DTO, and the two
 * announcements. The routes in routes/world-show-invites own the
 * DB reads and writes; everything they decide runs through here so
 * the rules are testable without a database.
 *
 * The model, briefly: a show is one row of world_events — a stage
 * show, a listening party, office hours, any booked happening with
 * a host, a room and an hour. Until now a show spread only by the
 * palace-wide announcement and the calendar: nobody could invite a
 * SPECIFIC friend to a SPECIFIC event. An invite is a row in
 * world_show_invites (migration 0313) naming the show's host and a
 * MEMBER — a user id picked from the member directory, never an
 * email string. Accepting records the answer on the row; the
 * member then walks in through the palace's EXISTING doorway (the
 * calendar's room walk off the invite's own kind + room). This
 * feature builds no second door and no second lock.
 *
 * Exactly-once is structural, twice over (the room invites'
 * discipline, carried whole):
 *  - the create bell fires only behind a landed insert, and the
 *    table's partial unique index allows ONE pending row per
 *    (event, invitee) — a replayed or raced create dies before
 *    either a second row or a second bell exists;
 *  - the accept bell fires only behind the conditional update
 *    that flips a still-pending row — a replayed accept finds
 *    nothing pending and fires nothing.
 */
import { notifyUserEvent, type UserEventInput } from "./push-events";
import { logger } from "./logger";

export const SHOW_INVITE_PENDING = "pending";
export const SHOW_INVITE_ACCEPTED = "accepted";
const SHOW_INVITE_DECLINED = "declined";

export type ShowInviteStatus =
  | typeof SHOW_INVITE_PENDING
  | typeof SHOW_INVITE_ACCEPTED
  | typeof SHOW_INVITE_DECLINED;

/** Whether a show can still be invited to / accepted for: the
 *  event itself must still stand (not cancelled, not done) and its
 *  window must not have closed. Live counts — a show standing NOW
 *  is exactly the one a friend should be summoned to. */
export type ShowStanding = "standing" | "cancelled" | "over";

export function showStandingFor(
  event: { status: string; endsAt: Date } | null,
  now: Date,
): ShowStanding {
  if (!event) return "over";
  if (event.status === "cancelled") return "cancelled";
  if (event.status !== "scheduled" && event.status !== "live") return "over";
  return event.endsAt.getTime() > now.getTime() ? "standing" : "over";
}

/** The bell's name for a kind — the calendar's own words. */
export function showKindLabel(kind: string): string {
  switch (kind) {
    case "stage_show":
      return "A stage show";
    case "listening_party":
      return "A listening party";
    case "office_hours":
      return "Office hours";
    case "drop":
      return "A drop spectacle";
    case "contest":
      return "A contest";
    default:
      return "A palace show";
  }
}

/* ── The wire DTO ──────────────────────────────────────────────────── */

interface WorldShowInviteDto {
  id: string;
  /** The world_events row this invite names — the show's identity,
   *  carried so the invitee's walk and the host's list never have
   *  to re-derive which show this is. */
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

interface ShowInviteRowLike {
  id: string;
  eventId: string;
  eventTitle: string;
  eventKind: string;
  roomId: string;
  startsAt: Date;
  endsAt: Date;
  inviterUserId: string;
  inviteeUserId: string;
  status: string;
  createdAt: Date;
  respondedAt: Date | null;
}

interface ShowInviteHostFacts {
  displayName: string;
  avatarUrl: string | null;
}

function asStatus(raw: string): ShowInviteStatus {
  return raw === SHOW_INVITE_ACCEPTED || raw === SHOW_INVITE_DECLINED
    ? raw
    : SHOW_INVITE_PENDING;
}

/** One invite row + its host's public facts → the wire DTO. The
 *  show's identity rides the row itself (denormalized at send
 *  time), so the DTO names the show even if the event row is later
 *  cancelled; a host profile that has gone away reads as a plain
 *  "A creator" — never a fabricated name. */
export function showInviteDto(
  row: ShowInviteRowLike,
  host: ShowInviteHostFacts | null,
): WorldShowInviteDto {
  return {
    id: row.id,
    eventId: row.eventId,
    eventTitle: row.eventTitle,
    eventKind: row.eventKind,
    roomId: row.roomId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    hostName: host?.displayName ?? "A creator",
    hostAvatarUrl: host?.avatarUrl ?? null,
    status: asStatus(row.status),
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
  };
}

/* ── The decisions ─────────────────────────────────────────────────── */

type ShowInviteDecision = { ok: true } | { ok: false; status: number; error: string };

/**
 * May this caller send this invite? The order matters: the show
 * door closes first (a show that is missing OR not the caller's
 * is the same 404 the room invites give — a stranger learns
 * nothing and changes nothing), then the pick itself, then the
 * show's own standing, then the standing rows.
 */
export function decideShowInviteCreate(input: {
  /** The world_events row (any status — its standing is judged
   *  below, in words the host may hear about their own show). */
  event: {
    hostUserId: string;
    status: string;
    endsAt: Date;
  } | null;
  callerUserId: string;
  /** The raw body value: must name a member by user id. */
  inviteeUserId: unknown;
  /** The invitee's member record (their creator profile), when
   *  the named user id belongs to a member at all. */
  inviteeProfile: { userId: string; displayName: string } | null;
  /** A pending invite from this show to this member stands. */
  existingPending: boolean;
  /** An accepted invite stands — the member is already coming. */
  existingAccepted: boolean;
  now: Date;
}): ShowInviteDecision {
  const inviteeUserId =
    typeof input.inviteeUserId === "string" && input.inviteeUserId.trim().length > 0
      ? input.inviteeUserId.trim()
      : null;
  if (!inviteeUserId) {
    return { ok: false, status: 400, error: "Pick a person to invite — an invite names a member." };
  }
  if (!input.event || input.event.hostUserId !== input.callerUserId) {
    return {
      ok: false,
      status: 404,
      error: "That show isn't yours to invite to — or it's already gone.",
    };
  }
  if (inviteeUserId === input.callerUserId) {
    return { ok: false, status: 400, error: "That's you — it's your own show." };
  }
  if (!input.inviteeProfile) {
    return {
      ok: false,
      status: 404,
      error: "That person isn't a member here — pick someone from the member list.",
    };
  }
  const standing = showStandingFor(input.event, input.now);
  if (standing === "cancelled") {
    return {
      ok: false,
      status: 409,
      error: "That show was cancelled — there's nothing left to invite to.",
    };
  }
  if (standing === "over") {
    return {
      ok: false,
      status: 409,
      error: "That show is over — there's nothing left to invite to.",
    };
  }
  if (input.existingAccepted) {
    return {
      ok: false,
      status: 409,
      error: `${input.inviteeProfile.displayName} is already coming to your show — no second invite needed.`,
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
 * half of this rule — this decider is the words). An ACCEPT also
 * needs the show to still stand: a cancelled or finished show
 * closes the invite rather than promising a walk to nothing. A
 * decline is always the invitee's to give.
 */
export function decideShowInviteRespond(input: {
  invite: { inviteeUserId: string; status: string } | null;
  callerUserId: string;
  answer: typeof SHOW_INVITE_ACCEPTED | typeof SHOW_INVITE_DECLINED;
  /** The show's standing at answer time (accept only). */
  eventStanding: ShowStanding;
}): ShowInviteDecision {
  if (!input.invite || input.invite.inviteeUserId !== input.callerUserId) {
    return { ok: false, status: 404, error: "That invite isn't yours — or it's already gone." };
  }
  if (input.invite.status !== SHOW_INVITE_PENDING) {
    return { ok: false, status: 409, error: "You've already answered that invite — nothing left to decide." };
  }
  if (input.answer === SHOW_INVITE_ACCEPTED && input.eventStanding !== "standing") {
    return input.eventStanding === "cancelled"
      ? {
          ok: false,
          status: 409,
          error: "That show was cancelled — the invite closed with it.",
        }
      : {
          ok: false,
          status: 409,
          error: "That show is over — the invite closed with it.",
        };
  }
  return { ok: true };
}

/* ── The announcements ───────────────────────────────────────────────
 * Both bells ride the one event door (notifyUserEvent) under the
 * SOCIAL category: an invite is a social interaction, so the bell
 * always lands and the device ping obeys the member's social
 * preference (default OFF — the stack800 push-families rule).
 * Declining is deliberately silent: no bell, no guilt mechanics. */

export function buildShowInviteEvent(opts: {
  inviteeUserId: string;
  inviterName: string;
  eventTitle: string;
  eventKind: string;
  roomLabel: string;
}): UserEventInput {
  return {
    userId: opts.inviteeUserId,
    category: "social",
    kind: "show_invite",
    title: `🦈 ${opts.inviterName} invited you to “${opts.eventTitle}”`,
    body: `${showKindLabel(opts.eventKind)} in ${opts.roomLabel}. The invite waits with the palace calendar — accept it and walk in when the show stands.`,
    link: "/world",
  };
}

export function buildShowInviteAcceptedEvent(opts: {
  inviterUserId: string;
  inviteeName: string;
  eventTitle: string;
}): UserEventInput {
  return {
    userId: opts.inviterUserId,
    category: "social",
    kind: "show_invite_accepted",
    title: `🦈 ${opts.inviteeName} is coming to “${opts.eventTitle}”`,
    body: "They accepted your invite — look for them when the show stands.",
    link: "/world",
  };
}

type ShowInviteEventNotifier = (input: UserEventInput) => Promise<unknown>;
let _showInviteEventNotifier: ShowInviteEventNotifier = notifyUserEvent;
/** Test seam — never used outside tests. */
export function __setShowInviteEventNotifier(fn: ShowInviteEventNotifier | null): void {
  _showInviteEventNotifier = fn ?? notifyUserEvent;
}

/** Best-effort: a ping failure never fails the invite that landed. */
export async function notifyShowInviteCreated(opts: {
  inviteeUserId: string;
  inviterName: string;
  eventTitle: string;
  eventKind: string;
  roomLabel: string;
}): Promise<void> {
  try {
    await _showInviteEventNotifier(buildShowInviteEvent(opts));
  } catch (err) {
    logger.error({ err }, "[world] show-invite announcement failed");
  }
}

/** Best-effort: a ping failure never fails the answer that landed. */
export async function notifyShowInviteAccepted(opts: {
  inviterUserId: string;
  inviteeName: string;
  eventTitle: string;
}): Promise<void> {
  try {
    await _showInviteEventNotifier(buildShowInviteAcceptedEvent(opts));
  } catch (err) {
    logger.error({ err }, "[world] show-invite-accepted announcement failed");
  }
}
