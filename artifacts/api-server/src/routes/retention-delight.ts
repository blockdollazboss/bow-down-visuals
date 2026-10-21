import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, count, desc, eq, gt, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db,
  sharkDropsTable,
  retentionPrefsTable,
  generationsTable,
  exportJobsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { getSupabaseAdmin, addCreditsToProfile } from "../lib/supabase-admin";
import { recordCreditUsageStrict } from "../lib/payment-record";
import { getCreatorRank } from "../lib/creator-rank";
import { logger } from "../lib/logger";

const router = Router();

/* ─── Retention Delight systems ───────────────────────────────────────────
   GET  /api/retention/shark-drop            — pending drop or 15% dice roll
   POST /api/retention/shark-drop/claim      — claim a pending drop ({ dropId })
   GET  /api/retention/rank — the caller's EARNED rank (stars, points,
        per-source breakdown, what the next star takes)
   GET  /api/retention/level-check — uncelebrated EARNED level-ups
        (stars are computed server-side from recorded work in
        lib/creator-rank.ts; a client-supplied level is never trusted —
        the legacy ?currentLevel= param is accepted and ignored)
   POST /api/retention/level-check/celebrate — record a celebration
        ({ level }); refused when the level is above the earned rank
   GET  /api/retention/leaderboard           — weekly top 10 (STATUS ONLY, no VB)
   GET  /api/retention/delight-prefs         — prefs for these three systems
   PATCH /api/retention/delight-prefs        — toggle them
   All systems respect retention_prefs. Nothing is forced: every modal is
   dismissible, every system has an on/off switch. */

/* ── Prefs (this file's three systems only) ────────────────────────────── */

const DEFAULT_PREFS = {
  sharkDropsEnabled: true,
  levelCelebrationsEnabled: true,
  leaderboardVisible: true,
};

async function getDelightPrefs(userId: string) {
  const rows = await db
    .select({
      sharkDropsEnabled: retentionPrefsTable.sharkDropsEnabled,
      levelCelebrationsEnabled: retentionPrefsTable.levelCelebrationsEnabled,
      leaderboardVisible: retentionPrefsTable.leaderboardVisible,
    })
    .from(retentionPrefsTable)
    .where(eq(retentionPrefsTable.userId, userId))
    .limit(1);
  const row = rows[0];
  return {
    sharkDropsEnabled: row?.sharkDropsEnabled ?? DEFAULT_PREFS.sharkDropsEnabled,
    levelCelebrationsEnabled:
      row?.levelCelebrationsEnabled ?? DEFAULT_PREFS.levelCelebrationsEnabled,
    leaderboardVisible: row?.leaderboardVisible ?? DEFAULT_PREFS.leaderboardVisible,
  };
}

const delightPrefsSchema = z.object({
  sharkDropsEnabled: z.boolean().optional(),
  levelCelebrationsEnabled: z.boolean().optional(),
  leaderboardVisible: z.boolean().optional(),
});

router.get("/retention/delight-prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json({ prefs: await getDelightPrefs(req.userId!) });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention-delight] prefs read failed");
    res.status(500).json({ error: "Could not load preferences" });
  }
});

router.patch("/retention/delight-prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = delightPrefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const userId = req.userId!;
    const patch: Partial<typeof DEFAULT_PREFS> = {};
    for (const [k, v] of Object.entries(parsed.data)) {
      if (typeof v === "boolean") (patch as Record<string, boolean>)[k] = v;
    }
    if (Object.keys(patch).length > 0) {
      await db
        .insert(retentionPrefsTable)
        .values({ userId, ...patch, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: retentionPrefsTable.userId,
          set: { ...patch, updatedAt: new Date() },
        });
    }
    res.json({ prefs: await getDelightPrefs(userId) });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention-delight] prefs write failed");
    res.status(500).json({ error: "Could not save preferences" });
  }
});

/* ── System 1: Shark Drops ─────────────────────────────────────────────── */

const DROP_CHANCE = 0.15; // ~15% per dashboard load — unpredictable by design
const MAX_DROPS_PER_7_DAYS = 2; // HARD CAP, rolling window
const DROP_EXPIRY_MS = 48 * 60 * 60 * 1000; // unclaimed drops die after 48h
const MIN_DROP = 100; // VB
const DROP_STEP = 10; // VB
const DROP_STEPS = 41; // 100..500 in steps of 10

function rollDropAmount(): number {
  return MIN_DROP + Math.floor(Math.random() * DROP_STEPS) * DROP_STEP;
}

type SharkDropRow = typeof sharkDropsTable.$inferSelect;

function toDropDto(row: SharkDropRow) {
  return {
    id: row.id,
    amount: row.amount,
    droppedAt: row.droppedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/* GET /api/retention/shark-drop — the pending unclaimed drop always wins;
   otherwise the dice roll, capped at 2 drops per rolling 7 days. */
router.get("/retention/shark-drop", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const prefs = await getDelightPrefs(userId);
    if (!prefs.sharkDropsEnabled) {
      res.json({ drop: null, disabled: true });
      return;
    }

    const now = new Date();

    const pending = await db
      .select()
      .from(sharkDropsTable)
      .where(
        and(
          eq(sharkDropsTable.userId, userId),
          isNull(sharkDropsTable.claimedAt),
          gt(sharkDropsTable.expiresAt, now)
        )
      )
      .orderBy(desc(sharkDropsTable.droppedAt))
      .limit(1);
    if (pending[0]) {
      res.json({ drop: toDropDto(pending[0]) });
      return;
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recent = await db
      .select({ n: count() })
      .from(sharkDropsTable)
      .where(
        and(
          eq(sharkDropsTable.userId, userId),
          gte(sharkDropsTable.droppedAt, sevenDaysAgo)
        )
      );
    if ((recent[0]?.n ?? 0) >= MAX_DROPS_PER_7_DAYS) {
      res.json({ drop: null, capped: true });
      return;
    }

    if (Math.random() >= DROP_CHANCE) {
      res.json({ drop: null });
      return;
    }

    const inserted = await db
      .insert(sharkDropsTable)
      .values({
        userId,
        amount: rollDropAmount(),
        expiresAt: new Date(now.getTime() + DROP_EXPIRY_MS),
      })
      .returning();
    const drop = inserted[0];
    if (!drop) {
      res.json({ drop: null });
      return;
    }

    // Post-insert cap enforcement: a concurrent request could have slipped
    // through the pre-check — recount and retract the over-cap drop.
    const recount = await db
      .select({ n: count() })
      .from(sharkDropsTable)
      .where(
        and(
          eq(sharkDropsTable.userId, userId),
          gte(sharkDropsTable.droppedAt, sevenDaysAgo)
        )
      );
    if ((recount[0]?.n ?? 0) > MAX_DROPS_PER_7_DAYS) {
      await db.delete(sharkDropsTable).where(eq(sharkDropsTable.id, drop.id));
      logger.info({ userId }, "[retention-delight] retracted over-cap concurrent drop");
      res.json({ drop: null, capped: true });
      return;
    }

    logger.info({ userId, amount: drop.amount, dropId: drop.id }, "[retention-delight] shark drop created");
    res.json({ drop: toDropDto(drop) });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention-delight] shark-drop check failed");
    res.status(500).json({ error: "Could not check for shark drops" });
  }
});

const claimDropSchema = z.object({ dropId: z.string().uuid() });

/* POST /api/retention/shark-drop/claim — claim FIRST with a conditional
   UPDATE (claimed_at IS NULL is the lock), then credit the VB with a
   strict ledger write. Any payout failure releases the claim so the
   drop stays claimable; a failed ledger also rolls the grant back.
   (Previously the grant ran BEFORE the claim was marked, with an
   unconditional final UPDATE — two concurrent claims both read the
   drop as unclaimed and both got paid.) */
router.post("/retention/shark-drop/claim", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = claimDropSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const userId = req.userId!;
    const prefs = await getDelightPrefs(userId);
    if (!prefs.sharkDropsEnabled) {
      res.status(403).json({ error: "Shark Drops are turned off" });
      return;
    }

    // Atomic claim: exactly one concurrent request can flip claimed_at.
    const claimStamp = new Date();
    const claimed = await db
      .update(sharkDropsTable)
      .set({ claimedAt: claimStamp })
      .where(
        and(
          eq(sharkDropsTable.id, parsed.data.dropId),
          eq(sharkDropsTable.userId, userId),
          isNull(sharkDropsTable.claimedAt)
        )
      )
      .returning();
    const drop = claimed[0];
    if (!drop) {
      res.status(404).json({ error: "Drop not found or already claimed" });
      return;
    }

    // Release the claim so a failed payout never burns the drop. Only
    // this request can have set claimed_at in this flow (the claim above
    // flipped it from NULL atomically), so IS NOT NULL identifies our
    // stamp.
    const releaseClaim = async () => {
      await db
        .update(sharkDropsTable)
        .set({ claimedAt: null })
        .where(
          and(
            eq(sharkDropsTable.id, drop.id),
            isNotNull(sharkDropsTable.claimedAt)
          )
        );
    };

    if (drop.expiresAt.getTime() <= Date.now()) {
      await releaseClaim();
      res.status(410).json({ error: "This drop has expired" });
      return;
    }

    let oldCredits: number;
    try {
      ({ oldCredits } = await addCreditsToProfile(userId, drop.amount));
    } catch (grantErr) {
      await releaseClaim().catch(() => {});
      throw grantErr;
    }
    try {
      await recordCreditUsageStrict({
        userId,
        action: "Shark Drop",
        creditsUsed: -drop.amount,
      });
    } catch (ledgerErr) {
      logger.error({ err: ledgerErr, userId, dropId: drop.id }, "[retention-delight] ledger failed after grant — rolling back");
      try {
        await getSupabaseAdmin().from("profiles").update({ credits: oldCredits }).eq("id", userId);
      } catch (rollbackErr) {
        logger.error({ err: rollbackErr, userId }, "[retention-delight] CRITICAL — ledger failed AND rollback failed; manual reconciliation required");
      }
      await releaseClaim().catch(() => {});
      throw ledgerErr;
    }

    logger.info({ userId, dropId: drop.id, amount: drop.amount }, "[retention-delight] shark drop claimed");
    res.json({ claimed: true, amount: drop.amount });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention-delight] shark-drop claim failed");
    res.status(500).json({ error: "Could not claim the drop" });
  }
});

/* ── System 2: Level-up Events ─────────────────────────────────────────── */

const celebrateSchema = z.object({ level: z.number().int().min(1).max(6) });

/* The earned-rank rails below read/write through raw SQL (db.execute),
   the house pattern for aggregate reads (cf. routes/earnings.ts):
   level_celebrations_enabled from retention_prefs (default true when
   no row exists — the same default getDelightPrefs applies), the
   celebrated-level set, and the celebration insert. */
async function readLevelCelebrationsEnabled(userId: string): Promise<boolean> {
  const res = await db.execute(
    sql`SELECT level_celebrations_enabled AS enabled FROM retention_prefs WHERE user_id = ${userId} LIMIT 1`,
  );
  const row = (res.rows as any[])[0];
  return row?.enabled ?? true;
}

async function readCelebratedLevels(userId: string): Promise<Set<number>> {
  const res = await db.execute(
    sql`SELECT level FROM level_celebrations WHERE user_id = ${userId}`,
  );
  return new Set((res.rows as any[]).map((r) => Number(r.level)));
}

/* GET /api/retention/rank — the caller's earned rank, in full: stars,
   points, the per-source counts and point contributions behind them, and
   exactly what the next star takes (points still needed + any unmet
   gate). This is the read the sidebar rank display and the nameplate
   rails stand on. */
router.get("/retention/rank", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const rank = await getCreatorRank(req.userId!);
    res.json({ rank });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention-delight] rank read failed");
    res.status(500).json({ error: "Could not load your rank" });
  }
});

/* GET /api/retention/level-check — every EARNED level (2..stars) that was
   never celebrated, highest first. The earned stars are computed on the
   server from recorded work; a ?currentLevel= claim from the client is
   accepted for backward compatibility and ignored — under the old dial
   regime this endpoint trusted it, which is exactly what made the old
   celebrations fiction. Level 1 is the starting rank, never a crossing,
   so it is never "uncelebrated". Exactly-once is enforced by recording
   the celebration the moment the modal mounts. The response carries the
   earned `stars` + `points` so callers (the World's level watch) can
   compare against their own baseline without a second read. */
router.get("/retention/level-check", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const rank = await getCreatorRank(userId);
    if (!(await readLevelCelebrationsEnabled(userId))) {
      res.json({ uncelebrated: [], disabled: true, stars: rank.stars, points: rank.points });
      return;
    }
    const seen = await readCelebratedLevels(userId);
    const uncelebrated: number[] = [];
    for (let lvl = rank.stars; lvl >= 2; lvl--) {
      if (!seen.has(lvl)) uncelebrated.push(lvl);
    }
    res.json({ uncelebrated, stars: rank.stars, points: rank.points });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention-delight] level-check failed");
    res.status(500).json({ error: "Could not check level celebrations" });
  }
});

/* POST /api/retention/level-check/celebrate — records a celebration for
   a level the caller has actually EARNED. A claim above the earned rank
   is refused (400): celebrations are the server's witness of a real
   crossing, not a client assertion. Idempotent via the (user_id, level)
   primary key. */
router.post("/retention/level-check/celebrate", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = celebrateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const userId = req.userId!;
    if (!(await readLevelCelebrationsEnabled(userId))) {
      res.status(403).json({ error: "Level celebrations are turned off" });
      return;
    }
    const rank = await getCreatorRank(userId);
    if (parsed.data.level > rank.stars) {
      res.status(400).json({
        error: `Level ${parsed.data.level} has not been earned yet (current rank: ${rank.stars} stars)`,
      });
      return;
    }
    await db.execute(
      sql`INSERT INTO level_celebrations (user_id, level) VALUES (${userId}, ${parsed.data.level}) ON CONFLICT DO NOTHING`,
    );
    res.json({ celebrated: true, level: parsed.data.level });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention-delight] celebrate failed");
    res.status(500).json({ error: "Could not record celebration" });
  }
});

/* ── System 3: Weekly Leaderboard ─────────────────────────────────────────
   Top 10 by creations + exports in the current week (Monday 00:00 UTC
   reset). STATUS ONLY — no VB is paid, and no payout path exists here. */

function weekStartUtcMonday(now: Date = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diff = (d.getUTCDay() + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

interface LeaderboardRow {
  rank: number;
  userId: string;
  name: string;
  creations: number;
  exports: number;
  score: number;
  isYou: boolean;
}

router.get("/retention/leaderboard", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const viewerId = req.userId!;
    const weekStart = weekStartUtcMonday();

    const [genRows, expRows] = await Promise.all([
      db
        .select({ userId: generationsTable.user_id, n: count() })
        .from(generationsTable)
        .where(
          and(
            gte(generationsTable.created_at, weekStart),
            isNull(generationsTable.deleted_at)
          )
        )
        .groupBy(generationsTable.user_id),
      db
        .select({ userId: exportJobsTable.user_id, n: count() })
        .from(exportJobsTable)
        .where(gte(exportJobsTable.created_at, weekStart))
        .groupBy(exportJobsTable.user_id),
    ]);

    const totals = new Map<string, { creations: number; exports: number }>();
    for (const r of genRows) {
      const t = totals.get(r.userId) ?? { creations: 0, exports: 0 };
      t.creations += r.n;
      totals.set(r.userId, t);
    }
    for (const r of expRows) {
      const t = totals.get(r.userId) ?? { creations: 0, exports: 0 };
      t.exports += r.n;
      totals.set(r.userId, t);
    }

    if (totals.size === 0) {
      res.json({ weekStart: weekStart.toISOString(), rows: [], viewerRank: null, viewerScore: 0 });
      return;
    }

    // Opt-out: anyone with leaderboard_visible = false is excluded.
    const userIds = [...totals.keys()];
    const prefRows = await db
      .select({
        userId: retentionPrefsTable.userId,
        visible: retentionPrefsTable.leaderboardVisible,
      })
      .from(retentionPrefsTable)
      .where(inArray(retentionPrefsTable.userId, userIds));
    const hidden = new Set(prefRows.filter((p) => p.visible === false).map((p) => p.userId));
    const visibleIds = userIds.filter((id) => !hidden.has(id));

    // Display names come from Supabase profiles (admin client).
    const nameMap = new Map<string, string>();
    if (visibleIds.length > 0) {
      const { data: profiles } = await getSupabaseAdmin()
        .from("profiles")
        .select("id, display_name")
        .in("id", visibleIds);
      for (const p of profiles ?? []) {
        const dn = (p as { display_name?: string | null }).display_name;
        if (dn) nameMap.set((p as { id: string }).id, dn);
      }
    }

    const ranked = visibleIds
      .map((userId) => {
        const t = totals.get(userId)!;
        return {
          userId,
          name: nameMap.get(userId) ?? "Creator",
          creations: t.creations,
          exports: t.exports,
          score: t.creations + t.exports,
        };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

    const rows: LeaderboardRow[] = ranked.slice(0, 10).map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      name: r.name,
      creations: r.creations,
      exports: r.exports,
      score: r.score,
      isYou: r.userId === viewerId,
    }));

    const viewerIdx = ranked.findIndex((r) => r.userId === viewerId);

    res.json({
      weekStart: weekStart.toISOString(),
      rows,
      viewerRank: viewerIdx >= 0 ? viewerIdx + 1 : null,
      viewerScore: viewerIdx >= 0 ? ranked[viewerIdx]!.score : 0,
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention-delight] leaderboard failed");
    res.status(500).json({ error: "Could not load the leaderboard" });
  }
});

export default router;
