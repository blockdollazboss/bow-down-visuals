import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { db, arcadeScoresTable, retentionPrefsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { logger } from "../lib/logger";
import {
  ARCADE_GAMES,
  isArcadeGame,
  validateArcadeScore,
  type ArcadeGame,
} from "../lib/arcade-rules";

const router = Router();

/* ─── Arcade v1 (#6 owner's games pick) ───────────────────────────────────
   POST /api/arcade/scores        — submit a finished run (validated)
   GET  /api/arcade/leaderboard   — ?game=runner|gallery, top 10 bests
   GET  /api/arcade/me            — viewer's best + play count per game

   Scores are STATUS ONLY. No Visual Bucs are minted, moved, or promised
   here: arcade rewards ride the existing Shark Drop rail
   (GET /api/retention/shark-drop + claim), which enforces its own caps
   (≤2 drops per rolling 7 days, 100–500 VB each). Plausibility caps in
   lib/arcade-rules reject scores a real run cannot produce. */

const submitSchema = z.object({
  game: z.string(),
  score: z.number(),
  durationMs: z.number(),
});

interface RankedRow {
  userId: string;
  best: number;
  plays: number;
}

/** Best score per user for one game, ranked. Aggregation happens in JS
 *  over plain rows (v1 scale; mirrors the retention leaderboard's
 *  in-memory ranking). Users who opted out of leaderboards
 *  (retention_prefs.leaderboard_visible = false) are excluded — except
 *  the viewer, who always sees their own standing. */
async function rankedBests(game: ArcadeGame, viewerId: string): Promise<RankedRow[]> {
  const scoreRows = await db
    .select({ userId: arcadeScoresTable.userId, score: arcadeScoresTable.score })
    .from(arcadeScoresTable)
    .where(eq(arcadeScoresTable.game, game));

  const byUser = new Map<string, RankedRow>();
  for (const r of scoreRows) {
    const cur = byUser.get(r.userId);
    if (cur) {
      cur.best = Math.max(cur.best, r.score);
      cur.plays += 1;
    } else {
      byUser.set(r.userId, { userId: r.userId, best: r.score, plays: 1 });
    }
  }
  const rows = [...byUser.values()];
  if (rows.length === 0) return rows;

  const prefRows = await db
    .select({
      userId: retentionPrefsTable.userId,
      visible: retentionPrefsTable.leaderboardVisible,
    })
    .from(retentionPrefsTable)
    .where(inArray(retentionPrefsTable.userId, rows.map((r) => r.userId)));
  const hidden = new Set(prefRows.filter((p) => p.visible === false).map((p) => p.userId));

  return rows
    .filter((r) => !hidden.has(r.userId) || r.userId === viewerId)
    .sort((a, b) => b.best - a.best || a.plays - b.plays);
}

async function displayNames(userIds: string[]): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  if (userIds.length === 0) return nameMap;
  const { data: profiles } = await getSupabaseAdmin()
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);
  for (const p of profiles ?? []) {
    const dn = (p as { display_name?: string | null }).display_name;
    if (dn) nameMap.set((p as { id: string }).id, dn);
  }
  return nameMap;
}

router.post("/arcade/scores", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const verdict = validateArcadeScore(parsed.data);
  if (!verdict.ok) {
    res.status(400).json({ error: verdict.reason });
    return;
  }
  const game = parsed.data.game as ArcadeGame;
  const userId = req.userId!;
  try {
    await db.insert(arcadeScoresTable).values({
      userId,
      game,
      score: parsed.data.score,
      durationMs: parsed.data.durationMs,
    });

    const ranked = await rankedBests(game, userId);
    const mine = ranked.find((r) => r.userId === userId);
    const personalBest = mine?.best ?? parsed.data.score;
    res.json({
      ok: true,
      game,
      score: parsed.data.score,
      personalBest,
      isPersonalBest: parsed.data.score >= personalBest,
      rank: mine ? ranked.indexOf(mine) + 1 : null,
      plays: mine?.plays ?? 1,
    });
  } catch (err) {
    logger.error({ err, userId, game }, "[arcade] score submit failed");
    res.status(500).json({ error: "Could not save your score" });
  }
});

router.get("/arcade/leaderboard", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const game = req.query["game"];
  if (!isArcadeGame(game)) {
    res.status(400).json({ error: "Unknown game", games: ARCADE_GAMES });
    return;
  }
  const viewerId = req.userId!;
  try {
    const ranked = await rankedBests(game, viewerId);
    const top = ranked.slice(0, 10);
    const names = await displayNames(top.map((r) => r.userId));
    const viewerIdx = ranked.findIndex((r) => r.userId === viewerId);
    res.json({
      game,
      rows: top.map((r, i) => ({
        rank: i + 1,
        userId: r.userId,
        name: names.get(r.userId) ?? "Creator",
        best: r.best,
        plays: r.plays,
        isYou: r.userId === viewerId,
      })),
      viewerRank: viewerIdx >= 0 ? viewerIdx + 1 : null,
      viewerBest: viewerIdx >= 0 ? ranked[viewerIdx]!.best : null,
    });
  } catch (err) {
    logger.error({ err, userId: viewerId, game }, "[arcade] leaderboard failed");
    res.status(500).json({ error: "Could not load the leaderboard" });
  }
});

router.get("/arcade/me", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const rows = await db
      .select({ game: arcadeScoresTable.game, score: arcadeScoresTable.score })
      .from(arcadeScoresTable)
      .where(eq(arcadeScoresTable.userId, userId));
    const byGame = new Map<string, { best: number; plays: number }>();
    for (const r of rows) {
      const cur = byGame.get(r.game);
      if (cur) {
        cur.best = Math.max(cur.best, r.score);
        cur.plays += 1;
      } else {
        byGame.set(r.game, { best: r.score, plays: 1 });
      }
    }
    res.json({
      games: ARCADE_GAMES.map((game) => ({
        game,
        best: byGame.get(game)?.best ?? null,
        plays: byGame.get(game)?.plays ?? 0,
      })),
    });
  } catch (err) {
    logger.error({ err, userId }, "[arcade] me failed");
    res.status(500).json({ error: "Could not load your arcade stats" });
  }
});

export default router;
