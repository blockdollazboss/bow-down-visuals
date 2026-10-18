/**
 * world-events.ts — The palace calendar over REST (World Events,
 * migration 0145):
 *
 *   POST   /api/world/events          book a slot (auth; booking
 *                                     rules enforced server-side)
 *   GET    /api/world/events          the public slate: live +
 *                                     upcoming, soonest first (the
 *                                     board/directory read)
 *   GET    /api/world/events/mine     the caller's own bookings
 *   DELETE /api/world/events/:id      cancel (host or admin)
 *
 * The rules (owner-approved defaults — see lib/world-events for the
 * full note): a stage_show books the Throne Hall and only Front Row
 * members (the King's court — server truth via isKingFrontRowMember)
 * or an admin may hold one; a listening_party books the Music Hall
 * and any member may hold one; a drop spectacle may land in any
 * palace room and is admin-only; office_hours anchor to the host's
 * OWN creator room ("creator:<their slug>", read off their profile
 * server-side) and the profile must be public — a private profile's
 * room isn't open. One room, one event at a time: overlapping
 * bookings in the same room conflict (409).
 *
 * The events themselves are RUN by the scheduler tick in
 * lib/world-events (started from routes/world.ts) — this file only
 * writes and reads rows. Cancelling a LIVE event marks the row; the
 * tick releases its room state within one interval.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, worldEventsTable, creatorProfilesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  PALACE_ROOM_DEFS,
  creatorRoomIdForSlug,
  creatorSlugFromRoomId,
} from "../lib/world-palace";
import {
  bookingRuleFor,
  isKingFrontRowMember,
  sanitizeEventPayload,
  toWorldEventDto,
  windowError,
  windowsOverlap,
} from "../lib/world-events";
import { isWorldAdminEmail } from "./world";
import type { WorldEventKind } from "@workspace/db";

const router = Router();

const PALACE_ROOM_IDS = new Set(PALACE_ROOM_DEFS.map((r) => r.roomId));
const ROOM_NAMES = new Map(PALACE_ROOM_DEFS.map((r) => [r.roomId, r.name]));

const createSchema = z.object({
  kind: z.enum(["stage_show", "listening_party", "drop", "office_hours"]),
  roomId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(120),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  payload: z.unknown(),
});

type EventRow = typeof worldEventsTable.$inferSelect;

async function hostNames(userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return names;
  const rows = await db
    .select({
      userId: creatorProfilesTable.userId,
      displayName: creatorProfilesTable.displayName,
    })
    .from(creatorProfilesTable)
    .where(inArray(creatorProfilesTable.userId, unique));
  for (const r of rows) names.set(r.userId, r.displayName);
  return names;
}

function byStart(a: EventRow, b: EventRow): number {
  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
}

/* ── Book a slot ──────────────────────────────────────────────────── */

router.post("/world/events", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_EVENT", message: "Send kind, roomId, title, startsAt, endsAt and a payload." });
    return;
  }
  try {
    const userId = req.userId!;
    const kind = parsed.data.kind as WorldEventKind;
    const { roomId, title } = parsed.data;
    const startsAt = new Date(parsed.data.startsAt);
    const endsAt = new Date(parsed.data.endsAt);
    const isAdmin = isWorldAdminEmail(req.userEmail);

    const rule = bookingRuleFor(kind);
    if (rule.roomKind === "own-creator-room") {
      /* Office hours: the room is the CALLER'S creator room. The
       * slug is read off their profile server-side — submitting a
       * room id is never proof it's yours. */
      if (!creatorSlugFromRoomId(roomId)) {
        res.status(400).json({
          error: "UNKNOWN_ROOM",
          message: "Office hours are held in a creator room — that room id isn't one.",
        });
        return;
      }
      const [profile] = await db
        .select({
          slug: creatorProfilesTable.slug,
          isPublic: creatorProfilesTable.isPublic,
        })
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.userId, userId))
        .limit(1);
      if (!profile) {
        res.status(403).json({
          error: "NO_CREATOR_ROOM",
          message: "Office hours live in your Creator Room — set up your creator profile first.",
        });
        return;
      }
      if (roomId !== creatorRoomIdForSlug(profile.slug)) {
        res.status(403).json({
          error: "NOT_YOUR_ROOM",
          message: "Office hours are held in your own room — that room belongs to another creator.",
        });
        return;
      }
      if (!profile.isPublic) {
        res.status(400).json({
          error: "ROOM_NOT_OPEN",
          message: "Your room isn't open while your profile is private — make it public to hold office hours.",
        });
        return;
      }
    } else {
      if (!PALACE_ROOM_IDS.has(roomId)) {
        res.status(400).json({ error: "UNKNOWN_ROOM", message: "That room isn't in the palace." });
        return;
      }
      if (rule.requiredRoomId && rule.requiredRoomId !== roomId) {
        res.status(400).json({
          error: "ROOM_MISMATCH",
          message: `That kind of event belongs in ${ROOM_NAMES.get(rule.requiredRoomId) ?? rule.requiredRoomId}.`,
        });
        return;
      }
    }
    /* Privilege — the booking rules, enforced here, server-side.
     * A denial names the standing that's missing; nothing about the
     * check is a client claim. */
    if (rule.privilege === "admin" && !isAdmin) {
      res.status(403).json({
        error: "ADMIN_REQUIRED",
        message: "Drop spectacles are booked by the house.",
      });
      return;
    }
    if (rule.privilege === "front-row-or-admin" && !isAdmin) {
      const frontRow = await isKingFrontRowMember(userId).catch(() => false);
      if (!frontRow) {
        res.status(403).json({
          error: "FRONT_ROW_REQUIRED",
          message: "Throne Hall stage slots are booked by Front Row members and the house.",
        });
        return;
      }
    }

    const winErr = windowError(startsAt, endsAt, new Date());
    if (winErr) {
      res.status(400).json({ error: "INVALID_WINDOW", message: winErr });
      return;
    }
    const payload = sanitizeEventPayload(kind, parsed.data.payload);
    if (!payload.ok) {
      res.status(400).json({ error: "INVALID_PAYLOAD", message: payload.error });
      return;
    }

    /* One room, one event at a time: any live or scheduled event in
     * the same room whose window overlaps refuses the booking.
     * Contests are exempt: a contest is a standing competition on
     * the room's board, not a stage booking — its days-long entry
     * window must never lock the stage (routes/world-contests). */
    const roomEvents = await db
      .select()
      .from(worldEventsTable)
      .where(
        and(
          eq(worldEventsTable.roomId, roomId),
          inArray(worldEventsTable.status, ["scheduled", "live"]),
          ne(worldEventsTable.kind, "contest"),
        ),
      );
    const conflict = roomEvents.find((e) =>
      windowsOverlap(startsAt, endsAt, new Date(e.startsAt), new Date(e.endsAt)),
    );
    if (conflict) {
      res.status(409).json({
        error: "SLOT_TAKEN",
        message: "That room already has an event in that window.",
        conflictId: conflict.id,
      });
      return;
    }

    const [row] = await db
      .insert(worldEventsTable)
      .values({
        kind,
        roomId,
        hostUserId: userId,
        title,
        startsAt,
        endsAt,
        payload: payload.payload,
        status: "scheduled",
      })
      .returning();
    if (!row) {
      res.status(500).json({ error: "Couldn't book that event. Try again." });
      return;
    }
    const names = await hostNames([userId]);
    res.status(201).json({ event: toWorldEventDto(row, names.get(userId) ?? "Creator") });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[world-events] booking failed");
    res.status(500).json({ error: "Couldn't book that event. Try again." });
  }
});

/* ── The public slate ─────────────────────────────────────────────── */

router.get("/world/events", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const roomId = typeof req.query["roomId"] === "string" ? req.query["roomId"] : null;
    if (roomId && !PALACE_ROOM_IDS.has(roomId) && !creatorSlugFromRoomId(roomId)) {
      res.status(400).json({ error: "UNKNOWN_ROOM", message: "That room isn't in the palace." });
      return;
    }
    const now = Date.now();
    const rows = await db
      .select()
      .from(worldEventsTable)
      .where(
        and(
          inArray(worldEventsTable.status, ["scheduled", "live"]),
          ...(roomId ? [eq(worldEventsTable.roomId, roomId)] : []),
        ),
      );
    const upcoming = rows
      .filter((r) => new Date(r.endsAt).getTime() > now)
      .sort(byStart);
    const names = await hostNames(upcoming.map((r) => r.hostUserId));
    res.json({
      events: upcoming.map((r) => toWorldEventDto(r, names.get(r.hostUserId) ?? "Creator")),
    });
  } catch (err) {
    logger.error({ err }, "[world-events] slate read failed");
    res.status(500).json({ error: "Couldn't load the palace calendar. Try again." });
  }
});

/* ── Mine ─────────────────────────────────────────────────────────── */

router.get("/world/events/mine", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const rows = await db
      .select()
      .from(worldEventsTable)
      .where(eq(worldEventsTable.hostUserId, userId));
    const names = await hostNames([userId]);
    res.json({
      events: [...rows].sort(byStart).map((r) => toWorldEventDto(r, names.get(userId) ?? "Creator")),
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[world-events] mine read failed");
    res.status(500).json({ error: "Couldn't load your bookings. Try again." });
  }
});

/* ── Cancel ───────────────────────────────────────────────────────── */

router.delete("/world/events/:id", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const id = String(req.params["id"] ?? "");
    const [row] = await db
      .select()
      .from(worldEventsTable)
      .where(eq(worldEventsTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "NOT_FOUND", message: "No such event." });
      return;
    }
    const isAdmin = isWorldAdminEmail(req.userEmail);
    if (row.hostUserId !== userId && !isAdmin) {
      res.status(403).json({ error: "NOT_YOURS", message: "Only the host or the house can cancel an event." });
      return;
    }
    if (row.status === "done" || row.status === "cancelled") {
      res.status(409).json({ error: "ALREADY_OVER", message: "That event is already over." });
      return;
    }
    const [updated] = await db
      .update(worldEventsTable)
      .set({ status: "cancelled" })
      .where(eq(worldEventsTable.id, id))
      .returning();
    const names = await hostNames([row.hostUserId]);
    res.json({
      event: toWorldEventDto(updated ?? { ...row, status: "cancelled" }, names.get(row.hostUserId) ?? "Creator"),
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[world-events] cancel failed");
    res.status(500).json({ error: "Couldn't cancel that event. Try again." });
  }
});

export default router;
