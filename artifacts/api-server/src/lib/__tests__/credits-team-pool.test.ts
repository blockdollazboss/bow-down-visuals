/**
 * credits-team-pool.test.ts — team-pool + idempotency regression tests.
 *
 * Companion to credits-ledger.test.ts (the personal-balance suite). That
 * suite stubs ../teams to "no active team" on every scenario; this one
 * exercises the paths it cannot reach, against chargeCredits() as written
 * in ../credits.ts:
 *
 *  - Team pool first (credits.ts:276-302): a user with an active team is
 *    charged from the shared pool via deductTeamCredits(); the ledger
 *    record carries the real teamId and the personal balance is untouched.
 *  - Pool-insufficient policy is per-team (credits.ts:280-301): when the
 *    pool can't cover the cost, allowPersonalFallback === true (the schema
 *    default — lib/db teams.allow_personal_fallback is NOT NULL DEFAULT
 *    true, and credits.ts defaults a missing flag to true) charges the
 *    personal balance instead; === false rejects with OutOfCreditsError.
 *    The same policy governs the race where the pool drops between the
 *    balance check and the atomic deduction: fall back, or rethrow the
 *    pool's own error untouched.
 *  - Team ledger failure rolls back through the teams table
 *    (credits.ts:323-325, `credits = credits + cost`), never through the
 *    personal balance, and surfaces as LedgerWriteError — the same
 *    contract the personal suite asserts.
 *  - P0-23 idempotency (credits.ts:262-269): the already-charged check runs
 *    BEFORE team routing, so one shared mechanism guards both paths — a
 *    replayed key returns a current balance with no deduction, no routing
 *    lookup, and no second ledger row. The returned balance is the one the
 *    ORIGINAL charge hit: the prior ledger row carries its teamId, so a
 *    replayed team charge reads the pool balance by id off the teams table,
 *    while a personal charge returns the personal balance. If the team is
 *    gone or the pool read fails, the replay falls back to the personal
 *    balance (fail-open, same as the lookup itself).
 *
 * Mocking boundaries match the personal suite (../supabase-admin,
 * ../payment-record, ../teams) plus @workspace/db, which chargeCredits()
 * touches directly for exactly three things: the idempotency lookup
 * (findExistingCharge → db.select on credit_usage), the pool-balance read
 * on a team-charge replay (db.select on teams), and the team rollback
 * (db.update on teams). The fake db below implements only those chains.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SQL } from "drizzle-orm";

/* ── Hoisted fake @workspace/db ──────────────────────────────────────────
   Table objects are sentinels: credits.ts only reads .id/.credits off
   teamsTable and .id/.idempotencyKey/.teamId off creditUsageTable while
   building drizzle expressions, and the fake chains never evaluate them.
   Keeping the references lets the tests assert the rollback targeted the
   real teams.credits column for the real team id, and lets the fake select
   tell the credit_usage lookup apart from the teams-table pool read. */
const h = vi.hoisted(() => {
  const teamsTable = {
    id: { pgColumn: "teams.id" },
    credits: { pgColumn: "teams.credits" },
    updatedAt: { pgColumn: "teams.updated_at" },
  };
  const creditUsageTable = {
    id: { pgColumn: "credit_usage.id" },
    idempotencyKey: { pgColumn: "credit_usage.idempotency_key" },
    teamId: { pgColumn: "credit_usage.team_id" },
  };
  const state = {
    /** Rows the fake idempotency lookup (db.select on credit_usage) resolves. */
    existingChargeRows: [] as Array<{ id: string; teamId?: string | null }>,
    /** Rows the fake pool-balance read (db.select on teams) resolves. */
    teamRows: [] as Array<{ id: string; credits: number }>,
    /** When true, the fake teams-table select throws (pool read failure). */
    teamSelectThrows: false,
    selectCalls: 0,
    /** Completed db.update(teamsTable).set(…).where(…) chains. */
    updateCalls: [] as Array<{
      table: unknown;
      setValues: Record<string, unknown>;
      whereCondition: unknown;
    }>,
  };
  const db = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: async (_n: number) => {
            state.selectCalls += 1;
            if (table === teamsTable) {
              if (state.teamSelectThrows) throw new Error("teams read failed");
              return state.teamRows;
            }
            return state.existingChargeRows;
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (setValues: Record<string, unknown>) => ({
        where: async (cond: unknown) => {
          state.updateCalls.push({ table, setValues, whereCondition: cond });
          return [];
        },
      }),
    }),
  };
  return { teamsTable, creditUsageTable, state, db };
});

vi.mock("@workspace/db", () => ({
  db: h.db,
  teamsTable: h.teamsTable,
  creditUsageTable: h.creditUsageTable,
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(),
  addCreditsToProfile: vi.fn(),
}));

vi.mock("../payment-record", () => ({
  recordCreditUsageStrict: vi.fn(),
}));

vi.mock("../teams", () => ({
  getUserActiveTeam: vi.fn(),
  deductTeamCredits: vi.fn(),
}));

import { getSupabaseAdmin, addCreditsToProfile } from "../supabase-admin";
import { recordCreditUsageStrict } from "../payment-record";
import { getUserActiveTeam, deductTeamCredits } from "../teams";
import {
  chargeCredits,
  OutOfCreditsError,
  LedgerWriteError,
} from "../credits";

/* ── Fake Supabase admin client with an in-memory profiles table ──
   Same shape as the personal suite's fake: serves both deductCredits()
   (select credits/bonus, then update) and readPersonalBalance(). */
function makeSupabase(initialCredits: number) {
  let credits = initialCredits;
  const calls: { op: string; credits?: number }[] = [];
  const table = {
    select: () => table,
    eq: () => table,
    single: async () => ({ data: { credits }, error: null }),
    update: (vals: { credits: number }) => {
      calls.push({ op: "update", credits: vals.credits });
      credits = vals.credits;
      return { eq: (_col: string, _val: string) => Promise.resolve({ error: null }) };
    },
  };
  return {
    client: { from: (_t: string) => table },
    getCredits: () => credits,
    calls,
  };
}

/** An active-team result shaped like teams.ts getUserActiveTeam()'s return. */
function makeActiveTeam(team: { id?: string; credits: number; allowPersonalFallback: boolean }) {
  const id = team.id ?? "team-1";
  return {
    team: { id, credits: team.credits, allowPersonalFallback: team.allowPersonalFallback },
    membership: { id: "membership-1", teamId: id, userId: "user-1", status: "active" },
  };
}

/** The error teams.ts deductTeamCredits() throws on an empty pool
    (teams.ts:73-79): a plain Error named OutOfCreditsError with status 402 —
    deliberately NOT the credits.ts OutOfCreditsError class instance. */
function makePoolRaceError() {
  const err = new Error("out_of_credits") as Error & { status?: number };
  err.name = "OutOfCreditsError";
  err.status = 402;
  return err;
}

/* ── Drizzle SQL introspection ─────────────────────────────────────────
   In drizzle-orm 0.45, values interpolated into sql`` sit raw in
   queryChunks (columns/values are leaf chunks; SQL fragments nest). These
   helpers flatten a captured expression so tests can assert the rollback
   really is `teams.credits + <cost>` targeted `WHERE teams.id = <teamId>`
   instead of merely "some update happened". */
function flatChunks(node: unknown, out: unknown[] = []): unknown[] {
  if (node instanceof SQL) {
    for (const c of node.queryChunks) flatChunks(c, out);
  } else if (Array.isArray(node)) {
    for (const c of node) flatChunks(c, out);
  } else {
    out.push(node);
  }
  return out;
}

function stringChunkText(node: unknown): string {
  return flatChunks(node)
    .filter((c) => (c as { constructor?: { name?: string } })?.constructor?.name === "StringChunk")
    .flatMap((c) => (c as unknown as { value: string[] }).value)
    .join("");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.existingChargeRows = [];
  h.state.teamRows = [];
  h.state.teamSelectThrows = false;
  h.state.selectCalls = 0;
  h.state.updateCalls = [];
  vi.mocked(recordCreditUsageStrict).mockResolvedValue(undefined);
});

describe("chargeCredits — team pool", () => {
  it("charges the pool, ledgers the real teamId, and leaves the personal balance untouched", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    vi.mocked(getUserActiveTeam).mockResolvedValue(makeActiveTeam({ credits: 500, allowPersonalFallback: true }) as any);
    vi.mocked(deductTeamCredits).mockResolvedValue(495);

    const after = await chargeCredits("user-1", 5, { action: "Test Charge" });

    // Return value is the POOL balance after deduction (deductTeamCredits'
    // return), not the personal balance.
    expect(after).toBe(495);
    expect(getUserActiveTeam).toHaveBeenCalledWith("user-1");
    expect(deductTeamCredits).toHaveBeenCalledTimes(1);
    expect(deductTeamCredits).toHaveBeenCalledWith("team-1", 5);
    expect(recordCreditUsageStrict).toHaveBeenCalledWith({
      userId: "user-1",
      action: "Test Charge",
      creditsUsed: 5,
      projectId: null,
      teamId: "team-1",
      idempotencyKey: null,
    });
    // Personal side never moved: no deduction, no rollback credit.
    expect(fake.getCredits()).toBe(100);
    expect(fake.calls.filter((c) => c.op === "update")).toHaveLength(0);
    expect(addCreditsToProfile).not.toHaveBeenCalled();
  });

  it("falls back to personal when the pool is insufficient and the team allows fallback", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    // Pool holds 3 < cost 5; allowPersonalFallback is the schema default (true).
    vi.mocked(getUserActiveTeam).mockResolvedValue(makeActiveTeam({ credits: 3, allowPersonalFallback: true }) as any);

    const after = await chargeCredits("user-1", 5, { action: "Test Charge" });

    expect(after).toBe(95);
    // chargeCredits gates on the pool balance BEFORE calling the atomic
    // deduction (credits.ts:281), so the pool deduction is never attempted.
    expect(deductTeamCredits).not.toHaveBeenCalled();
    expect(fake.getCredits()).toBe(95);
    expect(recordCreditUsageStrict).toHaveBeenCalledWith({
      userId: "user-1",
      action: "Test Charge",
      creditsUsed: 5,
      projectId: null,
      // A fallback charge is a personal charge: no teamId on the ledger row.
      teamId: null,
      idempotencyKey: null,
    });
  });

  it("rejects with OutOfCreditsError and touches nothing when the pool is insufficient and fallback is disabled", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    vi.mocked(getUserActiveTeam).mockResolvedValue(makeActiveTeam({ credits: 3, allowPersonalFallback: false }) as any);

    await expect(chargeCredits("user-1", 5, { action: "Test Charge" })).rejects.toBeInstanceOf(
      OutOfCreditsError,
    );

    expect(deductTeamCredits).not.toHaveBeenCalled();
    expect(fake.getCredits()).toBe(100); // personal NOT silently charged
    expect(fake.calls.filter((c) => c.op === "update")).toHaveLength(0);
    expect(recordCreditUsageStrict).not.toHaveBeenCalled();
    expect(addCreditsToProfile).not.toHaveBeenCalled();
  });

  it("race: pool drops between the check and the deduction — falls back to personal when fallback is allowed", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    // Pool reads 500 at the gate (credits.ts:281) but the atomic conditional
    // UPDATE in deductTeamCredits finds it drained and throws (teams.ts:73-79).
    vi.mocked(getUserActiveTeam).mockResolvedValue(makeActiveTeam({ credits: 500, allowPersonalFallback: true }) as any);
    vi.mocked(deductTeamCredits).mockRejectedValue(makePoolRaceError());

    const after = await chargeCredits("user-1", 5, { action: "Test Charge" });

    expect(after).toBe(95);
    expect(deductTeamCredits).toHaveBeenCalledTimes(1);
    expect(fake.getCredits()).toBe(95);
    expect(recordCreditUsageStrict).toHaveBeenCalledWith({
      userId: "user-1",
      action: "Test Charge",
      creditsUsed: 5,
      projectId: null,
      teamId: null,
      idempotencyKey: null,
    });
  });

  it("race: pool drops and fallback is disabled — the pool's own error propagates untouched", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    vi.mocked(getUserActiveTeam).mockResolvedValue(makeActiveTeam({ credits: 500, allowPersonalFallback: false }) as any);
    const raceErr = makePoolRaceError();
    vi.mocked(deductTeamCredits).mockRejectedValue(raceErr);

    // credits.ts:286-288 rethrows the deduction error as-is (no wrapping,
    // no OutOfCreditsError conversion, no silent personal charge).
    const caught = await chargeCredits("user-1", 5, { action: "Test Charge" }).catch((e: unknown) => e);
    expect(caught).toBe(raceErr);

    expect(fake.getCredits()).toBe(100);
    expect(fake.calls.filter((c) => c.op === "update")).toHaveLength(0);
    expect(recordCreditUsageStrict).not.toHaveBeenCalled();
  });

  it("team ledger-write failure rolls the pool back through the teams table and throws LedgerWriteError", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    vi.mocked(getUserActiveTeam).mockResolvedValue(makeActiveTeam({ credits: 500, allowPersonalFallback: true }) as any);
    vi.mocked(deductTeamCredits).mockResolvedValue(495);
    vi.mocked(recordCreditUsageStrict).mockRejectedValue(new Error("db down"));

    await expect(chargeCredits("user-1", 5, { action: "Test Charge" })).rejects.toBeInstanceOf(
      LedgerWriteError,
    );

    // Exactly one rollback write: UPDATE teams SET credits = credits + 5,
    // updatedAt = <now> WHERE teams.id = 'team-1' (credits.ts:323-325).
    expect(h.state.updateCalls).toHaveLength(1);
    const rollback = h.state.updateCalls[0]!;
    expect(rollback.table).toBe(h.teamsTable);
    expect(Object.keys(rollback.setValues).sort()).toEqual(["credits", "updatedAt"]);
    expect(rollback.setValues["updatedAt"]).toBeInstanceOf(Date);
    const creditsExpr = rollback.setValues["credits"];
    expect(creditsExpr).toBeInstanceOf(SQL);
    const creditsChunks = flatChunks(creditsExpr);
    expect(creditsChunks).toContain(h.teamsTable.credits); // the teams.credits column…
    expect(creditsChunks).toContain(5); //                    …plus the full cost…
    expect(stringChunkText(creditsExpr)).toContain("+"); //   …added back, not set.
    const whereChunks = flatChunks(rollback.whereCondition);
    expect(whereChunks).toContain(h.teamsTable.id);
    expect(whereChunks).toContain("team-1");
    // The rollback must NOT credit the personal balance for a team charge.
    expect(addCreditsToProfile).not.toHaveBeenCalled();
    expect(fake.getCredits()).toBe(100);
    expect(fake.calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("team ledger-write failure with rollback disabled keeps the pool deduction and still throws LedgerWriteError", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    vi.mocked(getUserActiveTeam).mockResolvedValue(makeActiveTeam({ credits: 500, allowPersonalFallback: true }) as any);
    vi.mocked(deductTeamCredits).mockResolvedValue(495);
    vi.mocked(recordCreditUsageStrict).mockRejectedValue(new Error("db down"));

    await expect(
      chargeCredits("user-1", 5, { action: "Test Charge" }, { rollbackOnLedgerFailure: false }),
    ).rejects.toBeInstanceOf(LedgerWriteError);

    // Background-job path: no teams-table rollback — the deduction stands.
    expect(h.state.updateCalls).toHaveLength(0);
    expect(addCreditsToProfile).not.toHaveBeenCalled();
    expect(deductTeamCredits).toHaveBeenCalledTimes(1);
  });
});

describe("chargeCredits — idempotency short-circuit (P0-23)", () => {
  it("personal path: a recorded key returns the current balance with no deduction and no ledger write", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    vi.mocked(getUserActiveTeam).mockResolvedValue(null);
    // teamId null on the prior row: the original charge was personal.
    h.state.existingChargeRows = [{ id: "usage-42", teamId: null }];

    const after = await chargeCredits(
      "user-1",
      5,
      { action: "Test Charge" },
      { idempotencyKey: "charge-key-1" },
    );

    expect(after).toBe(100); // readPersonalBalance — the charge is a no-op success
    expect(h.state.selectCalls).toBeGreaterThanOrEqual(1); // the lookup happened
    expect(deductTeamCredits).not.toHaveBeenCalled();
    expect(recordCreditUsageStrict).not.toHaveBeenCalled();
    expect(addCreditsToProfile).not.toHaveBeenCalled();
    expect(fake.getCredits()).toBe(100);
    expect(fake.calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("team path: a replayed team charge returns the POOL balance, not the personal one", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    // The user HAS an active team with a funded pool — if the mechanism were
    // per-path, a replayed team charge could reach the pool again. It
    // cannot: the check sits above routing (credits.ts:262-269 precedes
    // :276), and no second deduction happens.
    vi.mocked(getUserActiveTeam).mockResolvedValue(makeActiveTeam({ credits: 500, allowPersonalFallback: true }) as any);
    // The original charge drew from team-1's pool, so its ledger row
    // carries the teamId; the pool now stands at 495 (500 − 5).
    h.state.existingChargeRows = [{ id: "usage-42", teamId: "team-1" }];
    h.state.teamRows = [{ id: "team-1", credits: 495 }];

    const after = await chargeCredits(
      "user-1",
      5,
      { action: "Test Charge" },
      { idempotencyKey: "charge-key-1" },
    );

    expect(getUserActiveTeam).not.toHaveBeenCalled(); // routing never reached
    expect(deductTeamCredits).not.toHaveBeenCalled();
    expect(recordCreditUsageStrict).not.toHaveBeenCalled();
    // The replay reports the balance the original charge hit — the pool's
    // 495 — so a client retrying a team charge sees the number it expects,
    // not the unrelated personal balance.
    expect(after).toBe(495);
    expect(fake.getCredits()).toBe(100); // personal untouched either way
  });

  it("team path: the team is gone by replay time — falls back to the personal balance", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    vi.mocked(getUserActiveTeam).mockResolvedValue(null);
    h.state.existingChargeRows = [{ id: "usage-42", teamId: "team-1" }];
    h.state.teamRows = []; // team deleted since the original charge

    const after = await chargeCredits(
      "user-1",
      5,
      { action: "Test Charge" },
      { idempotencyKey: "charge-key-1" },
    );

    // Fail-open: a missing pool must not turn an idempotent success into an
    // error — the personal balance is the fallback answer.
    expect(after).toBe(100);
    expect(deductTeamCredits).not.toHaveBeenCalled();
    expect(recordCreditUsageStrict).not.toHaveBeenCalled();
    expect(fake.getCredits()).toBe(100);
  });

  it("team path: the pool-balance read fails — falls back to the personal balance instead of throwing", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    vi.mocked(getUserActiveTeam).mockResolvedValue(null);
    h.state.existingChargeRows = [{ id: "usage-42", teamId: "team-1" }];
    h.state.teamSelectThrows = true; // teams-table read errors out

    const after = await chargeCredits(
      "user-1",
      5,
      { action: "Test Charge" },
      { idempotencyKey: "charge-key-1" },
    );

    expect(after).toBe(100);
    expect(deductTeamCredits).not.toHaveBeenCalled();
    expect(recordCreditUsageStrict).not.toHaveBeenCalled();
    expect(fake.getCredits()).toBe(100);
  });

  it("a fresh key does not short-circuit: the charge proceeds and the trimmed key lands in the ledger record", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    vi.mocked(getUserActiveTeam).mockResolvedValue(null);
    h.state.existingChargeRows = []; // lookup finds nothing

    const after = await chargeCredits(
      "user-1",
      5,
      { action: "Test Charge" },
      { idempotencyKey: "  charge-key-2  " },
    );

    expect(after).toBe(95);
    expect(h.state.selectCalls).toBeGreaterThanOrEqual(1);
    expect(fake.getCredits()).toBe(95);
    expect(recordCreditUsageStrict).toHaveBeenCalledWith({
      userId: "user-1",
      action: "Test Charge",
      creditsUsed: 5,
      projectId: null,
      teamId: null,
      // credits.ts:262 trims the key before lookup and before the write.
      idempotencyKey: "charge-key-2",
    });
  });
});

describe("chargeCredits — team-membership seam", () => {
  it("no ACTIVE membership resolves null at the seam and charges the personal balance", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    // teams.ts:45-57 only returns a row for a team_members row with
    // status = 'active'; a user on a team's roster without an active
    // membership (invited / removed / suspended) is indistinguishable
    // from teamless at this seam — null — and the personal path is the
    // production semantic. This pins chargeCredits' side of that contract.
    vi.mocked(getUserActiveTeam).mockResolvedValue(null);

    const after = await chargeCredits("user-1", 5, { action: "Test Charge" });

    expect(after).toBe(95);
    expect(getUserActiveTeam).toHaveBeenCalledWith("user-1");
    expect(deductTeamCredits).not.toHaveBeenCalled();
    expect(fake.getCredits()).toBe(95);
    expect(recordCreditUsageStrict).toHaveBeenCalledWith({
      userId: "user-1",
      action: "Test Charge",
      creditsUsed: 5,
      projectId: null,
      teamId: null,
      idempotencyKey: null,
    });
  });

  it("personalOnly skips team routing entirely, even with an active team", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    vi.mocked(getUserActiveTeam).mockResolvedValue(makeActiveTeam({ credits: 500, allowPersonalFallback: true }) as any);

    // e.g. funding a team pool FROM personal credits: credits.ts:276 never
    // consults getUserActiveTeam when personalOnly is set.
    const after = await chargeCredits(
      "user-1",
      5,
      { action: "Test Charge" },
      { personalOnly: true },
    );

    expect(after).toBe(95);
    expect(getUserActiveTeam).not.toHaveBeenCalled();
    expect(deductTeamCredits).not.toHaveBeenCalled();
    expect(fake.getCredits()).toBe(95);
    expect(recordCreditUsageStrict).toHaveBeenCalledWith({
      userId: "user-1",
      action: "Test Charge",
      creditsUsed: 5,
      projectId: null,
      teamId: null,
      idempotencyKey: null,
    });
  });
});
