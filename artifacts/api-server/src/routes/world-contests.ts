/**
 * world-contests.ts — World Contests + the Winners' Circle over
 * REST (UPGRADE-PROGRAM 2.24, migration 0158; policy in
 * lib/world-contests):
 *
 *   POST /api/world/contests              host a contest (auth;
 *                                         stage rule server-side)
 *   GET  /api/world/contests              the contest board:
 *                                         open, judging and decided
 *                                         contests (public)
 *   GET  /api/world/contests/:id          one contest, its entries
 *                                         and its winners (public)
 *   POST /api/world/contests/:id/entries  enter one of your own
 *                                         published works (auth)
 *   POST /api/world/contests/:id/winners  the host (or the house)
 *                                         names the winners (auth)
 *   GET  /api/world/winners-circle        every honor on record,
 *                                         newest first (public)
 *
 * A contest IS a world_events row (kind 'contest') — this file
 * writes those rows plus the entries/winners tables; the events
 * scheduler flips the row's status with its window, and the
 * generic events route's cancel (DELETE /api/world/events/:id)
 * already serves as the host's call-off. Judging is a named
 * human's pick, never a computed score; no Visual Bucs move.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  worldEventsTable,
  worldContestEntriesTable,
  worldContestWinnersTable,
  creatorProfilesTable,
  profileTracksTable,
  profileVideosTable,
  CONTEST_MAX_PLACES,
  type WorldEvent as WorldEventRow,
  type WorldContestEntry as ContestEntryRow,
  type WorldContestWinner as ContestWinnerRow,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { isKingFrontRowMember, sanitizeEventPayload } from "../lib/world-events";
import { isUniqueViolation as isPgUniqueViolation } from "../lib/pg-errors";
import { heraldContestWinners } from "../lib/operator-duties";
import {
  contestAcceptsEntries,
  contestDeadlineError,
  contestPhase,
  contestPrivilegeForRoom,
  contestWinnersAnnouncement,
  isContestRoom,
  toContestWinnerDto,
  toWinnersCircleHonorDto,
  type WorldContestDto,
  type WorldContestEntryDto,
} from "../lib/world-contests";
import { isWorldAdminEmail } from "./world";

const router = Router();

/* ── Shared reads ───────────────────────────────────────────────── */

type ProfileLite = { id: string; userId: string; displayName: string };

async function profileOf(userId: string): Promise<ProfileLite | null> {
  const [profile] = await db
    .select({
      id: creatorProfilesTable.id,
      userId: creatorProfilesTable.userId,
      displayName: creatorProfilesTable.displayName,
    })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return profile ?? null;
}

async function profilesByUserIds(userIds: string[]): Promise<Map<string, ProfileLite>> {
  const map = new Map<string, ProfileLite>();
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return map;
  const rows = await db
    .select({
      id: creatorProfilesTable.id,
      userId: creatorProfilesTable.userId,
      displayName: creatorProfilesTable.displayName,
    })
    .from(creatorProfilesTable)
    .where(inArray(creatorProfilesTable.userId, unique));
  for (const r of rows) map.set(r.userId, r);
  return map;
}

/** Work titles for a set of entries/winners, resolved against the
 *  works' own tables (entries point; titles are read live for the
 *  board — the WINNERS table carries its own frozen snapshots). */
async function workTitles(
  refs: readonly { workKind: string; workId: string }[],
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const trackIds = [...new Set(refs.filter((r) => r.workKind === "track").map((r) => r.workId))];
  const videoIds = [...new Set(refs.filter((r) => r.workKind === "video").map((r) => r.workId))];
  if (trackIds.length > 0) {
    const rows = await db
      .select({ id: profileTracksTable.id, title: profileTracksTable.title })
      .from(profileTracksTable)
      .where(inArray(profileTracksTable.id, trackIds));
    for (const r of rows) titles.set(`track:${r.id}`, r.title);
  }
  if (videoIds.length > 0) {
    const rows = await db
      .select({ id: profileVideosTable.id, title: profileVideosTable.title })
      .from(profileVideosTable)
      .where(inArray(profileVideosTable.id, videoIds));
    for (const r of rows) titles.set(`video:${r.id}`, r.title);
  }
  return titles;
}

async function contestRow(id: string): Promise<WorldEventRow | null> {
  const [row] = await db
    .select()
    .from(worldEventsTable)
    .where(and(eq(worldEventsTable.id, id), eq(worldEventsTable.kind, "contest")))
    .limit(1);
  return row ?? null;
}

async function entriesOf(eventId: string): Promise<ContestEntryRow[]> {
  const rows = await db
    .select()
    .from(worldContestEntriesTable)
    .where(eq(worldContestEntriesTable.eventId, eventId));
  return [...rows].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

async function winnersOf(eventId: string): Promise<ContestWinnerRow[]> {
  const rows = await db
    .select()
    .from(worldContestWinnersTable)
    .where(eq(worldContestWinnersTable.eventId, eventId));
  return [...rows].sort((a, b) => a.place - b.place);
}

function themeOf(row: WorldEventRow): string {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return typeof payload["theme"] === "string" ? payload["theme"] : "";
}

function toDto(
  row: WorldEventRow,
  hostName: string,
  entryCount: number,
  winners: ContestWinnerRow[],
  now: Date,
): WorldContestDto {
  return {
    id: row.id,
    title: row.title,
    theme: themeOf(row),
    roomId: row.roomId,
    hostUserId: row.hostUserId,
    hostName,
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: new Date(row.endsAt).toISOString(),
    status: row.status,
    phase: contestPhase(row, now, winners.length > 0),
    entryCount,
    winners: winners.map(toContestWinnerDto),
  };
}

/** Is this Postgres' unique-violation (the raced twin of a friendly
 *  pre-check)? Delegates to the shared chain-walking helper — drizzle
 *  wraps the pg error, so the 23505 rides on .cause, never top-level
 *  (see lib/pg-errors). */
function isUniqueViolation(err: unknown): boolean {
  return isPgUniqueViolation(err);
}

/* ── Host a contest ─────────────────────────────────────────────── */

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  theme: z.string().trim().min(1).max(140),
  roomId: z.string().min(1).max(64),
  endsAt: z.string().datetime(),
});

router.post("/world/contests", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_CONTEST",
      message: "Send a title, a theme, a stage (roomId) and a deadline (endsAt).",
    });
    return;
  }
  try {
    const userId = req.userId!;
    const { title, roomId } = parsed.data;
    const endsAt = new Date(parsed.data.endsAt);
    const now = new Date();

    if (!isContestRoom(roomId)) {
      res.status(400).json({
        error: "NOT_A_STAGE",
        message: "Contests run on a stage: the Throne Hall or the Music Hall.",
      });
      return;
    }
    /* The stage's hosting rule (lib/world-contests): the Throne
     * Hall's contests belong to the Front Row and the house; the
     * Music Hall's to any member. Server truth, never a claim. */
    const privilege = contestPrivilegeForRoom(roomId);
    if (privilege === "front-row-or-admin" && !isWorldAdminEmail(req.userEmail)) {
      const frontRow = await isKingFrontRowMember(userId).catch(() => false);
      if (!frontRow) {
        res.status(403).json({
          error: "FRONT_ROW_REQUIRED",
          message: "Throne Hall contests are hosted by Front Row members and the house.",
        });
        return;
      }
    }
    const deadlineErr = contestDeadlineError(now, endsAt);
    if (deadlineErr) {
      res.status(400).json({ error: "INVALID_DEADLINE", message: deadlineErr });
      return;
    }
    const payload = sanitizeEventPayload("contest", { theme: parsed.data.theme });
    if (!payload.ok) {
      res.status(400).json({ error: "INVALID_PAYLOAD", message: payload.error });
      return;
    }

    const [row] = await db
      .insert(worldEventsTable)
      .values({
        kind: "contest",
        roomId,
        hostUserId: userId,
        title,
        startsAt: now,
        endsAt,
        payload: payload.payload,
        status: "scheduled",
      })
      .returning();
    if (!row) {
      res.status(500).json({ error: "Couldn't open that contest. Try again." });
      return;
    }
    const host = await profileOf(userId);
    res.status(201).json({ contest: toDto(row, host?.displayName ?? "Creator", 0, [], now) });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[world-contests] hosting failed");
    res.status(500).json({ error: "Couldn't open that contest. Try again." });
  }
});

/* ── The contest board (public) ─────────────────────────────────── */

router.get("/world/contests", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const rows = await db
      .select()
      .from(worldEventsTable)
      .where(eq(worldEventsTable.kind, "contest"));
    const visible = rows.filter((r) => r.status !== "cancelled");
    const ids = visible.map((r) => r.id);

    const allEntries =
      ids.length > 0
        ? await db
            .select()
            .from(worldContestEntriesTable)
            .where(inArray(worldContestEntriesTable.eventId, ids))
        : [];
    const allWinners =
      ids.length > 0
        ? await db
            .select()
            .from(worldContestWinnersTable)
            .where(inArray(worldContestWinnersTable.eventId, ids))
        : [];
    const hosts = await profilesByUserIds(visible.map((r) => r.hostUserId));

    const counts = new Map<string, number>();
    for (const e of allEntries) counts.set(e.eventId, (counts.get(e.eventId) ?? 0) + 1);
    const winnersByEvent = new Map<string, ContestWinnerRow[]>();
    for (const w of allWinners) {
      const list = winnersByEvent.get(w.eventId) ?? [];
      list.push(w);
      winnersByEvent.set(w.eventId, list);
    }

    const contests = visible.map((row) =>
      toDto(
        row,
        hosts.get(row.hostUserId)?.displayName ?? "Creator",
        counts.get(row.id) ?? 0,
        (winnersByEvent.get(row.id) ?? []).sort((a, b) => a.place - b.place),
        now,
      ),
    );
    /* The board reads: taking entries first (deadline soonest),
     * then with the judges, then the decided — newest honors last
     * in this list; the Circle carries them newest-first. */
    const phaseRank = { open: 0, announced: 0, judging: 1, decided: 2, "called-off": 3 } as const;
    contests.sort((a, b) => {
      const rank = phaseRank[a.phase] - phaseRank[b.phase];
      if (rank !== 0) return rank;
      return a.phase === "decided"
        ? new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime()
        : new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime();
    });
    res.json({ contests });
  } catch (err) {
    logger.error({ err }, "[world-contests] board read failed");
    res.status(500).json({ error: "Couldn't load the contests. Try again." });
  }
});

/* ── The caller's own works (the entry picker's read) ───────────── */

/**
 * GET /api/world/contests/my-works — the signed-in member's own
 * profile works (tracks + videos), published or not, in the
 * my-music precedent's shape: the entry picker shows unpublished
 * works disabled with the reason ("publish it first") instead of
 * hiding them, and the entries route re-verifies everything
 * server-side regardless of what the picker showed. A member with
 * no creator profile gets an honest empty list.
 */
router.get(
  "/world/contests/my-works",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    try {
      const profile = await profileOf(req.userId!);
      if (!profile) {
        res.json({ works: [] });
        return;
      }
      const [tracks, videos] = await Promise.all([
        db
          .select({
            id: profileTracksTable.id,
            title: profileTracksTable.title,
            isPublished: profileTracksTable.isPublished,
          })
          .from(profileTracksTable)
          .where(eq(profileTracksTable.profileId, profile.id)),
        db
          .select({
            id: profileVideosTable.id,
            title: profileVideosTable.title,
            isPublished: profileVideosTable.isPublished,
          })
          .from(profileVideosTable)
          .where(eq(profileVideosTable.profileId, profile.id)),
      ]);
      const works = [
        ...tracks.map((t) => ({ id: t.id, workKind: "track" as const, title: t.title, isPublished: t.isPublished })),
        ...videos.map((v) => ({ id: v.id, workKind: "video" as const, title: v.title, isPublished: v.isPublished })),
      ].sort((a, b) =>
        a.isPublished === b.isPublished ? a.title.localeCompare(b.title) : a.isPublished ? -1 : 1,
      );
      res.json({ works });
    } catch (err) {
      logger.error({ err, userId: req.userId }, "[world-contests] my-works read failed");
      res.status(500).json({ error: "Couldn't load your works. Try again." });
    }
  },
);

/* ── One contest, its entries + winners (public) ────────────────── */

router.get("/world/contests/:id", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const id = String(req.params["id"] ?? "");
    const row = await contestRow(id);
    if (!row) {
      res.status(404).json({ error: "NOT_FOUND", message: "No such contest." });
      return;
    }
    const now = new Date();
    const [entries, winners] = await Promise.all([entriesOf(id), winnersOf(id)]);
    const hosts = await profilesByUserIds([row.hostUserId, ...entries.map((e) => e.userId)]);
    const titles = await workTitles(entries);
    const contest = toDto(
      row,
      hosts.get(row.hostUserId)?.displayName ?? "Creator",
      entries.length,
      winners,
      now,
    );
    const entryDtos: WorldContestEntryDto[] = entries.map((e) => ({
      id: e.id,
      userId: e.userId,
      entrantName: hosts.get(e.userId)?.displayName ?? "Creator",
      workKind: e.workKind === "video" ? "video" : "track",
      workTitle: titles.get(`${e.workKind}:${e.workId}`) ?? "Untitled work",
      createdAt: new Date(e.createdAt).toISOString(),
    }));
    res.json({ contest, entries: entryDtos });
  } catch (err) {
    logger.error({ err }, "[world-contests] detail read failed");
    res.status(500).json({ error: "Couldn't load that contest. Try again." });
  }
});

/* ── Enter a work ───────────────────────────────────────────────── */

const entrySchema = z.object({
  workKind: z.enum(["track", "video"]),
  workId: z.string().uuid(),
});

router.post(
  "/world/contests/:id/entries",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    const parsed = entrySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "INVALID_ENTRY",
        message: "Send workKind ('track' or 'video') and the work's id.",
      });
      return;
    }
    try {
      const userId = req.userId!;
      const id = String(req.params["id"] ?? "");
      const row = await contestRow(id);
      if (!row) {
        res.status(404).json({ error: "NOT_FOUND", message: "No such contest." });
        return;
      }
      const now = new Date();
      if (row.status === "cancelled") {
        res.status(409).json({
          error: "CONTEST_CALLED_OFF",
          message: "This contest was called off — no entries stand.",
        });
        return;
      }
      if (!contestAcceptsEntries(row, now)) {
        res.status(409).json({
          error: "ENTRIES_CLOSED",
          message: "Entries closed at the deadline — this contest is with the judges now.",
        });
        return;
      }
      /* The work must be the caller's own, and published. Resolved
       * against the caller's profile only: another member's work
       * simply isn't found here (never leaked, never enterable). */
      const profile = await profileOf(userId);
      if (!profile) {
        res.status(403).json({
          error: "NO_PROFILE",
          message: "You need a creator profile to enter a contest.",
        });
        return;
      }
      const { workKind, workId } = parsed.data;
      const work =
        workKind === "track"
          ? (
              await db
                .select({ id: profileTracksTable.id, title: profileTracksTable.title, isPublished: profileTracksTable.isPublished })
                .from(profileTracksTable)
                .where(and(eq(profileTracksTable.id, workId), eq(profileTracksTable.profileId, profile.id)))
                .limit(1)
            )[0]
          : (
              await db
                .select({ id: profileVideosTable.id, title: profileVideosTable.title, isPublished: profileVideosTable.isPublished })
                .from(profileVideosTable)
                .where(and(eq(profileVideosTable.id, workId), eq(profileVideosTable.profileId, profile.id)))
                .limit(1)
            )[0];
      if (!work) {
        res.status(404).json({
          error: "WORK_NOT_FOUND",
          message: "That work isn't on your profile — you can only enter your own work.",
        });
        return;
      }
      if (!work.isPublished) {
        res.status(400).json({
          error: "NOT_PUBLISHED",
          message: "That work isn't published yet — publish it first, then enter it.",
        });
        return;
      }
      const existing = await entriesOf(id);
      if (existing.some((e) => e.userId === userId)) {
        res.status(409).json({
          error: "ALREADY_ENTERED",
          message: "You've already entered this contest — one entry each.",
        });
        return;
      }
      let entry: ContestEntryRow | undefined;
      try {
        [entry] = await db
          .insert(worldContestEntriesTable)
          .values({ eventId: id, userId, workKind, workId })
          .returning();
      } catch (err) {
        if (isUniqueViolation(err)) {
          res.status(409).json({
            error: "ALREADY_ENTERED",
            message: "You've already entered this contest — one entry each.",
          });
          return;
        }
        throw err;
      }
      if (!entry) {
        res.status(500).json({ error: "Couldn't enter that work. Try again." });
        return;
      }
      res.status(201).json({
        entry: {
          id: entry.id,
          userId: entry.userId,
          entrantName: profile.displayName,
          workKind,
          workTitle: work.title,
          createdAt: new Date(entry.createdAt).toISOString(),
        } satisfies WorldContestEntryDto,
      });
    } catch (err) {
      logger.error({ err, userId: req.userId }, "[world-contests] entry failed");
      res.status(500).json({ error: "Couldn't enter that work. Try again." });
    }
  },
);

/* ── Name the winners ───────────────────────────────────────────── */

const winnersSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1).max(CONTEST_MAX_PLACES),
});

router.post(
  "/world/contests/:id/winners",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    const parsed = winnersSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "INVALID_WINNERS",
        message: `Send entryIds: one to ${CONTEST_MAX_PLACES} entries, in podium order (first place first).`,
      });
      return;
    }
    try {
      const userId = req.userId!;
      const id = String(req.params["id"] ?? "");
      const row = await contestRow(id);
      if (!row) {
        res.status(404).json({ error: "NOT_FOUND", message: "No such contest." });
        return;
      }
      const isAdmin = isWorldAdminEmail(req.userEmail);
      if (row.hostUserId !== userId && !isAdmin) {
        res.status(403).json({
          error: "NOT_THE_HOST",
          message: "Only the contest's host or the house names the winners.",
        });
        return;
      }
      if (row.status === "cancelled") {
        res.status(409).json({
          error: "CONTEST_CALLED_OFF",
          message: "This contest was called off — no winners stand.",
        });
        return;
      }
      const now = new Date();
      if (row.status !== "done" && now.getTime() < new Date(row.endsAt).getTime()) {
        res.status(409).json({
          error: "STILL_OPEN",
          message: "Judging opens when the entry window closes.",
        });
        return;
      }
      const already = await winnersOf(id);
      if (already.length > 0) {
        res.status(409).json({
          error: "ALREADY_DECIDED",
          message: "The winners already stand in the Winners' Circle.",
        });
        return;
      }
      const entryIds = [...new Set(parsed.data.entryIds)];
      if (entryIds.length !== parsed.data.entryIds.length) {
        res.status(400).json({
          error: "INVALID_WINNERS",
          message: "Each entry can hold only one place on the podium.",
        });
        return;
      }
      const entries = await entriesOf(id);
      const byId = new Map(entries.map((e) => [e.id, e]));
      const picked = entryIds.map((entryId) => byId.get(entryId));
      if (picked.some((e) => !e)) {
        res.status(400).json({
          error: "ENTRY_NOT_IN_CONTEST",
          message: "Every winner must be an entry in this contest.",
        });
        return;
      }
      const entrants = await profilesByUserIds(picked.map((e) => e!.userId));
      const titles = await workTitles(picked.map((e) => e!));
      const inserted: ContestWinnerRow[] = [];
      try {
        for (const [i, entry] of picked.entries()) {
          const e = entry!;
          const [winner] = await db
            .insert(worldContestWinnersTable)
            .values({
              eventId: id,
              entryId: e.id,
              userId: e.userId,
              place: i + 1,
              winnerName: entrants.get(e.userId)?.displayName ?? "Creator",
              workKind: e.workKind,
              workId: e.workId,
              workTitle: titles.get(`${e.workKind}:${e.workId}`) ?? "Untitled work",
              decidedBy: userId,
            })
            .returning();
          if (winner) inserted.push(winner);
        }
      } catch (err) {
        if (isUniqueViolation(err)) {
          res.status(409).json({
            error: "ALREADY_DECIDED",
            message: "The winners already stand in the Winners' Circle.",
          });
          return;
        }
        throw err;
      }
      const winners = inserted.map(toContestWinnerDto);
      /* The moment, palace-wide — the rows above are the record;
       * the announcement is best-effort and never blocks it. Lane G:
       * the herald is an operator duty now — it sounds through the
       * duty's switch, dedupe, palace-ear cap and audit trail (the
       * duty itself speaks through announceContestWinners). */
      const announcement = contestWinnersAnnouncement(row, winners);
      if (announcement) {
        try {
          await heraldContestWinners({ contest: row, winners, announcement });
        } catch (err) {
          logger.warn({ err, contestId: id }, "[world-contests] winners announcement failed");
        }
      }
      res.status(201).json({ winners });
    } catch (err) {
      logger.error({ err, userId: req.userId }, "[world-contests] judging failed");
      res.status(500).json({ error: "Couldn't record the winners. Try again." });
    }
  },
);

/* ── The Winners' Circle (public) ──────────────────────────────── */

router.get("/world/winners-circle", publicApiLimiter, async (_req: Request, res: Response) => {
  try {
    const winners = await db.select().from(worldContestWinnersTable);
    if (winners.length === 0) {
      res.json({ honors: [] });
      return;
    }
    const contestIds = [...new Set(winners.map((w) => w.eventId))];
    const contests = await db
      .select()
      .from(worldEventsTable)
      .where(inArray(worldEventsTable.id, contestIds));
    const byId = new Map(contests.map((c) => [c.id, c]));
    /* The board reads by DECISION: the newest judging first, and
     * inside one decision the podium in order (1, 2, 3) — raw
     * timestamp order would scramble a podium's places. */
    const byContest = new Map<string, ContestWinnerRow[]>();
    for (const w of winners) {
      if (!byId.has(w.eventId)) continue;
      const list = byContest.get(w.eventId) ?? [];
      list.push(w);
      byContest.set(w.eventId, list);
    }
    const groups = [...byContest.values()]
      .map((list) => ({
        decidedAt: Math.max(...list.map((w) => new Date(w.createdAt).getTime())),
        winners: [...list].sort((a, b) => a.place - b.place),
      }))
      .sort((a, b) => b.decidedAt - a.decidedAt);
    const honors = groups
      .flatMap((g) => g.winners)
      .slice(0, 100)
      .map((w) => toWinnersCircleHonorDto(w, byId.get(w.eventId)!));
    res.json({ honors });
  } catch (err) {
    logger.error({ err }, "[world-contests] winners circle read failed");
    res.status(500).json({ error: "Couldn't load the Winners' Circle. Try again." });
  }
});

export default router;
