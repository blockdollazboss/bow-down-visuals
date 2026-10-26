import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  db,
  creatorProfilesTable,
  supporterBoardOptOutsTable,
  supporterBoardSettingsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { resolveOptionalSession } from "../lib/optional-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import {
  SUPPORTER_BOARD_COPY,
  SUPPORTER_BOARD_NOT_READY,
  isMissingSupporterBoardTable,
  sanitizePerksText,
  supporterPeriodWindow,
  supporterStanding,
  type SupporterPeriod,
} from "../lib/supporter-board";
import { loadSupporterBoard, loadSupporterSettings } from "../lib/supporter-board-db";

/* ─── Top-Supporter Recognition (Wave-4 #49 + N6 Front Row Boards) ─────
   A per-creator supporter board docked on the creator's public profile
   (no standalone page), ranked at read time from REAL ledgers only —
   see lib/supporter-board-db.ts for the source filters (the Fan
   Graph's own). Period-based: "this month" by default, "all" for all
   time; the basis string is generated from the period window so it can
   never be mislabeled.

   GET  /api/supporter-board/by-slug/:slug?period=month|all
        Public. Respects the creator's on/off switch: a board that is
        off answers enabled:false with no entries and no perks. A
        signed-in viewer's own standing + opt-out state ride along
        (viewer) — their standing exists only where the board is on.
   GET  /api/supporter-board/me/settings        creator controls (auth)
   PUT  /api/supporter-board/me/settings        { enabled?, perksText? }
   POST /api/supporter-board/by-slug/:slug/opt-out   leave a board (auth)
   POST /api/supporter-board/by-slug/:slug/opt-in    rejoin a board (auth)

   Recognition only: nothing here moves Visual Bucs or charges anyone.
   Until provisional migration 9999 lands, settings/opt-out WRITES
   answer an honest 503 (SUPPORTER_BOARD_NOT_READY) and reads degrade
   to house defaults — the same discipline as co-posts. */

const router = Router();

const periodSchema = z.enum(["month", "all"]).optional();

async function optionalAuth(req: Request, _res: Response, next: () => void) {
  await resolveOptionalSession(req);
  next();
}

async function publicCreatorBySlug(slug: string) {
  const rows = await db
    .select({
      userId: creatorProfilesTable.userId,
      slug: creatorProfilesTable.slug,
      displayName: creatorProfilesTable.displayName,
      avatarUrl: creatorProfilesTable.avatarUrl,
    })
    .from(creatorProfilesTable)
    .where(and(eq(creatorProfilesTable.slug, slug), eq(creatorProfilesTable.isPublic, true)))
    .limit(1);
  return rows[0] ?? null;
}

router.get("/supporter-board/by-slug/:slug", publicApiLimiter, optionalAuth, async (req, res) => {
  const parsedPeriod = periodSchema.safeParse(req.query.period);
  if (!parsedPeriod.success) {
    res.status(400).json({ error: "Invalid period — use month or all." });
    return;
  }
  const period: SupporterPeriod = parsedPeriod.data ?? "month";
  try {
    const creator = await publicCreatorBySlug(req.params.slug);
    if (!creator) {
      res.status(404).json({ error: "Creator not found." });
      return;
    }
    const window = supporterPeriodWindow(period);
    const { settings, entries, optedOutUserIds } = await loadSupporterBoard(creator.userId, window);
    const viewerId = req.userId ?? null;
    const standing = viewerId
      ? supporterStanding(entries, viewerId, optedOutUserIds.has(viewerId))
      : null;
    res.json({
      creator: { slug: creator.slug, displayName: creator.displayName, avatarUrl: creator.avatarUrl },
      enabled: settings.enabled,
      period,
      periodLabel: window.label,
      basis: window.basis,
      window: { startAt: window.startAt, endAt: window.endAt },
      perksText: settings.enabled ? settings.perksText : "",
      entries: settings.enabled ? entries : [],
      empty: settings.enabled && entries.length === 0,
      emptyCopy: period === "month" ? SUPPORTER_BOARD_COPY.emptyMonth : SUPPORTER_BOARD_COPY.emptyAll,
      copy: {
        rankedFromRealSupport: SUPPORTER_BOARD_COPY.rankedFromRealSupport,
        x100Explainer: SUPPORTER_BOARD_COPY.x100Explainer,
        optOut: SUPPORTER_BOARD_COPY.optOut,
        boardOff: SUPPORTER_BOARD_COPY.boardOff,
      },
      viewer: viewerId
        ? {
            userId: viewerId,
            isCreator: viewerId === creator.userId,
            standing: settings.enabled && standing ? standing.entry : null,
            optedOut: standing ? standing.optedOut : false,
          }
        : null,
    });
  } catch (err) {
    req.log?.error({ err }, "supporter board load failed");
    res.status(500).json({ error: "Couldn't load the supporter board." });
  }
});

router.get("/supporter-board/me/settings", requireAuth, async (req, res) => {
  try {
    const { settings, ready } = await loadSupporterSettings(req.userId!);
    res.json({ enabled: settings.enabled, perksText: settings.perksText, ready });
  } catch (err) {
    req.log?.error({ err }, "supporter board settings load failed");
    res.status(500).json({ error: "Couldn't load your supporter board settings." });
  }
});

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  perksText: z.string().max(4000).optional(),
});

router.put("/supporter-board/me/settings", requireAuth, async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid supporter board settings." });
    return;
  }
  try {
    const { settings: current } = await loadSupporterSettings(req.userId!);
    const enabled = parsed.data.enabled ?? current.enabled;
    const perksText = parsed.data.perksText !== undefined ? sanitizePerksText(parsed.data.perksText) : current.perksText;
    await db
      .insert(supporterBoardSettingsTable)
      .values({ creatorUserId: req.userId!, enabled, perksText, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: supporterBoardSettingsTable.creatorUserId,
        set: { enabled, perksText, updatedAt: new Date() },
      });
    res.json({ enabled, perksText });
  } catch (err) {
    if (isMissingSupporterBoardTable(err)) {
      res.status(503).json(SUPPORTER_BOARD_NOT_READY);
      return;
    }
    req.log?.error({ err }, "supporter board settings save failed");
    res.status(500).json({ error: "Couldn't save your supporter board settings." });
  }
});

async function setOptOut(req: Request, res: Response, optedOut: boolean) {
  try {
    const creator = await publicCreatorBySlug(req.params.slug);
    if (!creator) {
      res.status(404).json({ error: "Creator not found." });
      return;
    }
    if (creator.userId === req.userId) {
      res.status(400).json({ error: "You can't opt out of your own board — turn it off in your board settings instead." });
      return;
    }
    if (optedOut) {
      await db
        .insert(supporterBoardOptOutsTable)
        .values({ creatorUserId: creator.userId, fanUserId: req.userId! })
        .onConflictDoNothing();
    } else {
      await db
        .delete(supporterBoardOptOutsTable)
        .where(
          and(
            eq(supporterBoardOptOutsTable.creatorUserId, creator.userId),
            eq(supporterBoardOptOutsTable.fanUserId, req.userId!),
          ),
        );
    }
    res.json({ optedOut, copy: SUPPORTER_BOARD_COPY.optOut });
  } catch (err) {
    if (isMissingSupporterBoardTable(err)) {
      res.status(503).json(SUPPORTER_BOARD_NOT_READY);
      return;
    }
    req.log?.error({ err }, "supporter board opt-out failed");
    res.status(500).json({ error: "Couldn't update your board preference." });
  }
}

router.post("/supporter-board/by-slug/:slug/opt-out", requireAuth, async (req, res) => {
  await setOptOut(req, res, true);
});
router.post("/supporter-board/by-slug/:slug/opt-in", requireAuth, async (req, res) => {
  await setOptOut(req, res, false);
});

export default router;
