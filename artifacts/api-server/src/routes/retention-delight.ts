import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, count, desc, eq, gt, gte, inArray, isNull } from "drizzle-orm";
import {
  db,
  sharkDropsTable,
  levelCelebrationsTable,
  retentionPrefsTable,
  generationsTable,
  exportJobsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { getSupabaseAdmin, addCreditsToProfile } from "../lib/supabase-admin";
import { recordCreditUsageStrict } from "../lib/payment-record";
import { logger } from "../lib/logger";

const router = Router();

/* ─── Retention Delight systems ───────────────────────────────────────────
   GET  /api/retention/shark-drop            — pending drop or 15% dice roll
   POST /api/retention/shark-drop/claim      — claim a pending drop ({ dropId })
   GET  /api/retention/level-check?currentLevel=N — uncelebrated level-ups
   POST /api/retention/level-check/celebrate — record a celebration ({ level })
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

/* POST /api/retention/shark-drop/claim — credit the VB with a strict ledger
   write; a failed ledger rolls the grant back and fails loudly. */
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

    const rows = await db
      .select()
      .from(sharkDropsTable)
      .where(
        and(
          eq(sharkDropsTable.id, parsed.data.dropId),
          eq(sharkDropsTable.userId, userId),
          isNull(sharkDropsTable.claimedAt)
        )
      )
      .limit(1);
    const drop = rows[0];
    if (!drop) {
      res.status(404).json({ error: "Drop not found or already claimed" });
      return;
    }
    if (drop.expiresAt.getTime() <= Date.now()) {
      res.status(410).json({ error: "This drop has expired" });
      return;
    }

    const { oldCredits } = await addCreditsToProfile(userId, drop.amount);
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
      throw ledgerErr;
    }

    await db
      .update(sharkDropsTable)
      .set({ claimedAt: new Date() })
      .where(eq(sharkDropsTable.id, drop.id));

    logger.info({ userId, dropId: drop.id, amount: drop.amount }, "[retention-delight] shark drop claimed");
    res.json({ claimed: true, amount: drop.amount });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention-delight] shark-drop claim failed");
    res.status(500).json({ error: "Could not claim the drop" });
  }
});

/* ── System 2: Level-up Events ─────────────────────────────────────────── */

const levelQuerySchema = z.object({ currentLevel: z.coerce.number().int().min(1).max(6) });
const celebrateSchema = z.object({ level: z.number().int().min(1).max(6) });

/* GET /api/retention/level-check?currentLevel=N — every level ≤ N that was
   never celebrated, highest first. Exactly-once is enforced by recording the
   celebration the moment the modal mounts. */
router.get("/retention/level-check", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = levelQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const userId = req.userId!;
    const prefs = await getDelightPrefs(userId);
    if (!prefs.levelCelebrationsEnabled) {
      res.json({ uncelebrated: [], disabled: true });
      return;
    }
    const celebrated = await db
      .select({ level: levelCelebrationsTable.level })
      .from(levelCelebrationsTable)
      .where(eq(levelCelebrationsTable.userId, userId));
    const seen = new Set(celebrated.map((c) => c.level));
    const uncelebrated: number[] = [];
    for (let lvl = parsed.data.currentLevel; lvl >= 1; lvl--) {
      if (!seen.has(lvl)) uncelebrated.push(lvl);
    }
    res.json({ uncelebrated });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention-delight] level-check failed");
    res.status(500).json({ error: "Could not check level celebrations" });
  }
});

/* POST /api/retention/level-check/celebrate — idempotent via the
   (user_id, level) primary key. */
router.post("/retention/level-check/celebrate", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = celebrateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const userId = req.userId!;
    const prefs = await getDelightPrefs(userId);
    if (!prefs.levelCelebrationsEnabled) {
      res.status(403).json({ error: "Level celebrations are turned off" });
      return;
    }
    await db
      .insert(levelCelebrationsTable)
      .values({ userId, level: parsed.data.level })
      .onConflictDoNothing();
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
