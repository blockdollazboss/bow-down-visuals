/**
 * Funding goals on the tip page (Stack-100 #3).
 *
 * The contract under test:
 *  - Progress is DERIVED from durable tip_jar_tips rows and counts
 *    only rows the rail flipped to "paid" — pending / refunded /
 *    intent records never move the bar.
 *  - Only tips paid at/after the goal's start count toward it.
 *  - The reached state (and its instant) is derived, not stored.
 *  - Goal set/edit/remove is owner-scoped: handlers only ever touch
 *    the caller's own tip page.
 *  - The lifecycle: edit keeps the goal's start (progress basis),
 *    an identical re-save is a no-op, and a reached goal is archived
 *    to history — never silently erased — when replaced or removed.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  tips: [] as Array<Record<string, any>>,
  currentUser: "11111111-1111-4111-8111-111111111111",
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { tipJarTipsTable, creatorProfilesTable } = actual;

  function selectRows(table: unknown, cond: unknown): Array<Record<string, any>> {
    if (cond === undefined) {
      return table === tipJarTipsTable ? [...h.tips] : [];
    }
    const { params } = render(cond);
    if (table === tipJarTipsTable) {
      return h.tips.filter(
        (r) => params.includes(r.page_user_id) || params.includes(r.stripe_session_id) || params.includes(r.id),
      );
    }
    if (table === creatorProfilesTable) return [];
    return [];
  }

  const fakeDb: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const rows = () => selectRows(table, cond);
          return {
            limit: async () => rows(),
            then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
          };
        },
      }),
    }),
  };
  return { ...actual, db: fakeDb };
});

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.currentUser;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

import router, {
  __resetTipJarStores,
  computeFundingProgress,
  applyFundingGoalChange,
  type FundingGoal,
  type PaidTipRowLike,
} from "../tip-jar";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

beforeEach(() => {
  h.tips = [];
  h.currentUser = USER_A;
  __resetTipJarStores();
});

async function call(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function makePage(handle: string, extra: Record<string, unknown> = {}) {
  const { status, json } = await call("POST", "/tips/settings", {
    handle,
    displayName: "Creator",
    message: "",
    suggestedAmounts: [5, 10, 25],
    ...extra,
  });
  expect(status).toBe(200);
  return json;
}

function paidRow(over: Partial<PaidTipRowLike> & Record<string, unknown>): Record<string, any> {
  return {
    id: `row-${Math.random().toString(36).slice(2)}`,
    page_user_id: USER_A,
    handle: "creator-a",
    fan_name: "Fan",
    message: "",
    amount_cents: 1000,
    currency: "usd",
    status: "paid",
    stripe_session_id: null,
    created_at: new Date(),
    paid_at: new Date(),
    ...over,
  };
}

/* ── Pure progress math ─────────────────────────────────────────── */

const GOAL: FundingGoal = {
  id: "g1",
  targetAmount: 100,
  label: "New mic",
  startedAt: "2026-10-01T00:00:00.000Z",
};
const at = (iso: string) => new Date(iso);

describe("computeFundingProgress", () => {
  it("sums paid tips and caps progress at 1", () => {
    const p = computeFundingProgress(
      [
        paidRow({ amount_cents: 4000, paid_at: at("2026-10-02T00:00:00Z"), created_at: at("2026-10-02T00:00:00Z") }),
        paidRow({ amount_cents: 9000, paid_at: at("2026-10-03T00:00:00Z"), created_at: at("2026-10-03T00:00:00Z") }),
      ],
      GOAL,
    );
    expect(p.raised).toBe(130);
    expect(p.raisedCount).toBe(2);
    expect(p.progress).toBe(1);
    expect(p.reached).toBe(true);
  });

  it("counts ONLY paid rows — pending, refunded and every other status are excluded", () => {
    const rows = [
      paidRow({ amount_cents: 2500, paid_at: at("2026-10-02T00:00:00Z") }),
      paidRow({ amount_cents: 5000, status: "pending_payment", paid_at: null }),
      paidRow({ amount_cents: 5000, status: "refunded", paid_at: at("2026-10-02T00:00:00Z") }),
      paidRow({ amount_cents: 5000, status: "failed", paid_at: null }),
    ];
    const p = computeFundingProgress(rows, GOAL);
    expect(p.raised).toBe(25);
    expect(p.raisedCount).toBe(1);
    expect(p.reached).toBe(false);
  });

  it("excludes tips paid before the goal started and other currencies", () => {
    const rows = [
      paidRow({ amount_cents: 9900, paid_at: at("2026-09-30T23:59:59Z"), created_at: at("2026-09-30T23:59:59Z") }),
      paidRow({ amount_cents: 9900, currency: "eur", paid_at: at("2026-10-02T00:00:00Z") }),
      paidRow({ amount_cents: 1000, paid_at: at("2026-10-01T00:00:00Z"), created_at: at("2026-10-01T00:00:00Z") }),
    ];
    const p = computeFundingProgress(rows, GOAL);
    expect(p.raised).toBe(10);
    expect(p.raisedCount).toBe(1);
  });

  it("derives reachedAt from the crossing tip, regardless of row order", () => {
    const rows = [
      paidRow({ amount_cents: 6000, paid_at: at("2026-10-05T00:00:00Z"), created_at: at("2026-10-05T00:00:00Z") }),
      paidRow({ amount_cents: 5000, paid_at: at("2026-10-03T00:00:00Z"), created_at: at("2026-10-03T00:00:00Z") }),
      paidRow({ amount_cents: 7000, paid_at: at("2026-10-09T00:00:00Z"), created_at: at("2026-10-09T00:00:00Z") }),
    ];
    const p = computeFundingProgress(rows, GOAL);
    expect(p.reached).toBe(true);
    expect(p.reachedAt).toBe("2026-10-05T00:00:00.000Z");
  });

  it("no tips → zero, unreached, no reachedAt", () => {
    expect(computeFundingProgress([], GOAL)).toEqual({
      raised: 0,
      raisedCount: 0,
      progress: 0,
      reached: false,
      reachedAt: null,
    });
  });
});

/* ── Pure lifecycle ─────────────────────────────────────────────── */

const NOW = "2026-10-10T00:00:00.000Z";
const REACHED_PROGRESS = { raised: 120, raisedCount: 3, progress: 1, reached: true, reachedAt: "2026-10-05T00:00:00.000Z" };
const UNREACHED_PROGRESS = { raised: 40, raisedCount: 1, progress: 0.4, reached: false, reachedAt: null };

describe("applyFundingGoalChange", () => {
  it("starts a fresh goal when none is active", () => {
    const out = applyFundingGoalChange({
      prevGoal: null, prevHistory: [], prevProgress: null,
      next: { targetAmount: 500, label: "Tour fund" }, now: NOW, newId: "g-new",
    });
    expect(out.fundingGoal).toEqual({ id: "g-new", targetAmount: 500, label: "Tour fund", startedAt: NOW });
    expect(out.goalHistory).toEqual([]);
  });

  it("edits an unreached goal in place — same id and start, progress basis kept", () => {
    const out = applyFundingGoalChange({
      prevGoal: GOAL, prevHistory: [], prevProgress: UNREACHED_PROGRESS,
      next: { targetAmount: 250, label: "Bigger mic" }, now: NOW, newId: "g-new",
    });
    expect(out.fundingGoal).toEqual({ id: "g1", targetAmount: 250, label: "Bigger mic", startedAt: GOAL.startedAt });
    expect(out.goalHistory).toEqual([]);
  });

  it("an identical re-save is a no-op even when the goal is reached", () => {
    const out = applyFundingGoalChange({
      prevGoal: GOAL, prevHistory: [], prevProgress: REACHED_PROGRESS,
      next: { targetAmount: GOAL.targetAmount, label: GOAL.label }, now: NOW, newId: "g-new",
    });
    expect(out.fundingGoal).toEqual(GOAL);
    expect(out.goalHistory).toEqual([]);
  });

  it("changing a reached goal archives it and starts fresh", () => {
    const out = applyFundingGoalChange({
      prevGoal: GOAL, prevHistory: [], prevProgress: REACHED_PROGRESS,
      next: { targetAmount: 300, label: "Next thing" }, now: NOW, newId: "g-new",
    });
    expect(out.goalHistory).toEqual([
      { id: "g1", label: "New mic", targetAmount: 100, raisedAmount: 120, startedAt: GOAL.startedAt, reachedAt: "2026-10-05T00:00:00.000Z" },
    ]);
    expect(out.fundingGoal).toEqual({ id: "g-new", targetAmount: 300, label: "Next thing", startedAt: NOW });
  });

  it("removing a reached goal archives it; removing an unreached one does not", () => {
    const reached = applyFundingGoalChange({
      prevGoal: GOAL, prevHistory: [], prevProgress: REACHED_PROGRESS,
      next: { targetAmount: null, label: "" }, now: NOW, newId: "g-new",
    });
    expect(reached.fundingGoal).toBeNull();
    expect(reached.goalHistory).toHaveLength(1);

    const unreached = applyFundingGoalChange({
      prevGoal: GOAL, prevHistory: [], prevProgress: UNREACHED_PROGRESS,
      next: { targetAmount: null, label: "" }, now: NOW, newId: "g-new",
    });
    expect(unreached.fundingGoal).toBeNull();
    expect(unreached.goalHistory).toEqual([]);
  });
});

/* ── Routes: owner scoping + honest progress ────────────────────── */

describe("funding goal routes", () => {
  it("goal endpoints 404 before a tip page exists", async () => {
    const set = await call("POST", "/tips/goal", { targetAmount: 100, label: "Mic" });
    expect(set.status).toBe(404);
    const del = await call("DELETE", "/tips/goal");
    expect(del.status).toBe(404);
  });

  it("validates the goal payload", async () => {
    await makePage("creator-a");
    expect((await call("POST", "/tips/goal", { targetAmount: 0, label: "Mic" })).status).toBe(400);
    expect((await call("POST", "/tips/goal", { targetAmount: -5, label: "Mic" })).status).toBe(400);
    expect((await call("POST", "/tips/goal", { targetAmount: 100, label: "x".repeat(81) })).status).toBe(400);
  });

  it("sets a goal; public page shows it with $0 honest progress", async () => {
    await makePage("creator-a");
    const set = await call("POST", "/tips/goal", { targetAmount: 100, label: "New mic" });
    expect(set.status).toBe(200);
    expect(set.json.goal).toMatchObject({ targetAmount: 100, label: "New mic", raised: 0, reached: false });

    const page = await call("GET", "/tips/page/creator-a");
    expect(page.json.page.goalAmount).toBe(100);
    expect(page.json.goal).toMatchObject({ raised: 0, progress: 0, reached: false });
    expect(page.json.stats.goalProgress).toBe(0);
  });

  it("tip INTENTS never move goal progress — only paid rows do", async () => {
    await makePage("creator-a");
    await call("POST", "/tips/goal", { targetAmount: 100, label: "New mic" });

    /* Record a big intent — no charge exists behind it. */
    const intent = await call("POST", "/tips/creator-a/tip", { amount: 500, fanName: "Fan", message: "" });
    expect(intent.status).toBe(201);
    let page = await call("GET", "/tips/page/creator-a");
    expect(page.json.goal.raised).toBe(0);
    expect(page.json.goal.reached).toBe(false);

    /* A pending row and a refunded row don't count either. */
    const start = new Date(page.json.goal.startedAt).getTime();
    h.tips.push(paidRow({ amount_cents: 5000, status: "pending_payment", paid_at: null, created_at: new Date(start + 1000) }));
    h.tips.push(paidRow({ amount_cents: 5000, status: "refunded", paid_at: new Date(start + 2000), created_at: new Date(start + 2000) }));
    page = await call("GET", "/tips/page/creator-a");
    expect(page.json.goal.raised).toBe(0);

    /* Real paid rows count, and crossing the target flips reached. */
    h.tips.push(paidRow({ amount_cents: 6000, paid_at: new Date(start + 3000), created_at: new Date(start + 3000) }));
    h.tips.push(paidRow({ amount_cents: 4000, paid_at: new Date(start + 4000), created_at: new Date(start + 4000) }));
    page = await call("GET", "/tips/page/creator-a");
    expect(page.json.goal.raised).toBe(100);
    expect(page.json.goal.reached).toBe(true);
    expect(page.json.goal.reachedAt).toBe(new Date(start + 4000).toISOString());
    expect(page.json.stats.goalProgress).toBe(1);
  });

  it("another creator cannot see or touch my goal through their own session", async () => {
    await makePage("creator-a");
    await call("POST", "/tips/goal", { targetAmount: 100, label: "A's mic" });

    /* B has no page: goal calls resolve against B's own (absent) page. */
    h.currentUser = USER_B;
    expect((await call("POST", "/tips/goal", { targetAmount: 1, label: "hijack" })).status).toBe(404);
    expect((await call("DELETE", "/tips/goal")).status).toBe(404);
    const bDash = await call("GET", "/tips/dashboard");
    expect(bDash.json.hasPage).toBe(false);
    expect(bDash.json.goal).toBeNull();

    /* B sets up their own page + goal; A's goal is untouched. */
    await makePage("creator-b");
    await call("POST", "/tips/goal", { targetAmount: 999, label: "B's goal" });
    const bGoal = await call("DELETE", "/tips/goal");
    expect(bGoal.json.goal).toBeNull();

    h.currentUser = USER_A;
    const aDash = await call("GET", "/tips/dashboard");
    expect(aDash.json.goal).toMatchObject({ targetAmount: 100, label: "A's mic" });
    const page = await call("GET", "/tips/page/creator-a");
    expect(page.json.goal.targetAmount).toBe(100);
  });

  it("removing a reached goal archives it; the dashboard keeps the record", async () => {
    await makePage("creator-a");
    const set = await call("POST", "/tips/goal", { targetAmount: 50, label: "Cables" });
    const start = new Date(set.json.goal.startedAt).getTime();
    h.tips.push(paidRow({ amount_cents: 5000, paid_at: new Date(start + 5000), created_at: new Date(start + 5000) }));

    const del = await call("DELETE", "/tips/goal");
    expect(del.json.goal).toBeNull();
    expect(del.json.goalHistory).toHaveLength(1);
    expect(del.json.goalHistory[0]).toMatchObject({ label: "Cables", targetAmount: 50, raisedAmount: 50 });

    const dash = await call("GET", "/tips/dashboard");
    expect(dash.json.goal).toBeNull();
    expect(dash.json.goalHistory).toHaveLength(1);
    const page = await call("GET", "/tips/page/creator-a");
    expect(page.json.goal).toBeNull();
    expect(page.json.page.goalAmount).toBeNull();
  });

  it("setting a new goal after reaching one archives the old and restarts progress", async () => {
    await makePage("creator-a");
    await call("POST", "/tips/goal", { targetAmount: 50, label: "Cables" });
    /* Paid "now": after the first goal started (earlier request) and
       before the next goal starts (the request below) — by program
       order, so it can only ever belong to the first goal. */
    h.tips.push(paidRow({ amount_cents: 6000, paid_at: new Date(), created_at: new Date() }));

    const next = await call("POST", "/tips/goal", { targetAmount: 200, label: "Interface" });
    expect(next.json.goalHistory).toHaveLength(1);
    expect(next.json.goal).toMatchObject({ targetAmount: 200, label: "Interface", raised: 0, reached: false });
  });

  it("the legacy settings save also runs the lifecycle — and never restarts the goal on a routine re-save", async () => {
    const first = await makePage("creator-a", { goalAmount: 100, goalLabel: "New mic" });
    expect(first.settings.fundingGoal).toMatchObject({ targetAmount: 100, label: "New mic" });
    const goalId = first.settings.fundingGoal.id;
    const startedAt = first.settings.fundingGoal.startedAt;

    /* Routine save (message edit) resubmitting identical goal fields. */
    const second = await makePage("creator-a", { goalAmount: 100, goalLabel: "New mic", message: "Updated message" });
    expect(second.settings.fundingGoal.id).toBe(goalId);
    expect(second.settings.fundingGoal.startedAt).toBe(startedAt);
    expect(second.settings.goalHistory).toEqual([]);

    /* Clearing the goal through settings removes it. */
    const third = await makePage("creator-a", { goalAmount: null, goalLabel: "" });
    expect(third.settings.fundingGoal).toBeNull();
    expect(third.settings.goalAmount).toBeNull();
  });
});
