/**
 * Tests for the referral-contest settlement claim (routes/referrals,
 * settleReferralContests → settleOneContest).
 *
 * The prize row insert is the claim (UNIQUE(contest_id, referrer_user_id)
 * is the backstop) and the payment follows it. That ordering prevents
 * double-pay — but the original code let a payment failure strand the
 * winner: the row stayed, every later settle skipped them as "already
 * awarded", and the contest was marked settled. Prize never paid, no
 * retry path.
 *
 * The hardened settle releases the claim (deletes the prize row) when
 * the payment throws and leaves the contest OPEN if any prize failed,
 * so the next lazy settle pass retries exactly the unpaid winners.
 *
 * Fake Supabase (in-memory tables, UNIQUE emulated) + fake db.execute
 * standings. The module's settle-once promise guard is real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const A = "aaaaaaaa-1111-4111-8111-111111111111"; // rank 1 — 25,000
const B = "bbbbbbbb-2222-4222-8222-222222222222"; // rank 2 — 10,000
const C = "cccccccc-3333-4333-8333-333333333333"; // rank 3 — 5,000

const h = vi.hoisted(() => ({
  state: {
    contests: [] as Array<Record<string, any>>,
    prizes: [] as Array<Record<string, any>>,
    payCalls: [] as Array<{ userId: string; amount: number }>,
    payFailures: new Set<string>(),
    prizeDeletes: [] as Array<{ contest_id: string; referrer_user_id: string }>,
    settledUpdates: [] as string[],
  },
}));

const dialect = new PgDialect();

function eqChain(rows: Array<Record<string, any>>) {
  const filters: Array<[string, unknown]> = [];
  const matched = () => rows.filter((r) => filters.every(([k, v]) => r[k] === v));
  const builder: any = {
    eq: (col: string, v: unknown) => {
      filters.push([col, v]);
      return builder;
    },
    maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
    single: async () => ({ data: matched()[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: matched(), error: null }).then(res, rej),
  };
  return builder;
}

function makeFakeSupabase() {
  const s = h.state;
  return {
    from: (table: string) => {
      if (table === "referral_contests") {
        return {
          select: (_cols: string) => eqChain(s.contests),
          insert: (vals: Record<string, any>) => ({
            select: (_cols: string) => ({
              single: async () => {
                const row = { id: `contest-${vals["period"]}`, ...vals };
                s.contests.push(row);
                return { data: { id: row.id }, error: null };
              },
            }),
          }),
          update: (patch: Record<string, any>) => ({
            eq: (_col: string, id: string) => {
              const row = s.contests.find((c) => c.id === id);
              if (row) Object.assign(row, patch);
              if (patch["status"] === "settled") s.settledUpdates.push(id);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === "referral_contest_prizes") {
        return {
          select: (_cols: string) => eqChain(s.prizes),
          insert: (vals: Record<string, any>) => {
            const dupe = s.prizes.some(
              (p) => p.contest_id === vals["contest_id"] && p.referrer_user_id === vals["referrer_user_id"],
            );
            if (dupe) {
              return Promise.resolve({
                error: { code: "23505", message: "duplicate key value violates unique constraint" },
              });
            }
            s.prizes.push({ id: `prize-${s.prizes.length + 1}`, ...vals });
            return Promise.resolve({ error: null });
          },
          delete: () => {
            const filters: Array<[string, unknown]> = [];
            const builder: any = {
              eq: (col: string, v: unknown) => {
                filters.push([col, v]);
                if (filters.length === 2) {
                  const [c1, v1] = filters[0]!;
                  const [c2, v2] = filters[1]!;
                  const idx = s.prizes.findIndex((p) => p[c1] === v1 && p[c2] === v2);
                  if (idx >= 0) s.prizes.splice(idx, 1);
                  s.prizeDeletes.push({
                    contest_id: String(filters.find(([k]) => k === "contest_id")?.[1]),
                    referrer_user_id: String(filters.find(([k]) => k === "referrer_user_id")?.[1]),
                  });
                  return Promise.resolve({ error: null });
                }
                return builder;
              },
            };
            return builder;
          },
        };
      }
      throw new Error(`fake supabase: unexpected table ${table}`);
    },
  };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => makeFakeSupabase(),
  addCreditsToProfile: vi.fn(async (userId: string, amount: number) => {
    if (h.state.payFailures.has(userId)) {
      throw new Error("payment failed (test)");
    }
    h.state.payCalls.push({ userId, amount });
    return { oldCredits: 0, newCredits: amount, created: false };
  }),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    db: {
      execute: async (arg: unknown) => {
        const text = dialect.sqlToQuery(arg as never).sql;
        if (text.includes("FROM referrals")) {
          return {
            rows: [
              { referrerUserId: A, signups: 30, revenue: 900, firstSignup: "2026-09-02" },
              { referrerUserId: B, signups: 20, revenue: 500, firstSignup: "2026-09-03" },
              { referrerUserId: C, signups: 10, revenue: 100, firstSignup: "2026-09-04" },
            ],
          };
        }
        return { rows: [] }; // DDL from ensureReferralTables
      },
    },
  };
});

import { settleReferralContests } from "../referrals";

const ENDED_ID = "contest-ended";

function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

beforeEach(() => {
  const now = new Date();
  const curStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const curEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  h.state.contests = [
    {
      id: "contest-current",
      period: periodOf(now),
      starts_at: curStart.toISOString(),
      ends_at: curEnd.toISOString(),
      status: "open",
    },
    {
      id: ENDED_ID,
      period: "2020-01",
      starts_at: new Date(now.getTime() - 40 * 86400000).toISOString(),
      ends_at: new Date(now.getTime() - 86400000).toISOString(),
      status: "open",
    },
  ];
  h.state.prizes = [];
  h.state.payCalls = [];
  h.state.payFailures = new Set();
  h.state.prizeDeletes = [];
  h.state.settledUpdates = [];
});

describe("settleReferralContests — prize claim release + retry", () => {
  it("a failed prize payment releases the claim and leaves the contest open", async () => {
    h.state.payFailures = new Set([A]);
    await settleReferralContests();

    // B and C were paid; A's payment was attempted and failed.
    expect(h.state.payCalls).toEqual([
      { userId: B, amount: 10000 },
      { userId: C, amount: 5000 },
    ]);
    // A's prize claim was released (row deleted); B/C rows stand.
    expect(h.state.prizeDeletes).toEqual([{ contest_id: ENDED_ID, referrer_user_id: A }]);
    expect(h.state.prizes.map((p) => p.referrer_user_id).sort()).toEqual([B, C]);
    // The contest was NOT sealed settled with an unpaid winner.
    const contest = h.state.contests.find((c) => c.id === ENDED_ID)!;
    expect(contest.status).toBe("open");
    expect(h.state.settledUpdates).not.toContain(ENDED_ID);
  });

  it("the next settle pays ONLY the released winner, then settles", async () => {
    h.state.payFailures = new Set([A]);
    await settleReferralContests();
    h.state.payCalls = [];
    h.state.payFailures = new Set();

    await settleReferralContests();

    // A is retried and paid; B and C are NOT paid a second time.
    expect(h.state.payCalls).toEqual([{ userId: A, amount: 25000 }]);
    expect(h.state.prizes.map((p) => p.referrer_user_id).sort()).toEqual([A, B, C]);
    const contest = h.state.contests.find((c) => c.id === ENDED_ID)!;
    expect(contest.status).toBe("settled");
  });

  it("a clean settle pays each winner once and settles; a re-run pays nothing", async () => {
    await settleReferralContests();
    expect(h.state.payCalls).toEqual([
      { userId: A, amount: 25000 },
      { userId: B, amount: 10000 },
      { userId: C, amount: 5000 },
    ]);
    expect(h.state.contests.find((c) => c.id === ENDED_ID)!.status).toBe("settled");

    h.state.payCalls = [];
    await settleReferralContests();
    expect(h.state.payCalls).toHaveLength(0); // settled contests are skipped
  });
});
