/**
 * Entitlement lifecycle: the team pool is a Shot Caller feature. If the
 * owner's plan_tier drops below 4 (or can't be confirmed), the pool is
 * frozen for spending — chargeCredits falls back to the member's personal
 * balance instead of draining a pool whose entitlement lapsed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const testState = vi.hoisted(() => ({
  ownerTier: 4 as number | null,
  personalCredits: 100,
  poolCredits: 500,
  ledger: [] as any[],
  teamOwnerId: "owner-1",
  hasTeam: true,
}));

const dbState = vi.hoisted(() => ({ poolCredits: 500 }));

const drizzleFakes = vi.hoisted(() => {
  const colOf = (d: any) => d?.__col;
  return {
    eq: (col: any, val: any) => ({ __eq: true, col: colOf(col), val }),
    and: (...conds: any[]) => ({ __and: true, conds }),
    isNull: (col: any) => ({ __isNull: true, col: colOf(col) }),
    sql: (strings: TemplateStringsArray, ...values: any[]) => {
      const joined = strings.join("");
      if (joined.includes("-")) return { __dec: values.find((v) => typeof v === "number") };
      if (joined.includes("+")) return { __inc: values.find((v) => typeof v === "number") };
      return { __sqlOther: true };
    },
  };
});

vi.mock("drizzle-orm", () => drizzleFakes);

vi.mock("@workspace/db", () => {
  const mkTable = (name: string, cols: string[]) => {
    const t: any = { __table: name };
    for (const c of cols) t[c] = { __col: c };
    return t;
  };
  const teamsTable = mkTable("teams", ["id", "ownerId", "credits"]);
  const teamMembersTable = mkTable("team_members", ["id", "teamId", "userId", "status"]);

  const colOf = (d: any) => d?.__col;
  const matchRow = (row: any, where: any): boolean => {
    if (!where) return true;
    if (where.__eq) return row[where.col] === where.val;
    if (where.__and) return where.conds.every((c: any) => matchRow(row, c));
    return true;
  };
  const rowsFor = (table: any) => {
    if (table.__table === "teams")
      return [{ id: "team-1", ownerId: (testState as any).teamOwnerId, credits: (dbState as any).poolCredits }];
    if (table.__table === "team_members")
      return (testState as any).hasTeam
        ? [{ id: "m-1", teamId: "team-1", userId: "user-1", status: "active" }]
        : [];
    return [];
  };

  const db = {
    select: () => {
      const b: any = {};
      b.from = (table: any) => {
        b.__table = table;
        return b;
      };
      b.where = (w: any) => {
        b.__where = w;
        return b;
      };
      b.limit = (n: number) =>
        Promise.resolve(rowsFor(b.__table).filter((r) => matchRow(r, b.__where)).slice(0, n));
      return b;
    },
    update: (table: any) => {
      const b: any = { __table: table };
      b.set = (vals: any) => {
        b.__set = vals;
        return b;
      };
      b.where = (w: any) => {
        b.__where = w;
        return b;
      };
      b.returning = async () => {
        // deductTeamCredits: atomic conditional decrement.
        const dec = b.__set?.credits?.__dec;
        if (dec !== undefined) {
          if ((dbState as any).poolCredits < dec) return [];
          (dbState as any).poolCredits -= dec;
          return [{ id: "team-1", credits: (dbState as any).poolCredits }];
        }
        return [];
      };
      return b;
    },
  };
  const eq = (col: any, val: any) => ({ __eq: true, col: colOf(col), val });
  const and = (...conds: any[]) => ({ __and: true, conds });
  const sql = (strings: TemplateStringsArray, ...values: any[]) => {
    const joined = strings.join("");
    if (joined.includes("-")) {
      const dec = values.find((v) => typeof v === "number");
      return { __dec: dec };
    }
    if (joined.includes(">=")) return { __gte: true };
    return {};
  };
  return { db, teamsTable, teamMembersTable, eq, and, sql };
});

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      const builder: any = {};
      builder.select = (cols: string) => {
        builder.__cols = cols;
        return builder;
      };
      builder.eq = (col: string, val: any) => {
        builder.__eq = { col, val };
        return builder;
      };
      const row = () => {
        if (builder.__cols.includes("plan_tier")) {
          return builder.__eq.val === (testState as any).teamOwnerId || builder.__eq.val === "user-1"
            ? { plan_tier: builder.__eq.val === (testState as any).teamOwnerId ? (testState as any).ownerTier : 4 }
            : { plan_tier: null };
        }
        return {
          credits: (testState as any).personalCredits,
          bonus_credits: 0,
          bonus_credits_expires_at: null,
        };
      };
      builder.maybeSingle = async () => ({ data: row(), error: null });
      builder.single = async () => ({ data: row(), error: null });
      builder.update = (vals: any) => ({
        eq: async () => {
          if (typeof vals.credits === "number") (testState as any).personalCredits = vals.credits;
          return { error: null };
        },
      });
      return builder;
    },
  }),
  addCreditsToProfile: vi.fn(async () => 0),
}));

vi.mock("../payment-record", () => ({
  recordCreditUsageStrict: vi.fn(async (rec: any) => {
    (testState as any).ledger.push(rec);
  }),
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { chargeCredits } = await import("../credits");
const { isTeamPoolActive } = await import("../teams");

beforeEach(() => {
  testState.ownerTier = 4;
  testState.personalCredits = 100;
  testState.teamOwnerId = "owner-1";
  testState.hasTeam = true;
  testState.ledger = [];
  dbState.poolCredits = 500;
});

describe("isTeamPoolActive", () => {
  it("is active while the owner holds Shot Caller (tier 4)", async () => {
    await expect(isTeamPoolActive({ ownerId: "owner-1" })).resolves.toBe(true);
  });

  it("is active for higher tiers (Crime Boss 5)", async () => {
    testState.ownerTier = 5;
    await expect(isTeamPoolActive({ ownerId: "owner-1" })).resolves.toBe(true);
  });

  it("is suspended when the owner drops to Gangster (tier 3)", async () => {
    testState.ownerTier = 3;
    await expect(isTeamPoolActive({ ownerId: "owner-1" })).resolves.toBe(false);
  });

  it("fail-closes when the owner tier is unknown", async () => {
    testState.ownerTier = null;
    await expect(isTeamPoolActive({ ownerId: "owner-1" })).resolves.toBe(false);
  });
});

describe("chargeCredits — pool spending respects entitlement", () => {
  it("spends from the pool when the owner is entitled", async () => {
    const after = await chargeCredits("user-1", 60, { action: "test_spend" });
    expect(after).toBe(440); // pool 500 -> 440
    expect(dbState.poolCredits).toBe(440);
    expect(testState.personalCredits).toBe(100); // personal untouched
    expect(testState.ledger[0].teamId).toBe("team-1");
  });

  it("freezes the pool and charges personal when the owner was downgraded", async () => {
    testState.ownerTier = 2;
    const after = await chargeCredits("user-1", 60, { action: "test_spend" });
    expect(after).toBe(40); // personal 100 -> 40
    expect(testState.personalCredits).toBe(40);
    expect(dbState.poolCredits).toBe(500); // pool untouched
    expect(testState.ledger[0].teamId ?? null).toBeNull();
  });

  it("fail-closes to personal when the owner tier cannot be confirmed", async () => {
    testState.ownerTier = null;
    await chargeCredits("user-1", 60, { action: "test_spend" });
    expect(testState.personalCredits).toBe(40);
    expect(dbState.poolCredits).toBe(500);
  });

  it("charges personal when the user has no team", async () => {
    testState.hasTeam = false;
    await chargeCredits("user-1", 60, { action: "test_spend" });
    expect(testState.personalCredits).toBe(40);
    expect(dbState.poolCredits).toBe(500);
  });
});
