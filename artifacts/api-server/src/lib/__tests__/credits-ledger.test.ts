/**
 * credits-ledger.test.ts — P0 money-integrity regression tests.
 *
 * Guarantees: a balance deduction can never be left without a ledger trace.
 * chargeCredits() must either (a) deduct AND write the ledger, or
 * (b) roll the deduction back and throw LedgerWriteError loudly.
 * It must never silently swallow a ledger failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(),
  addCreditsToProfile: vi.fn(),
}));

vi.mock("../payment-record", () => ({
  recordCreditUsageStrict: vi.fn(),
}));

vi.mock("../teams", () => ({
  // chargeCredits() gained a team-pool lookup (getUserActiveTeam) after this
  // suite was written. Every scenario below exercises the PERSONAL-balance
  // path, so the faithful stub is "this user has no active team":
  // getUserActiveTeam resolves null, exactly as it does in production for a
  // teamless user, and charge falls through to deductCredits(). The real
  // implementation queries Render Postgres via Drizzle — unstubbed it throws
  // ECONNREFUSED before any ledger logic runs, which is what darkened this
  // suite. deductTeamCredits must never be reached on the personal path;
  // make it reject loudly if a future change routes these scenarios there.
  getUserActiveTeam: vi.fn(async () => null),
  deductTeamCredits: vi.fn(async () => {
    throw new Error("deductTeamCredits must not be called on the personal-balance path");
  }),
}));

import { getSupabaseAdmin, addCreditsToProfile } from "../supabase-admin";
import { recordCreditUsageStrict } from "../payment-record";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
} from "../credits";

/* ── Fake Supabase admin client with an in-memory profiles table ── */
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

describe("chargeCredits — ledger atomicity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deducts and writes the ledger on the happy path", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    vi.mocked(recordCreditUsageStrict).mockResolvedValue(undefined);

    const after = await chargeCredits("user-1", 5, { action: "Test Charge" });

    expect(after).toBe(95);
    expect(fake.getCredits()).toBe(95);
    expect(recordCreditUsageStrict).toHaveBeenCalledWith({
      userId: "user-1",
      action: "Test Charge",
      creditsUsed: 5,
      projectId: null,
      // The ledger record gained teamId + idempotencyKey when team-pool
      // charges and P0-23 idempotency landed; on the personal, no-key path
      // both are null. Exact-shape assertion kept at full strength.
      teamId: null,
      idempotencyKey: null,
    });
    expect(addCreditsToProfile).not.toHaveBeenCalled();
  });

  it("rolls back the deduction and throws LedgerWriteError when the ledger insert fails", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    vi.mocked(recordCreditUsageStrict).mockRejectedValue(new Error("db down"));
    vi.mocked(addCreditsToProfile).mockImplementation(async (_uid: string, amt: number) => {
      // simulate the rollback restoring the balance
      return { oldCredits: 95, newCredits: 95 + amt, created: false };
    });

    await expect(chargeCredits("user-1", 5, { action: "Test Charge" })).rejects.toBeInstanceOf(
      LedgerWriteError,
    );

    // The rollback must have been attempted with the full cost…
    expect(addCreditsToProfile).toHaveBeenCalledWith("user-1", 5);
    // …and the deduction itself did happen first (95), proving the rollback
    // path — not silent swallowing — is what restores the balance.
    expect(fake.getCredits()).toBe(95);
    expect(fake.calls.filter((c) => c.op === "update").length).toBe(1);
  });

  it("does NOT write a ledger entry when the deduction fails with OutOfCreditsError", async () => {
    const fake = makeSupabase(2); // insufficient for cost 5
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);

    await expect(chargeCredits("user-1", 5, { action: "Test Charge" })).rejects.toBeInstanceOf(
      OutOfCreditsError,
    );

    expect(recordCreditUsageStrict).not.toHaveBeenCalled();
    expect(addCreditsToProfile).not.toHaveBeenCalled();
    expect(fake.getCredits()).toBe(2); // untouched
  });

  it("throws LedgerWriteError (not a silent success) when both ledger and rollback fail", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    vi.mocked(recordCreditUsageStrict).mockRejectedValue(new Error("db down"));
    vi.mocked(addCreditsToProfile).mockRejectedValue(new Error("supabase down"));

    await expect(chargeCredits("user-1", 5, { action: "Test Charge" })).rejects.toBeInstanceOf(
      LedgerWriteError,
    );
    // Rollback was attempted even though it failed (critical log path).
    expect(addCreditsToProfile).toHaveBeenCalledWith("user-1", 5);
  });

  it("keeps the deduction and still throws loudly when rollback is disabled (background-job path)", async () => {
    const fake = makeSupabase(100);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as any);
    vi.mocked(recordCreditUsageStrict).mockRejectedValue(new Error("db down"));

    await expect(
      chargeCredits("user-1", 5, { action: "Test Charge" }, { rollbackOnLedgerFailure: false }),
    ).rejects.toBeInstanceOf(LedgerWriteError);

    // No rollback — the deduction stands (value was delivered).
    expect(addCreditsToProfile).not.toHaveBeenCalled();
    expect(fake.getCredits()).toBe(95);
  });
});

describe("refundCredits — refund ledger trace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores the balance and writes a negative ledger entry", async () => {
    vi.mocked(addCreditsToProfile).mockResolvedValue({ oldCredits: 95, newCredits: 100, created: false });
    vi.mocked(recordCreditUsageStrict).mockResolvedValue(undefined);

    await refundCredits("user-1", 5, { action: "Test — Refund" });

    expect(addCreditsToProfile).toHaveBeenCalledWith("user-1", 5);
    expect(recordCreditUsageStrict).toHaveBeenCalledWith({
      userId: "user-1",
      action: "Test — Refund",
      creditsUsed: -5,
      projectId: null,
    });
  });

  it("does not throw when the refund ledger write fails (money is already restored)", async () => {
    vi.mocked(addCreditsToProfile).mockResolvedValue({ oldCredits: 95, newCredits: 100, created: false });
    vi.mocked(recordCreditUsageStrict).mockRejectedValue(new Error("db down"));

    await expect(
      refundCredits("user-1", 5, { action: "Test — Refund" }),
    ).resolves.toBeUndefined();
    expect(addCreditsToProfile).toHaveBeenCalledWith("user-1", 5);
  });
});
