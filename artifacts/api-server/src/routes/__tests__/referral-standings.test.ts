/**
 * referral-standings.test.ts — Stack-200 lane 2 topology unification.
 *
 * The referral-fix lane flagged (DIAGNOSIS.md Q4) that getStandings()
 * read referrals / referral_payouts / creator_profiles through the
 * drizzle db (DATABASE_URL) while EVERY write — apply, payout,
 * milestones — goes through Supabase, a different database (see
 * supabase/migrations/0059). Standings therefore read a store the
 * award path never touches.
 *
 * This suite seeds ONLY the fake Supabase store and rigs the drizzle
 * db to throw on any use: if the leaderboard, the /referrals/me
 * ranks, or the contest standings still read drizzle, they come back
 * empty/500 and the test fails. Ordering pins the old SQL semantics:
 * signups desc, revenue desc, first-signup asc; names resolve only
 * from PUBLIC Supabase creator_profiles.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";

const A = "11111111-1111-4111-8111-111111111111";
const D = "44444444-4444-4444-8444-444444444444";
const E = "55555555-5555-4555-8555-555555555555";
const F = "66666666-6666-4666-8666-666666666666";

type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  state: {
    codes: [] as Row[],
    referrals: [] as Row[],
    payouts: [] as Row[],
    milestones: [] as Row[],
    contests: [] as Row[],
    prizes: [] as Row[],
    profiles: [] as Row[],
  },
}));

function selectChain(rows: Row[]) {
  const preds: Array<(r: Row) => boolean> = [];
  let sortCol: string | null = null;
  let slice: [number, number] | null = null;
  const matchedBase = () => rows.filter((r) => preds.every((p) => p(r)));
  const matched = () => {
    let m = matchedBase();
    if (sortCol) {
      const col = sortCol;
      m = [...m].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")));
    }
    if (slice) m = m.slice(slice[0], slice[1] + 1);
    return m;
  };
  const builder: any = {
    eq: (col: string, v: unknown) => { preds.push((r) => r[col] === v); return builder; },
    gte: (col: string, v: unknown) => { preds.push((r) => r[col] != null && String(r[col]) >= String(v)); return builder; },
    lt: (col: string, v: unknown) => { preds.push((r) => r[col] != null && String(r[col]) < String(v)); return builder; },
    in: (col: string, vals: unknown[]) => { preds.push((r) => vals.includes(r[col])); return builder; },
    order: (col: string) => { sortCol = col; return builder; },
    range: (from: number, to: number) => { slice = [from, to]; return builder; },
    limit: (n: number) => { slice = [0, n - 1]; return builder; },
    single: async () => {
      const m = matched();
      return m.length ? { data: m[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
    },
    maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
    then: (res: any, rej: any) =>
      Promise.resolve({ data: matched(), error: null, count: matchedBase().length }).then(res, rej),
  };
  return builder;
}

function makeFakeSupabase() {
  const s = h.state;
  const tables: Record<string, Row[]> = {
    referral_codes: s.codes,
    referrals: s.referrals,
    referral_payouts: s.payouts,
    referral_milestones: s.milestones,
    referral_contests: s.contests,
    referral_contest_prizes: s.prizes,
    creator_profiles: s.profiles,
  };
  return {
    from: (table: string) => {
      const rows = tables[table];
      if (!rows) throw new Error(`fake supabase: unexpected table ${table}`);
      return {
        select: (_cols?: string, _opts?: unknown) => selectChain(rows),
        insert: (vals: Row) => {
          const row = { id: `row-${rows.length + 1}`, ...vals };
          rows.push(row);
          const p: any = Promise.resolve({ error: null });
          p.select = (_c: string) => ({ single: async () => ({ data: row, error: null }) });
          return p;
        },
        update: () => { throw new Error("fake supabase: update not needed here"); },
        delete: () => { throw new Error("fake supabase: delete not needed here"); },
      };
    },
    rpc: (_name: string, _args: unknown) => Promise.reject(new Error("rpc missing (test)")),
  };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) return res.status(401).json({ error: "Unauthorized" });
    req.userId = String(u);
    next();
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => makeFakeSupabase(),
  addCreditsToProfile: vi.fn(async () => ({ oldCredits: 0, newCredits: 0, created: false })),
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: vi.fn(async () => {}),
}));

/* The whole point: the drizzle store must never be consulted. */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    db: {
      execute: async () => {
        throw new Error("drizzle db must not be used for referral standings (topology test)");
      },
    },
  };
});

import referralsRouter from "../referrals";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    next();
  });
  app.use("/api", referralsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

beforeEach(() => {
  const s = h.state;
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const mkReferrals = (referrer: string, n: number, firstMsAgo: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `ref-${referrer.slice(0, 4)}-${i}`,
      referrer_user_id: referrer,
      referee_user_id: `referee-${referrer.slice(0, 4)}-${i}`,
      total_referrer_earned: 0,
      share_expires_at: iso(-30 * 86400000),
      created_at: iso(firstMsAgo - i * 60000),
    }));
  /* F and A tie on signups (3) and revenue (250) — F signed up first.
     E also has 3 signups but no revenue. D has 1 signup, most revenue. */
  s.referrals = [
    ...mkReferrals(F, 3, 5 * 86400000),
    ...mkReferrals(A, 3, 3 * 86400000),
    ...mkReferrals(E, 3, 1 * 86400000),
    ...mkReferrals(D, 1, 2 * 86400000),
  ];
  s.payouts = [
    { id: "pay-f", referral_id: `ref-${F.slice(0, 4)}-0`, referrer_credits_awarded: 250, created_at: iso(2 * 86400000) },
    { id: "pay-a", referral_id: `ref-${A.slice(0, 4)}-0`, referrer_credits_awarded: 250, created_at: iso(2 * 86400000) },
    { id: "pay-d", referral_id: `ref-${D.slice(0, 4)}-0`, referrer_credits_awarded: 1000, created_at: iso(2 * 86400000) },
  ];
  s.profiles = [
    { user_id: A, display_name: "Alice", slug: "alice", is_public: true },
    { user_id: D, display_name: "Dan", slug: "dan", is_public: true },
    { user_id: F, display_name: "Fran", slug: "fran", is_public: false },
    /* E has no profile at all. */
  ];
  s.codes = [{ user_id: A, code: "ALICE123" }];
  s.milestones = [];
  s.prizes = [];
  const curStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const curEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
  s.contests = [{
    id: "contest-current",
    period: periodOf(new Date()),
    starts_at: curStart.toISOString(),
    ends_at: curEnd.toISOString(),
    status: "open",
  }];
});

describe("standings read the Supabase store the awards write", () => {
  it("GET /referrals/leaderboard?window=alltime aggregates Supabase rows with SQL-identical ordering", async () => {
    const res = await fetch(`${base}/api/referrals/leaderboard?window=alltime`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.entries.map((e: any) => [e.rank, e.signups, e.revenue])).toEqual([
      [1, 3, 250], // F — wins the tie on first signup
      [2, 3, 250], // A
      [3, 3, 0],   // E
      [4, 1, 1000], // D — signups outrank revenue
    ]);
    expect(body.entries[1].name).toBe("Alice");
    expect(body.entries[1].slug).toBe("alice");
    /* F's profile is private and E has none: both stay anonymous. */
    expect(body.entries[0].name).toBe("Anonymous Recruiter");
    expect(body.entries[0].slug).toBeNull();
    expect(body.entries[2].name).toBe("Anonymous Recruiter");
    expect(body.entries[3].name).toBe("Dan");
  });

  it("GET /referrals/me ranks come from the same standings", async () => {
    const res = await fetch(`${base}/api/referrals/me`, { headers: { "x-test-user": A } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ranks.alltime).toBe(2);
    expect(body.ranks.weekly).toBe(2);
    expect(body.ranks.monthly).toBe(2);
  });

  it("GET /referrals/contest standings come from the same standings", async () => {
    const res = await fetch(`${base}/api/referrals/contest`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.standings.map((e: any) => e.rank)).toEqual([1, 2, 3, 4]);
    expect(body.standings[0].signups).toBe(3);
    expect(body.standings[0].revenue).toBe(250);
  });

  it("an out-of-window signup does not leak into the weekly standings", async () => {
    const old = {
      id: "ref-old-0",
      referrer_user_id: D,
      referee_user_id: "referee-old-0",
      total_referrer_earned: 0,
      share_expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    };
    h.state.referrals.push(old, { ...old, id: "ref-old-1", referee_user_id: "referee-old-1" });
    const weekly = (await (await fetch(`${base}/api/referrals/leaderboard?window=weekly`)).json()) as any;
    const dWeekly = weekly.entries.find((e: any) => e.name === "Dan");
    expect(dWeekly.signups).toBe(1); // only the in-window signup counts
    const alltime = (await (await fetch(`${base}/api/referrals/leaderboard?window=alltime`)).json()) as any;
    const dAll = alltime.entries.find((e: any) => e.name === "Dan");
    expect(dAll.signups).toBe(3);
  });
});
