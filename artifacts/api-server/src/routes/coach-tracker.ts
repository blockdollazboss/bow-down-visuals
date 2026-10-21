import { Router } from "express";
import { z } from "zod";
import { eq, and, asc, desc } from "drizzle-orm";
import {
  db,
  moneyEntriesTable,
  coachActionItemsTable,
  coachGoalsTable,
  COACH_ACTION_SOURCES,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { readCreatorState } from "./generate/monetization-coach";

const router = Router();

/* ─── Coach depth: plan numbers + action tracker ────────────────────────
   The coach's money plan used to be model prose over a form, plus a
   Money Tracker snapshot that only existed if the tracker tab had been
   opened in the same session (a module-level store on the client). And
   its money moves evaporated on reload. This router is the depth pass:

   GET  /api/coach/plan-numbers   — deterministic math over the caller's
     OWN money ledger (money_entries, read server-side) + the same
     platform earnings/catalog state the plan already reads (DE-19's
     readCreatorState). No model, no invented figures: every number is
     summed from the creator's rows, and the response says when there
     isn't enough data yet instead of dressing up zeroes.
   GET/POST/PATCH/DELETE /api/coach/action-items — the persistent,
     checkable tracker: plan money moves (or niche next steps) saved as
     items that survive reloads and can be checked off.
   PUT  /api/coach/goal — the typed monthly income goal the plan
     numbers measure against. One row per user (migration 0173).

   Everything is owner-scoped: every query filters by req.userId. */

/* ── plan-numbers math (pure — the endpoint tests drive this directly) ── */

export interface LedgerEntryLike {
  entry_type: string;
  amount_cents: number;
  entry_date: string; // YYYY-MM-DD
}

export interface PlanNumbersInput {
  entries: LedgerEntryLike[];
  earningsCents: number;
  tipsVb: number;
  catalog: { songs: number; releases: number; storeProducts: number; membershipTiers: number };
  goalCents: number | null;
  now: Date;
}

export interface PlanNumbers {
  asOf: string;
  currentMonth: { key: string; incomeCents: number; expenseCents: number; netCents: number };
  /** Averages over the most recent COMPLETE months that have ledger
      entries (up to 3). Null averages = no complete month of data yet. */
  trailing: {
    monthsCounted: number;
    monthKeys: string[];
    avgMonthlyIncomeCents: number | null;
    avgMonthlyNetCents: number | null;
  };
  allTimeLedger: { incomeCents: number; expenseCents: number; netCents: number; entryCount: number };
  platform: {
    earningsCents: number;
    tipsVb: number;
    songs: number;
    releases: number;
    storeProducts: number;
    membershipTiers: number;
  };
  goal: {
    monthlyGoalCents: number;
    /** Share of the goal the trailing average month already reaches. */
    percentOfGoal: number | null;
    /** Goal minus the trailing average month's income (<= 0 = met). */
    monthlyGapCents: number | null;
    met: boolean;
    /** At the trailing average NET pace, months of banking to equal one
        month at goal. Null when the net pace isn't positive yet. */
    monthsOfNetToBankGoalMonth: number | null;
  } | null;
  /** True when there is anything real to measure: ledger entries or
      platform earnings. False = the honest "not enough data yet" state. */
  hasData: boolean;
}

function monthKeyOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function computePlanNumbers(input: PlanNumbersInput): PlanNumbers {
  const nowKey = `${input.now.getUTCFullYear()}-${String(input.now.getUTCMonth() + 1).padStart(2, "0")}`;

  const byMonth = new Map<string, { income: number; expense: number }>();
  let allIncome = 0;
  let allExpense = 0;
  for (const e of input.entries) {
    const key = monthKeyOf(e.entry_date);
    const bucket = byMonth.get(key) ?? { income: 0, expense: 0 };
    if (e.entry_type === "income") {
      bucket.income += e.amount_cents;
      allIncome += e.amount_cents;
    } else {
      bucket.expense += e.amount_cents;
      allExpense += e.amount_cents;
    }
    byMonth.set(key, bucket);
  }

  const cur = byMonth.get(nowKey) ?? { income: 0, expense: 0 };

  /* Trailing window: complete months only (strictly before the current
     month), most recent first, months WITH entries only — a month the
     creator never tracked in is "no data", not a $0 month. */
  const completeKeys = [...byMonth.keys()].filter((k) => k < nowKey).sort().reverse().slice(0, 3);
  let avgMonthlyIncomeCents: number | null = null;
  let avgMonthlyNetCents: number | null = null;
  if (completeKeys.length > 0) {
    let inc = 0;
    let net = 0;
    for (const k of completeKeys) {
      const b = byMonth.get(k)!;
      inc += b.income;
      net += b.income - b.expense;
    }
    avgMonthlyIncomeCents = Math.round(inc / completeKeys.length);
    avgMonthlyNetCents = Math.round(net / completeKeys.length);
  }

  let goal: PlanNumbers["goal"] = null;
  if (input.goalCents != null && input.goalCents > 0) {
    const percentOfGoal =
      avgMonthlyIncomeCents != null ? Math.round((avgMonthlyIncomeCents / input.goalCents) * 100) : null;
    const monthlyGapCents = avgMonthlyIncomeCents != null ? input.goalCents - avgMonthlyIncomeCents : null;
    goal = {
      monthlyGoalCents: input.goalCents,
      percentOfGoal,
      monthlyGapCents,
      met: monthlyGapCents != null && monthlyGapCents <= 0,
      monthsOfNetToBankGoalMonth:
        avgMonthlyNetCents != null && avgMonthlyNetCents > 0
          ? Math.ceil(input.goalCents / avgMonthlyNetCents)
          : null,
    };
  }

  return {
    asOf: input.now.toISOString(),
    currentMonth: { key: nowKey, incomeCents: cur.income, expenseCents: cur.expense, netCents: cur.income - cur.expense },
    trailing: {
      monthsCounted: completeKeys.length,
      monthKeys: [...completeKeys].sort(),
      avgMonthlyIncomeCents,
      avgMonthlyNetCents,
    },
    allTimeLedger: {
      incomeCents: allIncome,
      expenseCents: allExpense,
      netCents: allIncome - allExpense,
      entryCount: input.entries.length,
    },
    platform: {
      earningsCents: input.earningsCents,
      tipsVb: input.tipsVb,
      songs: input.catalog.songs,
      releases: input.catalog.releases,
      storeProducts: input.catalog.storeProducts,
      membershipTiers: input.catalog.membershipTiers,
    },
    goal,
    hasData: input.entries.length > 0 || input.earningsCents > 0,
  };
}

/* ── reads ────────────────────────────────────────────────────────────── */

async function readGoalCents(userId: string): Promise<number | null> {
  const [row] = await db
    .select({ monthly_goal_cents: coachGoalsTable.monthly_goal_cents })
    .from(coachGoalsTable)
    .where(eq(coachGoalsTable.user_id, userId))
    .limit(1);
  return row?.monthly_goal_cents ?? null;
}

router.get("/coach/plan-numbers", requireAuth, async (req, res) => {
  const userId = req.userId!;
  try {
    const entries = await db
      .select({
        entry_type: moneyEntriesTable.entry_type,
        amount_cents: moneyEntriesTable.amount_cents,
        entry_date: moneyEntriesTable.entry_date,
      })
      .from(moneyEntriesTable)
      .where(eq(moneyEntriesTable.user_id, userId))
      .orderBy(desc(moneyEntriesTable.entry_date))
      .limit(5000);
    const state = await readCreatorState(userId);
    const goalCents = await readGoalCents(userId);
    res.json(
      computePlanNumbers({
        entries: entries as LedgerEntryLike[],
        earningsCents: state.earningsCents,
        tipsVb: state.tipsVb,
        catalog: {
          songs: state.songs,
          releases: state.releases,
          storeProducts: state.storeProducts,
          membershipTiers: state.membershipTiers,
        },
        goalCents,
        now: new Date(),
      }),
    );
  } catch (err) {
    logger.error({ err, userId }, "[coach-tracker] plan-numbers failed");
    res.status(500).json({ error: "Couldn't load your plan numbers — try again." });
  }
});

/* ── action items ─────────────────────────────────────────────────────── */

interface ActionItemDto {
  id: string;
  title: string;
  source: string;
  done: boolean;
  completedAt: string | null;
  createdAt: string | null;
}

function toDto(row: {
  id: string;
  title: string;
  source: string;
  done: boolean;
  completed_at: Date | string | null;
  created_at: Date | string | null;
}): ActionItemDto {
  const iso = (v: Date | string | null) =>
    v == null ? null : v instanceof Date ? v.toISOString() : String(v);
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    done: row.done,
    completedAt: iso(row.completed_at),
    createdAt: iso(row.created_at),
  };
}

router.get("/coach/action-items", requireAuth, async (req, res) => {
  const userId = req.userId!;
  try {
    const rows = await db
      .select()
      .from(coachActionItemsTable)
      .where(eq(coachActionItemsTable.user_id, userId))
      .orderBy(asc(coachActionItemsTable.done), asc(coachActionItemsTable.sort_order), asc(coachActionItemsTable.created_at));
    const goalCents = await readGoalCents(userId);
    res.json({ items: rows.map(toDto), goal: { monthlyGoalCents: goalCents } });
  } catch (err) {
    logger.error({ err, userId }, "[coach-tracker] action-items list failed");
    res.status(500).json({ error: "Couldn't load your action tracker — try again." });
  }
});

const createItemsSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    titles: z.array(z.string().trim().min(1).max(300)).min(1).max(10).optional(),
    source: z.enum(COACH_ACTION_SOURCES).optional().default("custom"),
  })
  .refine((b) => !!b.title || !!b.titles, { message: "Give the item a title." });

router.post("/coach/action-items", requireAuth, async (req, res) => {
  const parsed = createItemsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid action item.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const userId = req.userId!;
  const source = parsed.data.source;
  const wanted = (parsed.data.titles ?? [parsed.data.title!]).map((t) => t.trim());
  try {
    /* Idempotent saves: an open item with the same title from the same
       source is kept, not duplicated — re-saving a plan is safe. */
    const existing = await db
      .select({ title: coachActionItemsTable.title, source: coachActionItemsTable.source, done: coachActionItemsTable.done })
      .from(coachActionItemsTable)
      .where(eq(coachActionItemsTable.user_id, userId));
    const openKeys = new Set(
      existing.filter((r) => !r.done && r.source === source).map((r) => r.title.trim().toLowerCase()),
    );
    const [maxRow] = await db
      .select({ sort_order: coachActionItemsTable.sort_order })
      .from(coachActionItemsTable)
      .where(eq(coachActionItemsTable.user_id, userId))
      .orderBy(desc(coachActionItemsTable.sort_order))
      .limit(1);
    let nextSort = (maxRow?.sort_order ?? -1) + 1;

    const created: ActionItemDto[] = [];
    const skipped: string[] = [];
    for (const title of wanted) {
      if (openKeys.has(title.toLowerCase())) {
        skipped.push(title);
        continue;
      }
      openKeys.add(title.toLowerCase());
      const [row] = await db
        .insert(coachActionItemsTable)
        .values({ user_id: userId, title, source, sort_order: nextSort++ })
        .returning();
      if (row) created.push(toDto(row));
    }
    res.status(201).json({ items: created, skipped });
  } catch (err) {
    logger.error({ err, userId }, "[coach-tracker] action-item create failed");
    res.status(500).json({ error: "Couldn't save that item — try again." });
  }
});

const patchItemSchema = z
  .object({
    done: z.boolean().optional(),
    title: z.string().trim().min(1).max(300).optional(),
  })
  .refine((b) => b.done !== undefined || b.title !== undefined, { message: "Nothing to change." });

router.patch("/coach/action-items/:id", requireAuth, async (req, res) => {
  const idCheck = z.string().uuid().safeParse(req.params.id);
  if (!idCheck.success) {
    res.status(400).json({ error: "Invalid item id." });
    return;
  }
  const parsed = patchItemSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid update.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const userId = req.userId!;
  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.done !== undefined) {
    patch.done = parsed.data.done;
    patch.completed_at = parsed.data.done ? new Date() : null;
  }
  try {
    const [row] = await db
      .update(coachActionItemsTable)
      .set(patch)
      .where(and(eq(coachActionItemsTable.id, idCheck.data), eq(coachActionItemsTable.user_id, userId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "That item isn't in your tracker." });
      return;
    }
    res.json({ item: toDto(row) });
  } catch (err) {
    logger.error({ err, userId }, "[coach-tracker] action-item update failed");
    res.status(500).json({ error: "Couldn't update that item — try again." });
  }
});

router.delete("/coach/action-items/:id", requireAuth, async (req, res) => {
  const idCheck = z.string().uuid().safeParse(req.params.id);
  if (!idCheck.success) {
    res.status(400).json({ error: "Invalid item id." });
    return;
  }
  const userId = req.userId!;
  try {
    const [row] = await db
      .delete(coachActionItemsTable)
      .where(and(eq(coachActionItemsTable.id, idCheck.data), eq(coachActionItemsTable.user_id, userId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "That item isn't in your tracker." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId }, "[coach-tracker] action-item delete failed");
    res.status(500).json({ error: "Couldn't remove that item — try again." });
  }
});

/* ── the typed goal ───────────────────────────────────────────────────── */

const goalSchema = z.object({
  monthlyGoalCents: z.number().int().min(1).max(100_000_000_00).nullable(),
});

router.put("/coach/goal", requireAuth, async (req, res) => {
  const parsed = goalSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid goal.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const userId = req.userId!;
  try {
    await db
      .insert(coachGoalsTable)
      .values({ user_id: userId, monthly_goal_cents: parsed.data.monthlyGoalCents })
      .onConflictDoUpdate({
        target: coachGoalsTable.user_id,
        set: { monthly_goal_cents: parsed.data.monthlyGoalCents, updated_at: new Date() },
      });
    res.json({ goal: { monthlyGoalCents: parsed.data.monthlyGoalCents } });
  } catch (err) {
    logger.error({ err, userId }, "[coach-tracker] goal save failed");
    res.status(500).json({ error: "Couldn't save your goal — try again." });
  }
});

export default router;
