/* Stack-3 coach depth — plan numbers, action tracker, niche grounding.
 *
 * Drives the REAL coach-tracker + niche-analyzer routers with
 * @workspace/db, credits, and auth doubled (the monetization-coach-state
 * pattern). Asserts:
 *   1. plan-numbers math is summed from the caller's OWN ledger rows
 *      (trailing complete-month averages, goal gap/pace) — a second
 *      user sees none of it;
 *   2. action items persist, check off (completed_at stamps), dedupe on
 *      re-save, and are owner-scoped on PATCH/DELETE (404, not a leak);
 *   3. the niche analyzer with useMyData derives the niche from the
 *      CALLER'S profile/catalog and grounds the prompt in it — another
 *      creator's catalog never appears; no data = honest 400, no charge.
 */
import express from "express";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const PROFILE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const chargeCalls = vi.hoisted(() => ({ count: 0 }));

const state = {
  entries: [] as Array<{ user_id: string; entry_type: string; amount_cents: number; entry_date: string }>,
  items: [] as Array<Record<string, unknown> & { _seq: number }>,
  goals: new Map<string, { user_id: string; monthly_goal_cents: number | null }>(),
  songs: [] as Array<{ user_id: string; title: string; genre: string | null; created_at: number }>,
  releases: [] as Array<{ user_id: string; status: string; id: string }>,
  profiles: [] as Array<Record<string, unknown>>,
  products: [] as Array<{ profileId: string }>,
  tiers: [] as Array<{ user_id: string }>,
  sums: { store_orders: 0, shop_events: 0, fan_members: 0, sponsor_payouts: 0, live_stream_tips: 0 },
};
let itemSeq = 0;

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content: "{}" } }] }) } },
  }),
  getTextModel: () => "test-model",
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: async () => {
    chargeCalls.count += 1;
    return 99_900;
  },
  refundCredits: async () => 99_900,
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsage: async () => undefined,
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.userId = (req.headers["x-test-user"] as string) || USER_A;
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const dialect = new PgDialect();
  const render = (cond: unknown): string[] =>
    ((dialect.sqlToQuery(cond as never).params as unknown[]) ?? []).map(String);

  const rowsFor = (table: unknown, cond: unknown): Array<Record<string, unknown>> => {
    const params = render(cond);
    if (table === actual.moneyEntriesTable) {
      return state.entries.filter((e) => params.includes(e.user_id)) as unknown as Array<Record<string, unknown>>;
    }
    if (table === actual.coachActionItemsTable) {
      return state.items.filter((r) => params.includes(String(r.user_id)));
    }
    if (table === actual.coachGoalsTable) {
      return [...state.goals.values()].filter((g) => params.includes(g.user_id)) as unknown as Array<
        Record<string, unknown>
      >;
    }
    if (table === actual.songsTable) {
      return state.songs
        .filter((s) => params.includes(s.user_id))
        .sort((a, b) => b.created_at - a.created_at) as unknown as Array<Record<string, unknown>>;
    }
    if (table === actual.distributionReleasesTable) {
      const submittedOnly = params.includes("draft");
      return state.releases.filter(
        (r) => params.includes(r.user_id) && (!submittedOnly || r.status !== "draft"),
      ) as unknown as Array<Record<string, unknown>>;
    }
    if (table === actual.creatorProfilesTable) {
      return state.profiles.filter((p) => params.includes(String(p.userId)));
    }
    if (table === actual.storeProductsTable) {
      return state.products.filter((p) => params.includes(p.profileId)) as unknown as Array<Record<string, unknown>>;
    }
    if (table === actual.fanTiersTable) {
      return state.tiers.filter((t) => params.includes(t.user_id)) as unknown as Array<Record<string, unknown>>;
    }
    return [];
  };

  const select = (fields?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      let rows: Array<Record<string, unknown>> = [];
      let orderSpec: { col: string; dir: 1 | -1 } | null = null;
      const resolveRows = () => {
        let out = [...rows];
        if (orderSpec) {
          const { col, dir } = orderSpec;
          out.sort((a, b) => {
            const av = a[col] as never;
            const bv = b[col] as never;
            return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
          });
        } else if (table === actual.coachActionItemsTable) {
          out.sort(
            (a, b) =>
              Number(a.done) - Number(b.done) ||
              Number(a.sort_order) - Number(b.sort_order) ||
              Number(a._seq) - Number(b._seq),
          );
        }
        return out;
      };
      const chain: Record<string, unknown> = {
        where: (cond: unknown) => {
          const all = rowsFor(table, cond);
          rows = fields && "n" in fields ? [{ n: all.length }] : all;
          return chain;
        },
        orderBy: (...args: unknown[]) => {
          if (args.length === 1) {
            try {
              const sqlText = dialect.sqlToQuery(args[0] as never).sql;
              const m = sqlText.match(/"(\w+)"\s+(asc|desc)/i);
              if (m) orderSpec = { col: m[1], dir: m[2].toLowerCase() === "desc" ? -1 : 1 };
            } catch {
              /* leave unordered */
            }
          }
          return chain;
        },
        limit: (n: number) => Promise.resolve(resolveRows().slice(0, n)),
        then: (resolve: (v: unknown) => void) => resolve(resolveRows()),
      };
      return chain;
    },
  });

  const execute = async (q: unknown) => {
    const text = ((q as { queryChunks?: Array<{ value?: unknown }> })?.queryChunks ?? [])
      .map((c) => (Array.isArray(c.value) ? c.value.join(" ") : typeof c.value === "string" ? c.value : ""))
      .join(" ");
    if (text.includes("store_orders")) return { rows: [{ cents: state.sums.store_orders }] };
    if (text.includes("shop_events")) return { rows: [{ cents: state.sums.shop_events }] };
    if (text.includes("fan_members")) return { rows: [{ cents: state.sums.fan_members }] };
    if (text.includes("sponsor_payouts")) return { rows: [{ cents: state.sums.sponsor_payouts }] };
    if (text.includes("live_stream_tips")) return { rows: [{ vb: state.sums.live_stream_tips }] };
    return { rows: [] };
  };

  const insert = (table: unknown) => ({
    values: (v: Record<string, unknown>) => {
      const apply = (): Array<Record<string, unknown>> => {
        if (table === actual.coachGoalsTable) {
          const existing = state.goals.get(String(v.user_id));
          if (existing) return [existing as unknown as Record<string, unknown>];
          const row = { user_id: String(v.user_id), monthly_goal_cents: (v.monthly_goal_cents as number | null) ?? null };
          state.goals.set(row.user_id, row);
          return [row as unknown as Record<string, unknown>];
        }
        itemSeq += 1;
        const row: Record<string, unknown> & { _seq: number } = {
          id: `00000000-0000-4000-8000-${String(itemSeq).padStart(12, "0")}`,
          done: false,
          completed_at: null,
          created_at: new Date(),
          updated_at: new Date(),
          ...v,
          _seq: itemSeq,
        };
        state.items.push(row);
        return [row];
      };
      const chain: Record<string, unknown> = {
        returning: async () => apply(),
        onConflictDoUpdate: (cfg: { set: Record<string, unknown> }) => {
          if (table === actual.coachGoalsTable) {
            const existing = state.goals.get(String(v.user_id));
            if (existing) Object.assign(existing, cfg.set);
          }
          return chain;
        },
        then: (resolve: (v: unknown) => void) => resolve(apply()),
      };
      return chain;
    },
  });

  const matchItems = (cond: unknown) => {
    const params = render(cond);
    return state.items.filter((r) => params.includes(String(r.id)) && params.includes(String(r.user_id)));
  };

  const update = (table: unknown) => ({
    set: (patch: Record<string, unknown>) => ({
      where: (cond: unknown) => {
        const apply = () => {
          if (table !== actual.coachActionItemsTable) return [];
          const matched = matchItems(cond);
          for (const row of matched) Object.assign(row, patch);
          return matched;
        };
        return {
          returning: async () => apply(),
          then: (resolve: (v: unknown) => void) => resolve(apply()),
        };
      },
    }),
  });

  const del = (table: unknown) => ({
    where: (cond: unknown) => {
      const apply = () => {
        if (table !== actual.coachActionItemsTable) return [];
        const matched = matchItems(cond);
        state.items = state.items.filter((r) => !matched.includes(r));
        return matched;
      };
      return {
        returning: async () => apply(),
        then: (resolve: (v: unknown) => void) => resolve(apply()),
      };
    },
  });

  return { ...actual, db: { select, execute, insert, update, delete: del } };
});

import coachTrackerRouter, { computePlanNumbers } from "../coach-tracker";
import nicheAnalyzerRouter from "../generate/niche-analyzer";

/* ── the model call is doubled at the fetch seam, capturing the prompt ── */
const realFetch = globalThis.fetch;
const capturedPrompts: string[] = [];
const CANNED_ANALYSIS = {
  audienceProfile: { demographics: "Young church-going music fans.", interests: ["worship", "choir"] },
  contentGaps: [{ angle: "Choir warm-ups", whyUnderserved: "Few do it.", opportunity: "Own it." }],
  monetizationPaths: [{ path: "Choir coaching", fitScore: 90, why: "Fits.", firstStep: "Post a lesson." }],
  competitionScore: 40,
  contentPillars: [{ name: "Pillar", description: "Core.", exampleIdeas: ["Idea one"] }],
  roadmap30Day: [{ week: 1, focus: "Start", angles: ["Angle one"] }],
  summary: "Own the choir lane.",
};

let server: ReturnType<express.Express["listen"]>;
let base = "";

beforeAll(async () => {
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    if (String(url).includes("api.openai.com")) {
      const body = JSON.parse(init?.body ?? "{}") as { messages?: Array<{ content?: string }> };
      capturedPrompts.push(body.messages?.[0]?.content ?? "");
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(CANNED_ANALYSIS) } }] }),
      } as Response;
    }
    return realFetch(url as string, init as RequestInit);
  }) as typeof fetch;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: () => undefined, warn: () => undefined, info: () => undefined };
    next();
  });
  app.use(coachTrackerRouter);
  app.use(nicheAnalyzerRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function reset() {
  state.entries = [];
  state.items = [];
  state.goals.clear();
  state.songs = [];
  state.releases = [];
  state.profiles = [{ id: PROFILE_A, userId: USER_A }];
  state.products = [];
  state.tiers = [];
  state.sums = { store_orders: 0, shop_events: 0, fan_members: 0, sponsor_payouts: 0, live_stream_tips: 0 };
  chargeCalls.count = 0;
  capturedPrompts.length = 0;
}

beforeEach(reset);

async function call(
  method: string,
  path: string,
  body?: unknown,
  user: string = USER_A,
): Promise<{ status: number; body: any }> {
  const res = await realFetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** YYYY-MM for a month offset from today (UTC), matching the route's keys. */
function monthKey(offset: number): string {
  const d = new Date();
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 15));
  return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
}
const on = (offset: number) => `${monthKey(offset)}-15`;

describe("plan numbers — pure math", () => {
  const now = new Date(Date.UTC(2026, 9, 19)); // Oct 2026
  const baseInput = {
    earningsCents: 0,
    tipsVb: 0,
    catalog: { songs: 0, releases: 0, storeProducts: 0, membershipTiers: 0 },
    goalCents: null,
    now,
  };

  it("averages only complete months with entries; current month kept apart", () => {
    const out = computePlanNumbers({
      ...baseInput,
      entries: [
        { entry_type: "income", amount_cents: 30_000, entry_date: "2026-09-10" },
        { entry_type: "expense", amount_cents: 10_000, entry_date: "2026-09-11" },
        { entry_type: "income", amount_cents: 10_000, entry_date: "2026-08-05" },
        { entry_type: "income", amount_cents: 20_000, entry_date: "2026-07-22" },
        { entry_type: "expense", amount_cents: 5_000, entry_date: "2026-07-23" },
        { entry_type: "income", amount_cents: 5_000, entry_date: "2026-10-02" },
      ],
    });
    expect(out.currentMonth).toEqual({ key: "2026-10", incomeCents: 5_000, expenseCents: 0, netCents: 5_000 });
    expect(out.trailing.monthsCounted).toBe(3);
    expect(out.trailing.avgMonthlyIncomeCents).toBe(20_000);
    expect(out.trailing.avgMonthlyNetCents).toBe(15_000);
    expect(out.allTimeLedger).toEqual({ incomeCents: 65_000, expenseCents: 15_000, netCents: 50_000, entryCount: 6 });
    expect(out.hasData).toBe(true);
  });

  it("goal math: percent, gap, and months of net pace to bank a goal month", () => {
    const out = computePlanNumbers({
      ...baseInput,
      goalCents: 25_000,
      entries: [
        { entry_type: "income", amount_cents: 30_000, entry_date: "2026-09-10" },
        { entry_type: "expense", amount_cents: 10_000, entry_date: "2026-09-11" },
        { entry_type: "income", amount_cents: 10_000, entry_date: "2026-08-05" },
        { entry_type: "income", amount_cents: 20_000, entry_date: "2026-07-22" },
        { entry_type: "expense", amount_cents: 5_000, entry_date: "2026-07-23" },
      ],
    });
    expect(out.goal).toEqual({
      monthlyGoalCents: 25_000,
      percentOfGoal: 80,
      monthlyGapCents: 5_000,
      met: false,
      monthsOfNetToBankGoalMonth: 2,
    });
  });

  it("no entries and no earnings = honest not-enough-data; platform-only still counts", () => {
    const empty = computePlanNumbers({ ...baseInput, entries: [] });
    expect(empty.hasData).toBe(false);
    expect(empty.trailing.avgMonthlyIncomeCents).toBeNull();
    const platformOnly = computePlanNumbers({ ...baseInput, entries: [], earningsCents: 4_200 });
    expect(platformOnly.hasData).toBe(true);
    expect(platformOnly.trailing.avgMonthlyIncomeCents).toBeNull();
  });
});

describe("plan numbers — endpoint reads the caller's own ledger", () => {
  it("sums the caller's entries + platform earnings; goal flows through", async () => {
    state.entries = [
      { user_id: USER_A, entry_type: "income", amount_cents: 30_000, entry_date: on(-1) },
      { user_id: USER_A, entry_type: "expense", amount_cents: 10_000, entry_date: on(-1) },
      { user_id: USER_A, entry_type: "income", amount_cents: 10_000, entry_date: on(-2) },
      { user_id: USER_A, entry_type: "income", amount_cents: 20_000, entry_date: on(-3) },
      { user_id: USER_A, entry_type: "expense", amount_cents: 5_000, entry_date: on(-3) },
      { user_id: USER_A, entry_type: "income", amount_cents: 5_000, entry_date: on(0) },
      { user_id: USER_B, entry_type: "income", amount_cents: 999_900, entry_date: on(-1) },
    ];
    state.sums = { store_orders: 10_000, shop_events: 0, fan_members: 5_000, sponsor_payouts: 0, live_stream_tips: 250 };

    const goalRes = await call("PUT", "/coach/goal", { monthlyGoalCents: 25_000 });
    expect(goalRes.status).toBe(200);

    const res = await call("GET", "/coach/plan-numbers");
    expect(res.status).toBe(200);
    expect(res.body.currentMonth.incomeCents).toBe(5_000);
    expect(res.body.trailing.avgMonthlyIncomeCents).toBe(20_000);
    expect(res.body.trailing.avgMonthlyNetCents).toBe(15_000);
    expect(res.body.allTimeLedger.entryCount).toBe(6);
    expect(res.body.platform.earningsCents).toBe(15_000);
    expect(res.body.platform.tipsVb).toBe(250);
    expect(res.body.goal.percentOfGoal).toBe(80);
    expect(res.body.goal.monthlyGapCents).toBe(5_000);
    expect(res.body.hasData).toBe(true);
  });

  it("a second creator sees none of the first creator's numbers", async () => {
    state.entries = [
      { user_id: USER_A, entry_type: "income", amount_cents: 30_000, entry_date: on(-1) },
    ];
    const res = await call("GET", "/coach/plan-numbers", undefined, USER_B);
    expect(res.status).toBe(200);
    expect(res.body.allTimeLedger.entryCount).toBe(0);
    expect(res.body.trailing.avgMonthlyIncomeCents).toBeNull();
    expect(res.body.platform.earningsCents).toBe(0);
    expect(res.body.goal).toBeNull();
    expect(res.body.hasData).toBe(false);
  });

  it("goal can be set, changed, and cleared", async () => {
    expect((await call("PUT", "/coach/goal", { monthlyGoalCents: 10_000 })).body.goal.monthlyGoalCents).toBe(10_000);
    expect((await call("PUT", "/coach/goal", { monthlyGoalCents: 42_000 })).body.goal.monthlyGoalCents).toBe(42_000);
    expect((await call("PUT", "/coach/goal", { monthlyGoalCents: null })).body.goal.monthlyGoalCents).toBeNull();
    const items = await call("GET", "/coach/action-items");
    expect(items.body.goal.monthlyGoalCents).toBeNull();
    const bad = await call("PUT", "/coach/goal", { monthlyGoalCents: -5 });
    expect(bad.status).toBe(400);
  });
});

describe("action tracker — persistence, check-off, owner scope", () => {
  it("saves plan moves, dedupes a re-save, checks off, deletes", async () => {
    const moves = ["Distribute the vault songs", "Stock the store", "Pitch two sponsors"];
    const first = await call("POST", "/coach/action-items", { titles: moves, source: "plan" });
    expect(first.status).toBe(201);
    expect(first.body.items).toHaveLength(3);
    expect(first.body.skipped).toHaveLength(0);

    const again = await call("POST", "/coach/action-items", { titles: moves, source: "plan" });
    expect(again.body.items).toHaveLength(0);
    expect(again.body.skipped).toHaveLength(3);

    const list = await call("GET", "/coach/action-items");
    expect(list.body.items.map((i: any) => i.title)).toEqual(moves);
    expect(list.body.items[0].done).toBe(false);
    expect(list.body.items[0].completedAt).toBeNull();

    const id = list.body.items[0].id as string;
    const checked = await call("PATCH", `/coach/action-items/${id}`, { done: true });
    expect(checked.status).toBe(200);
    expect(checked.body.item.done).toBe(true);
    expect(checked.body.item.completedAt).not.toBeNull();

    const unchecked = await call("PATCH", `/coach/action-items/${id}`, { done: false });
    expect(unchecked.body.item.completedAt).toBeNull();

    const del = await call("DELETE", `/coach/action-items/${id}`);
    expect(del.body.ok).toBe(true);
    const delAgain = await call("DELETE", `/coach/action-items/${id}`);
    expect(delAgain.status).toBe(404);
  });

  it("custom items work and lists are per-user", async () => {
    await call("POST", "/coach/action-items", { title: "A's private item" });
    const bList = await call("GET", "/coach/action-items", undefined, USER_B);
    expect(bList.body.items).toHaveLength(0);
    const aList = await call("GET", "/coach/action-items");
    expect(aList.body.items).toHaveLength(1);
    expect(aList.body.items[0].source).toBe("custom");
  });

  it("another creator cannot check off or delete my item (404, state untouched)", async () => {
    const created = await call("POST", "/coach/action-items", { title: "Mine only" });
    const id = created.body.items[0].id as string;
    const patch = await call("PATCH", `/coach/action-items/${id}`, { done: true }, USER_B);
    expect(patch.status).toBe(404);
    const del = await call("DELETE", `/coach/action-items/${id}`, undefined, USER_B);
    expect(del.status).toBe(404);
    const list = await call("GET", "/coach/action-items");
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].done).toBe(false);
  });

  it("rejects empty titles and non-uuid ids", async () => {
    expect((await call("POST", "/coach/action-items", { title: "   " })).status).toBe(400);
    expect((await call("POST", "/coach/action-items", {})).status).toBe(400);
    expect((await call("PATCH", "/coach/action-items/not-a-uuid", { done: true })).status).toBe(400);
  });
});

describe("niche analyzer — grounded in the caller's own data only", () => {
  function seedCatalogs() {
    state.profiles = [
      {
        id: PROFILE_A,
        userId: USER_A,
        vertical: "music",
        mediaKit: { niches: ["gospel rap", "choir coaching"] },
        followerCount: 1240,
        totalPlays: 30_500,
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        userId: USER_B,
        vertical: "music",
        mediaKit: { niches: ["death metal"] },
        followerCount: 10,
        totalPlays: 10,
      },
    ];
    state.songs = [
      { user_id: USER_A, title: "Midnight Crown", genre: "gospel rap", created_at: 3 },
      { user_id: USER_A, title: "Altar Call", genre: "gospel rap", created_at: 2 },
      { user_id: USER_A, title: "Choir Robes", genre: "gospel rap", created_at: 1 },
      { user_id: USER_B, title: "Skull Anthem", genre: "death metal", created_at: 9 },
    ];
    state.releases = [{ user_id: USER_A, status: "live", id: "rel-1" }];
  }

  it("derives the niche from the caller's catalog and grounds the prompt in it", async () => {
    seedCatalogs();
    const res = await call("POST", "/analyze-niche", { useMyData: true, targetPlatform: "youtube" });
    expect(res.status).toBe(200);
    expect(res.body.analysis.niche).toBe("gospel rap");
    expect(res.body.groundedIn.songs).toBe(3);
    expect(res.body.groundedIn.releases).toBe(1);
    expect(res.body.groundedIn.topGenres).toEqual(["gospel rap"]);
    const prompt = capturedPrompts.join("\n");
    expect(prompt).toContain("Midnight Crown");
    expect(prompt).toContain("gospel rap (3)");
    expect(prompt).not.toContain("death metal");
    expect(prompt).not.toContain("Skull Anthem");
  });

  it("no profile and no catalog = honest 400 and NO charge", async () => {
    state.profiles = [];
    const res = await call("POST", "/analyze-niche", { useMyData: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("not_enough_data");
    expect(chargeCalls.count).toBe(0);
  });

  it("typed niche without useMyData stays ungrounded (existing behavior)", async () => {
    seedCatalogs();
    const res = await call("POST", "/analyze-niche", { niche: "skincare" });
    expect(res.status).toBe(200);
    expect(res.body.analysis.niche).toBe("skincare");
    expect(res.body.groundedIn).toBeNull();
    expect(capturedPrompts.join("\n")).not.toContain("Midnight Crown");
  });
});
