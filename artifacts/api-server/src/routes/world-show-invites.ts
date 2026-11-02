/**
 * world-show-invites.ts — Invite-to-a-show over REST (stack1300,
 * Ring 3.8; table world_show_invites, migration 0313; the decisions
 * and announcements live in lib/world-show-invites):
 *
 *   POST /api/world/events/:eventId/invites  { inviteeUserId }
 *     The show's host invites a member (a user id picked from the
 *     member list — never an email). The insert is the exactly-once
 *     gate for the invitee's bell: one pending row per (event,
 *     invitee) stands by the table's partial unique index, and the
 *     bell fires only behind a landed insert.
 *   GET  /api/world/show-invites/mine
 *     The caller's own standing invites: what's waiting on them
 *     (pending) and the shows they're coming to (accepted).
 *   POST /api/world/show-invites/:id/accept
 *     Records the yes — after re-reading the show: a cancelled or
 *     finished show closes the invite instead of promising a walk
 *     to nothing. The member then walks in through the palace's
 *     EXISTING doorway (the calendar's room walk off the invite's
 *     kind + room) — acceptance builds no second door, and the
 *     door's own locks keep ruling entry as before. The host's
 *     bell fires only behind the conditional update that flips a
 *     still-pending row, so a replay tells nothing.
 *   POST /api/world/show-invites/:id/decline
 *     Records the no — silently. No bell, no guilt mechanics.
 *
 * The pattern is the room invites' (routes/world.ts, migration
 * 0300) carried whole: same delivery (the one event door, social),
 * same exactly-once discipline, same guest rule — every route here
 * is requireAuth, and an invite names a MEMBER: guests neither
 * send nor receive one.
 */
import { Router, type Request, type Response } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  db,
  worldShowInvitesTable,
  worldEventsTable,
  creatorProfilesTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { refreshSupabaseStorageUrlsDeep } from "../lib/objectStorage";
import {
  PALACE_ROOM_DEFS,
  creatorRoomName,
  creatorSlugFromRoomId,
} from "../lib/world-palace";
import {
  SHOW_INVITE_ACCEPTED,
  SHOW_INVITE_PENDING,
  decideShowInviteCreate,
  decideShowInviteRespond,
  notifyShowInviteAccepted,
  notifyShowInviteCreated,
  showInviteDto,
  showStandingFor,
  type ShowStanding,
} from "../lib/world-show-invites";

const router = Router();

const SHOW_INVITE_LIST_LIMIT = 100;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Postgres unique violation (23505), however drizzle wrapped it. */
function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur && typeof cur === "object"; depth++) {
    if ((cur as { code?: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** The bell's name for the room a show stands in: a palace room by
 *  its def name, a creator room by its host's name, and the palace
 *  itself when neither names it — never an invented room. */
function roomLabelFor(roomId: string, hostDisplayName: string | null): string {
  const def = PALACE_ROOM_DEFS.find((r) => r.roomId === roomId);
  if (def) return def.name.startsWith("The ") ? def.name : `the ${def.name}`;
  if (creatorSlugFromRoomId(roomId) && hostDisplayName) {
    return creatorRoomName(hostDisplayName);
  }
  return "the palace";
}

type EventRow = typeof worldEventsTable.$inferSelect;
type ShowInviteRow = typeof worldShowInvitesTable.$inferSelect;

/* ── Send ─────────────────────────────────────────────────────────── */

router.post(
  "/world/events/:eventId/invites",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    try {
      const callerUserId = req.userId!;
      const eventId = String(req.params["eventId"] ?? "");
      const body = (req.body ?? {}) as Record<string, unknown>;
      const inviteeRaw = body["inviteeUserId"];
      const inviteeUserId = typeof inviteeRaw === "string" ? inviteeRaw.trim() : "";
      const [event] = UUID_SHAPE.test(eventId)
        ? await db
            .select()
            .from(worldEventsTable)
            .where(eq(worldEventsTable.id, eventId))
            .limit(1)
        : [];
      /* The decider (lib/world-show-invites) rules the refusals in
       * order; the reads here just gather its facts — and only
       * behind the show door: a show that isn't the caller's earns
       * no lookups at all, exactly like the room invites. */
      let inviteeProfile: { userId: string; displayName: string } | null = null;
      let existingPending = false;
      let existingAccepted = false;
      if (
        event &&
        event.hostUserId === callerUserId &&
        UUID_SHAPE.test(inviteeUserId) &&
        inviteeUserId !== callerUserId
      ) {
        const [member] = await db
          .select({
            userId: creatorProfilesTable.userId,
            displayName: creatorProfilesTable.displayName,
          })
          .from(creatorProfilesTable)
          .where(eq(creatorProfilesTable.userId, inviteeUserId))
          .limit(1);
        inviteeProfile = member ?? null;
        if (inviteeProfile) {
          const standing = await db
            .select({ status: worldShowInvitesTable.status })
            .from(worldShowInvitesTable)
            .where(
              and(
                eq(worldShowInvitesTable.eventId, event.id),
                eq(worldShowInvitesTable.inviteeUserId, inviteeUserId),
                or(
                  eq(worldShowInvitesTable.status, SHOW_INVITE_PENDING),
                  eq(worldShowInvitesTable.status, SHOW_INVITE_ACCEPTED),
                ),
              ),
            );
          existingPending = standing.some((r) => r.status === SHOW_INVITE_PENDING);
          existingAccepted = standing.some((r) => r.status === SHOW_INVITE_ACCEPTED);
        }
      }
      const decision = decideShowInviteCreate({
        event: event ?? null,
        callerUserId,
        inviteeUserId: inviteeRaw,
        inviteeProfile,
        existingPending,
        existingAccepted,
        now: new Date(),
      });
      if (!decision.ok) {
        res.status(decision.status).json({ error: decision.error });
        return;
      }
      /* decision.ok only ever rules for the caller's own standing
       * show and a real member — both facts are in hand. */
      const show = event as EventRow;
      const member = inviteeProfile!;
      const [hostProfile] = await db
        .select({
          displayName: creatorProfilesTable.displayName,
          avatarUrl: creatorProfilesTable.avatarUrl,
        })
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.userId, callerUserId))
        .limit(1);
      const hostFacts = hostProfile
        ? { displayName: hostProfile.displayName, avatarUrl: hostProfile.avatarUrl ?? null }
        : null;
      let row: ShowInviteRow;
      try {
        const inserted = await db
          .insert(worldShowInvitesTable)
          .values({
            eventId: show.id,
            eventTitle: show.title,
            eventKind: show.kind,
            roomId: show.roomId,
            startsAt: show.startsAt,
            endsAt: show.endsAt,
            inviterUserId: callerUserId,
            inviteeUserId,
            status: SHOW_INVITE_PENDING,
          })
          .returning();
        row = inserted[0]!;
      } catch (err) {
        /* The one-pending index is the race-proof half of the
         * duplicate rule: a create that lost the race reads exactly
         * like the refusal the decider would have given. */
        if (isUniqueViolation(err)) {
          res.status(409).json({
            error: `Your invite to ${member.displayName} is already out — it's still waiting on them.`,
          });
          return;
        }
        throw err;
      }
      await notifyShowInviteCreated({
        inviteeUserId,
        inviterName: hostFacts?.displayName ?? "A creator",
        eventTitle: show.title,
        eventKind: show.kind,
        roomLabel: roomLabelFor(show.roomId, hostFacts?.displayName ?? null),
      });
      res.status(201).json(
        await refreshSupabaseStorageUrlsDeep({ invite: showInviteDto(row, hostFacts) }),
      );
    } catch (err) {
      logger.error({ err }, "[world] show invite create failed");
      res.status(500).json({ error: "Couldn't send that invite. Try again." });
    }
  },
);

/* ── Mine ─────────────────────────────────────────────────────────── */

router.get(
  "/world/show-invites/mine",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    try {
      const callerUserId = req.userId!;
      const rows = await db
        .select()
        .from(worldShowInvitesTable)
        .where(
          and(
            eq(worldShowInvitesTable.inviteeUserId, callerUserId),
            or(
              eq(worldShowInvitesTable.status, SHOW_INVITE_PENDING),
              eq(worldShowInvitesTable.status, SHOW_INVITE_ACCEPTED),
            ),
          ),
        )
        .orderBy(desc(worldShowInvitesTable.createdAt))
        .limit(SHOW_INVITE_LIST_LIMIT);
      /* The hosts' public facts, one read for every host named. */
      const hostIds = [...new Set(rows.map((r) => r.inviterUserId))];
      const hosts =
        hostIds.length > 0
          ? await db
              .select({
                userId: creatorProfilesTable.userId,
                displayName: creatorProfilesTable.displayName,
                avatarUrl: creatorProfilesTable.avatarUrl,
              })
              .from(creatorProfilesTable)
              .where(inArray(creatorProfilesTable.userId, hostIds))
          : [];
      const hostById = new Map(hosts.map((hp) => [hp.userId, hp]));
      const dtos = rows.map((r) => {
        const host = hostById.get(r.inviterUserId);
        return showInviteDto(
          r,
          host
            ? { displayName: host.displayName, avatarUrl: host.avatarUrl ?? null }
            : null,
        );
      });
      res.json(
        await refreshSupabaseStorageUrlsDeep({
          pending: dtos.filter((d) => d.status === SHOW_INVITE_PENDING),
          accepted: dtos.filter((d) => d.status === SHOW_INVITE_ACCEPTED),
        }),
      );
    } catch (err) {
      logger.error({ err }, "[world] show invites mine failed");
      res.status(500).json({ error: "Couldn't load your invites. Try again." });
    }
  },
);

/* ── Answer ───────────────────────────────────────────────────────── */

/** One answer to an invite (accept or decline): the guards are the
 *  decider's, the exactly-once is the conditional update's — only
 *  a row still pending flips, and only the flip's winner proceeds
 *  (to the accept bell; decline proceeds to silence). An accept
 *  first re-reads the show: its standing at answer time is the
 *  decider's last fact. */
async function respondToShowInvite(
  req: Request,
  res: Response,
  answer: typeof SHOW_INVITE_ACCEPTED | "declined",
): Promise<void> {
  const callerUserId = req.userId!;
  const id = String(req.params["id"] ?? "");
  const [invite] = UUID_SHAPE.test(id)
    ? await db
        .select()
        .from(worldShowInvitesTable)
        .where(eq(worldShowInvitesTable.id, id))
        .limit(1)
    : [];
  let eventStanding: ShowStanding = "standing";
  if (invite && answer === SHOW_INVITE_ACCEPTED) {
    const [event] = await db
      .select({
        status: worldEventsTable.status,
        endsAt: worldEventsTable.endsAt,
      })
      .from(worldEventsTable)
      .where(eq(worldEventsTable.id, invite.eventId))
      .limit(1);
    eventStanding = showStandingFor(event ?? null, new Date());
  }
  const decision = decideShowInviteRespond({
    invite: invite ?? null,
    callerUserId,
    answer,
    eventStanding,
  });
  if (!decision.ok) {
    res.status(decision.status).json({ error: decision.error });
    return;
  }
  const updated = await db
    .update(worldShowInvitesTable)
    .set({ status: answer, respondedAt: new Date() })
    .where(
      and(
        eq(worldShowInvitesTable.id, id),
        eq(worldShowInvitesTable.status, SHOW_INVITE_PENDING),
      ),
    )
    .returning();
  if (updated.length === 0) {
    /* Lost the race to the same answer a moment ago — the words
     * are the decider's already-answered refusal. */
    res.status(409).json({ error: "You've already answered that invite — nothing left to decide." });
    return;
  }
  const row = updated[0]!;
  if (answer === "declined") {
    /* Silent by design: no bell for a no. */
    res.json({ ok: true });
    return;
  }
  const [hostProfile] = await db
    .select({
      displayName: creatorProfilesTable.displayName,
      avatarUrl: creatorProfilesTable.avatarUrl,
    })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, row.inviterUserId))
    .limit(1);
  const [inviteeProfile] = await db
    .select({ displayName: creatorProfilesTable.displayName })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, callerUserId))
    .limit(1);
  await notifyShowInviteAccepted({
    inviterUserId: row.inviterUserId,
    inviteeName: inviteeProfile?.displayName ?? "A member",
    eventTitle: row.eventTitle,
  });
  res.json(
    await refreshSupabaseStorageUrlsDeep({
      invite: showInviteDto(
        row,
        hostProfile
          ? { displayName: hostProfile.displayName, avatarUrl: hostProfile.avatarUrl ?? null }
          : null,
      ),
    }),
  );
}

router.post(
  "/world/show-invites/:id/accept",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    try {
      await respondToShowInvite(req, res, SHOW_INVITE_ACCEPTED);
    } catch (err) {
      logger.error({ err }, "[world] show invite accept failed");
      res.status(500).json({ error: "Couldn't answer that invite. Try again." });
    }
  },
);

router.post(
  "/world/show-invites/:id/decline",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    try {
      await respondToShowInvite(req, res, "declined");
    } catch (err) {
      logger.error({ err }, "[world] show invite decline failed");
      res.status(500).json({ error: "Couldn't answer that invite. Try again." });
    }
  },
);

export default router;
