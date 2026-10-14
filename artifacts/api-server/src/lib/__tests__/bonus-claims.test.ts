/**
 * bonus-claims.test.ts — claimDailyBonus / spinWheel race hardening.
 *
 * Both claims used to be read-check-write against Supabase profiles with
 * an UNCONDITIONAL update: two concurrent requests could both read the
 * pre-claim state (yesterday's daily claim / an old wheel spin), both
 * pass the check, and both grant — a double daily bonus and two wheel
 * prizes on one cooldown.
 *
 * The fix moves the predicate into the UPDATE itself (`.or(...)` +
 * `.select()`): the claim only lands while last_daily_claim is still
 * not today / last_wheel_spin is still past the cooldown cutoff, and
 * zero updated rows means the race was lost.
 *
 * The fake Supabase client below keeps an in-memory profiles row and
 * applies each UPDATE — predicate evaluation included — as one
 * synchronous step, which is exactly the atomicity a single Postgres
 * UPDATE statement has. If the production code dropped the `.or()`
 * guard, both concurrent claims would land here and the grant counts
 * would double, failing the tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  state: {
    profiles: new Map<string, Row>(),
  },
}));

/** Evaluate one PostgREST .or() clause against a row. */
function evalClause(row: Row, clause: string): boolean {
  const m = clause.match(/^([a-z_]+)\.(is|neq|lte|lt|gte|eq)\.(.+)$/);
  if (!m) throw new Error(`fake supabase: unsupported .or clause "${clause}"`);
  const [, col, op, raw] = m as unknown as [string, string, string, string];
  const val = row[col!];
  switch (op) {
    case "is":
      return raw === "null" ? val === null || val === undefined : val === raw;
    case "neq":
      return val !== raw;
    case "eq":
      return val === raw;
    case "lte":
      return typeof val === "string" && val <= raw;
    case "lt":
      return typeof val === "string" && val < raw;
    case "gte":
      return typeof val === "string" && val >= raw;
    default:
      throw new Error(`fake supabase: unsupported op ${op}`);
  }
}

function project(row: Row, cols: string): Row {
  if (cols.trim() === "*") return { ...row };
  const out: Row = {};
  for (const c of cols.split(",").map((s) => s.trim())) out[c] = row[c] ?? null;
  return out;
}

function makeFakeSupabase() {
  const store = h.state.profiles;
  return {
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`fake supabase: unexpected table ${table}`);
      return {
        select: (cols: string) => ({
          eq: (_col: string, id: string) => ({
            maybeSingle: async () => {
              const row = store.get(id);
              return { data: row ? project(row, cols) : null, error: null };
            },
            single: async () => {
              const row = store.get(id);
              return row
                ? { data: project(row, cols), error: null }
                : { data: null, error: { code: "PGRST116", message: "not found" } };
            },
          }),
        }),
        update: (vals: Row) => {
          let id: string | null = null;
          let orFilter: string | null = null;
          let executed = false;
          const apply = (): { data: Row[] | null; error: null } => {
            if (executed) return { data: null, error: null };
            executed = true;
            const row = id ? store.get(id) : undefined;
            if (!row) return { data: [], error: null };
            if (orFilter) {
              const clauses = orFilter.split(",");
              if (!clauses.some((c) => evalClause(row, c))) {
                return { data: [], error: null }; // predicate failed: 0 rows
              }
            }
            Object.assign(row, vals);
            return { data: [project(row, "*")], error: null };
          };
          const builder: any = {
            eq: (_col: string, v: string) => {
              id = v;
              return builder;
            },
            or: (f: string) => {
              orFilter = f;
              return builder;
            },
            select: (_cols: string) => Promise.resolve(apply()),
            then: (res: any, rej: any) => Promise.resolve(apply()).then(res, rej),
          };
          return builder;
        },
        insert: (vals: Row) => {
          const id = String(vals["id"]);
          if (store.has(id)) {
            return Promise.resolve({
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            });
          }
          store.set(id, { ...vals });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: () => makeFakeSupabase(),
  addCreditsToProfile: vi.fn(async () => {
    throw new Error("bonus.ts must not call addCreditsToProfile");
  }),
  addCreditsAtomic: vi.fn(async () => {
    throw new Error("bonus.ts must not call addCreditsAtomic");
  }),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    db: {
      // ensureBonusColumns + the wheel_spins analytics insert: best-effort
      // in production, no-ops here.
      execute: async () => [],
      insert: () => {
        throw new Error("crate insert is not exercised by these tests");
      },
    },
  };
});

import { claimDailyBonus, spinWheel, utcYesterday, utcToday } from "../bonus";

const USER = "11111111-1111-4111-8111-111111111111";

function seedProfile(overrides: Row = {}): Row {
  const row: Row = {
    id: USER,
    bonus_credits: 0,
    bonus_credits_expires_at: null,
    daily_streak: 0,
    last_daily_claim: null,
    last_wheel_spin: null,
    streak_freezes: 0,
    ...overrides,
  };
  h.state.profiles.set(USER, row);
  return row;
}

beforeEach(() => {
  h.state.profiles = new Map();
});

describe("claimDailyBonus — CAS claim", () => {
  it("two concurrent claims grant exactly once", async () => {
    const row = seedProfile({ daily_streak: 2, last_daily_claim: utcYesterday() });
    const [a, b] = await Promise.all([claimDailyBonus(USER), claimDailyBonus(USER)]);
    const results = [a, b];
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(results.filter((r) => !r.claimed && r.reason === "already_claimed")).toHaveLength(1);
    const winner = results.find((r) => r.claimed)!;
    expect(winner.streak).toBe(3);
    expect(winner.bonusGranted).toBe(200);
    // The grant landed exactly once, and the claim stamp is today.
    expect(row.bonus_credits).toBe(200);
    expect(row.last_daily_claim).toBe(utcToday());
    expect(row.daily_streak).toBe(3);
  });

  it("already claimed today: no grant, no state change", async () => {
    const row = seedProfile({ daily_streak: 4, last_daily_claim: utcToday(), bonus_credits: 700 });
    const res = await claimDailyBonus(USER);
    expect(res).toMatchObject({ claimed: false, reason: "already_claimed" });
    expect(row.bonus_credits).toBe(700);
    expect(row.daily_streak).toBe(4);
  });

  it("day-7 milestone pays the milestone bonus and banks a freeze", async () => {
    const row = seedProfile({ daily_streak: 6, last_daily_claim: utcYesterday(), streak_freezes: 0 });
    const res = await claimDailyBonus(USER);
    expect(res).toMatchObject({
      claimed: true,
      streak: 7,
      bonusGranted: 1000,
      isStreakMilestone: true,
      freezesEarned: true,
      streakFreezes: 1,
    });
    expect(row.bonus_credits).toBe(1000);
  });

  it("a missed day with a banked freeze consumes it and keeps the streak", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    seedProfile({ daily_streak: 5, last_daily_claim: twoDaysAgo, streak_freezes: 1 });
    const res = await claimDailyBonus(USER);
    expect(res).toMatchObject({ claimed: true, streak: 6, freezeUsed: true, streakFreezes: 0 });
  });

  it("brand-new user with no profile row can claim (row created carrying the claim)", async () => {
    const res = await claimDailyBonus(USER);
    expect(res).toMatchObject({ claimed: true, streak: 1, bonusGranted: 200 });
    const row = h.state.profiles.get(USER)!;
    expect(row.last_daily_claim).toBe(utcToday());
    expect(row.bonus_credits).toBe(200);
    // And a second claim is refused.
    const again = await claimDailyBonus(USER);
    expect(again).toMatchObject({ claimed: false, reason: "already_claimed" });
    expect(row.bonus_credits).toBe(200);
  });
});

describe("spinWheel — CAS cooldown claim", () => {
  it("two concurrent spins pay exactly once", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    const row = seedProfile({ last_wheel_spin: twoHoursAgo, bonus_credits: 0 });
    const [a, b] = await Promise.all([spinWheel(USER), spinWheel(USER)]);
    const results = [a, b];
    expect(results.filter((r) => r.spun)).toHaveLength(1);
    expect(results.filter((r) => !r.spun && r.reason === "cooldown")).toHaveLength(1);
    const winner = results.find((r) => r.spun)!;
    // Exactly the winner's segment was granted — not two segments.
    expect(row.bonus_credits).toBe(winner.segment!.credits);
    expect(row.last_wheel_spin).not.toBe(twoHoursAgo);
  });

  it("inside the cooldown: no spin, no grant", async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const row = seedProfile({ last_wheel_spin: tenMinAgo, bonus_credits: 300 });
    const res = await spinWheel(USER);
    expect(res.spun).toBe(false);
    expect(res.reason).toBe("cooldown");
    expect(res.cooldownSeconds).toBeGreaterThan(0);
    expect(row.bonus_credits).toBe(300);
  });

  it("first-ever spin (no prior stamp) pays and stamps", async () => {
    const row = seedProfile({ last_wheel_spin: null });
    const res = await spinWheel(USER);
    expect(res.spun).toBe(true);
    expect(row.bonus_credits).toBe(res.segment!.credits);
    expect(typeof row.last_wheel_spin).toBe("string");
  });
});
