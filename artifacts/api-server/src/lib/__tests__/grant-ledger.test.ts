/**
 * Starter + trial grant ledger rows (board item 58, payments lane).
 *
 * The referral grants already write strict credit_usage rows keyed
 * `referral-welcome:${userId}` with creditsUsed negative; starter
 * (300 VB, require-auth profile insert) and trial (1,000 VB,
 * /credits/claim-trial) wrote NONE — the balance moved with no rows
 * behind it on /credit-history. recordGrantLedger applies the referral
 * pattern to both. These tests inject fake deps (the same contract the
 * production Drizzle/recordCreditUsageStrict deps implement) and pin:
 * the row shape, the keying, the idempotent replay, and that a genuine
 * ledger failure THROWS so callers can claw back / release the claim.
 */
import { describe, it, expect, vi } from "vitest";
import {
  recordGrantLedger,
  grantLedgerKey,
  STARTER_GRANT_CREDITS,
  TRIAL_GRANT_CREDITS,
  type GrantLedgerDeps,
} from "../grant-ledger";

const USER = "user-123";

function makeDeps(existing = false) {
  const inserted: Array<{
    userId: string;
    action: string;
    creditsUsed: number;
    idempotencyKey: string;
  }> = [];
  const deps: GrantLedgerDeps = {
    exists: vi.fn(async () => existing),
    insertStrict: vi.fn(async (rec) => {
      inserted.push(rec);
    }),
  };
  return { deps, inserted };
}

describe("grant ledger keying (referral pattern)", () => {
  it("keys are `${kind}-grant:${userId}` like `referral-welcome:${userId}`", () => {
    expect(grantLedgerKey("starter", USER)).toBe("starter-grant:user-123");
    expect(grantLedgerKey("trial", USER)).toBe("trial-grant:user-123");
  });

  it("amounts are the ruled grants: starter 300, trial 1,000", () => {
    expect(STARTER_GRANT_CREDITS).toBe(300);
    expect(TRIAL_GRANT_CREDITS).toBe(1000);
  });
});

describe("recordGrantLedger", () => {
  it("writes a strict row: negative creditsUsed (grant convention), keyed", async () => {
    const { deps, inserted } = makeDeps();
    const out = await recordGrantLedger("starter", USER, deps);
    expect(out).toBe("recorded");
    expect(inserted).toEqual([
      {
        userId: USER,
        action: "Starter Grant",
        creditsUsed: -300,
        idempotencyKey: "starter-grant:user-123",
      },
    ]);
  });

  it("trial writes its own action, amount and key", async () => {
    const { deps, inserted } = makeDeps();
    const out = await recordGrantLedger("trial", USER, deps);
    expect(out).toBe("recorded");
    expect(inserted).toEqual([
      {
        userId: USER,
        action: "Trial Grant",
        creditsUsed: -1000,
        idempotencyKey: "trial-grant:user-123",
      },
    ]);
  });

  it("an existing keyed row resolves already-recorded and inserts nothing", async () => {
    const { deps, inserted } = makeDeps(true);
    const out = await recordGrantLedger("trial", USER, deps);
    expect(out).toBe("already-recorded");
    expect(inserted).toHaveLength(0);
    expect(deps.insertStrict).not.toHaveBeenCalled();
  });

  it("a unique-violation on insert (race past the pre-check) is already-recorded, not an error", async () => {
    const { deps } = makeDeps(false);
    const pgDup = Object.assign(new Error("duplicate key value"), {
      code: "23505",
    });
    (deps.insertStrict as ReturnType<typeof vi.fn>).mockRejectedValue(pgDup);
    const out = await recordGrantLedger("starter", USER, deps);
    expect(out).toBe("already-recorded");
  });

  it("a genuine ledger failure throws so the caller can claw back", async () => {
    const { deps } = makeDeps(false);
    (deps.insertStrict as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ledger down"),
    );
    await expect(recordGrantLedger("trial", USER, deps)).rejects.toThrow(
      "ledger down",
    );
  });
});
