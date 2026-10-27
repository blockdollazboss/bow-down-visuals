/**
 * referral-welcome.test.ts — Referral guards rung 3: the pending welcome.
 *
 * The 1,000 VB referee welcome is recorded PENDING at /referrals/apply
 * and must fire exactly once when the referred user creates a creator
 * profile:
 *   - no profile yet → nothing pays, status stays pending
 *   - profile creation → +1,000 once, ledger key `referral-welcome:<userId>`
 *   - replays / retries / double profile saves → never a second grant
 *   - a second account on the same canonical mailbox (plus-address /
 *     gmail-dot alias, rung 2) → NO second welcome, ever
 *   - a failed grant leg after the claim → clawback + claim released,
 *     so a later retry pays cleanly (never burned, never doubled)
 *
 * Deps are injected (the lib's test seam) over an in-memory row store
 * that mimics the guarded pending->granted claim flip.
 */
import { describe, expect, it, vi } from "vitest";
import {
  maybeGrantPendingReferralWelcome,
  REFERRAL_WELCOME_CREDITS,
  type ReferralWelcomeDeps,
  type ReferralWelcomeRow,
} from "../referral-welcome";

const U1 = "22222222-2222-4222-8222-222222222222"; // referee #1
const U2 = "33333333-3333-4333-8333-333333333333"; // referee #2 (alias account)

interface World {
  rows: Map<string, ReferralWelcomeRow & { userId: string }>;
  profiles: Set<string>;
  balances: Map<string, number>;
  ledger: Array<{ userId: string; action: string; creditsUsed: number; idempotencyKey: string }>;
  ledgerFails: boolean;
  deps: ReferralWelcomeDeps;
  addCreditsCalls: Array<{ userId: string; amount: number }>;
}

function makeWorld(): World {
  const rows = new Map<string, ReferralWelcomeRow & { userId: string }>();
  const profiles = new Set<string>();
  const balances = new Map<string, number>();
  const ledger: World["ledger"] = [];
  const addCreditsCalls: World["addCreditsCalls"] = [];
  const world: World = {
    rows,
    profiles,
    balances,
    ledger,
    ledgerFails: false,
    addCreditsCalls,
    deps: {
      findReferral: async (userId) => rows.get(userId) ?? null,
      hasCreatorProfile: async (userId) => profiles.has(userId),
      hasGrantedCanonical: async (canonicalEmail, exceptReferralId) =>
        [...rows.values()].some(
          (r) =>
            r.id !== exceptReferralId &&
            r.refereeCanonicalEmail === canonicalEmail &&
            r.welcomeStatus === "granted",
        ),
      claimPending: async (userId) => {
        const row = rows.get(userId);
        if (!row || row.welcomeStatus !== "pending") return false;
        row.welcomeStatus = "granted";
        row.refereeCreditsAwarded = REFERRAL_WELCOME_CREDITS;
        return true;
      },
      releaseClaim: async (userId) => {
        const row = rows.get(userId);
        if (row && row.welcomeStatus === "granted") {
          row.welcomeStatus = "pending";
          row.refereeCreditsAwarded = 0;
        }
      },
      markWithheld: async (userId) => {
        const row = rows.get(userId);
        if (row && row.welcomeStatus === "pending") {
          row.welcomeStatus = "withheld";
          row.refereeCreditsAwarded = 0;
        }
      },
      addCredits: async (userId, amount) => {
        addCreditsCalls.push({ userId, amount });
        balances.set(userId, (balances.get(userId) ?? 0) + amount);
      },
      recordLedger: async (record) => {
        if (world.ledgerFails) throw new Error("ledger down (test)");
        ledger.push(record);
      },
    },
  };
  return world;
}

function seedPending(
  w: World,
  userId: string,
  canonical: string | null = "fan@gmail.com",
): void {
  w.rows.set(userId, {
    userId,
    id: `ref-${userId.slice(0, 4)}`,
    refereeCanonicalEmail: canonical,
    welcomeStatus: "pending",
    refereeCreditsAwarded: 0,
  });
}

describe("pending welcome — fires once at creator-profile creation", () => {
  it("pays nothing while there is no creator profile, and stays pending", async () => {
    const w = makeWorld();
    seedPending(w, U1);
    const r = await maybeGrantPendingReferralWelcome(U1, { deps: w.deps });
    expect(r).toEqual({ granted: false, amount: 0, reason: "no_creator_profile" });
    expect(w.balances.get(U1) ?? 0).toBe(0);
    expect(w.rows.get(U1)!.welcomeStatus).toBe("pending");
    expect(w.ledger).toHaveLength(0);
  });

  it("profile creation pays 1,000 exactly once with the canonical ledger key", async () => {
    const w = makeWorld();
    seedPending(w, U1);
    w.profiles.add(U1);
    const r = await maybeGrantPendingReferralWelcome(U1, { deps: w.deps });
    expect(r).toEqual({ granted: true, amount: 1000, reason: "granted" });
    expect(w.balances.get(U1)).toBe(1000);
    expect(w.rows.get(U1)!.welcomeStatus).toBe("granted");
    expect(w.rows.get(U1)!.refereeCreditsAwarded).toBe(1000);
    expect(w.ledger).toEqual([
      {
        userId: U1,
        action: "Referral Welcome Grant",
        creditsUsed: -1000,
        idempotencyKey: `referral-welcome:${U1}`,
      },
    ]);
  });

  it("profileConfirmed skips the profile lookup (caller vouches for the new profile)", async () => {
    const w = makeWorld();
    seedPending(w, U1);
    const spy = vi.spyOn(w.deps, "hasCreatorProfile");
    const r = await maybeGrantPendingReferralWelcome(U1, {
      profileConfirmed: true,
      deps: w.deps,
    });
    expect(r.granted).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(w.balances.get(U1)).toBe(1000);
  });

  it("replays never double-grant: second and third calls pay nothing", async () => {
    const w = makeWorld();
    seedPending(w, U1);
    w.profiles.add(U1);
    await maybeGrantPendingReferralWelcome(U1, { deps: w.deps });
    const again = await maybeGrantPendingReferralWelcome(U1, { deps: w.deps });
    const third = await maybeGrantPendingReferralWelcome(U1, {
      profileConfirmed: true,
      deps: w.deps,
    });
    expect(again).toEqual({ granted: false, amount: 0, reason: "already_granted" });
    expect(third.granted).toBe(false);
    expect(w.balances.get(U1)).toBe(1000);
    expect(w.addCreditsCalls).toEqual([{ userId: U1, amount: 1000 }]);
    expect(w.ledger).toHaveLength(1);
  });

  it("losing the claim race pays nothing (concurrent profile saves)", async () => {
    const w = makeWorld();
    seedPending(w, U1);
    w.profiles.add(U1);
    w.deps.claimPending = async () => false; // another caller flipped it first
    const r = await maybeGrantPendingReferralWelcome(U1, { deps: w.deps });
    expect(r).toEqual({ granted: false, amount: 0, reason: "not_pending" });
    expect(w.balances.get(U1) ?? 0).toBe(0);
    expect(w.ledger).toHaveLength(0);
  });
});

describe("rung 2 at grant time — one welcome per canonical mailbox", () => {
  it("plus-address alias account gets NO second welcome (marked withheld)", async () => {
    const w = makeWorld();
    // fan@gmail.com already collected its welcome via account U1…
    seedPending(w, U1, "fan@gmail.com");
    w.profiles.add(U1);
    await maybeGrantPendingReferralWelcome(U1, { deps: w.deps });
    expect(w.balances.get(U1)).toBe(1000);

    // …and a second account on fan+promo@gmail.com canonicalizes to the
    // same mailbox and is still pending (apply-time race / pre-rung row).
    seedPending(w, U2, "fan@gmail.com");
    w.profiles.add(U2);
    const r = await maybeGrantPendingReferralWelcome(U2, { deps: w.deps });
    expect(r).toEqual({ granted: false, amount: 0, reason: "duplicate_mailbox" });
    expect(w.balances.get(U2) ?? 0).toBe(0);
    expect(w.rows.get(U2)!.welcomeStatus).toBe("withheld");
    expect(w.ledger.filter((l) => l.userId === U2)).toHaveLength(0);
    // The original grant is untouched.
    expect(w.balances.get(U1)).toBe(1000);
  });

  it("a withheld row never pays, even with a profile", async () => {
    const w = makeWorld();
    seedPending(w, U1);
    w.rows.get(U1)!.welcomeStatus = "withheld";
    w.profiles.add(U1);
    const r = await maybeGrantPendingReferralWelcome(U1, {
      profileConfirmed: true,
      deps: w.deps,
    });
    expect(r).toEqual({ granted: false, amount: 0, reason: "duplicate_mailbox" });
    expect(w.balances.get(U1) ?? 0).toBe(0);
  });

  it("no referral row → no grant, no error", async () => {
    const w = makeWorld();
    w.profiles.add(U1);
    const r = await maybeGrantPendingReferralWelcome(U1, { deps: w.deps });
    expect(r).toEqual({ granted: false, amount: 0, reason: "no_referral" });
  });
});

describe("grant failure — clawback + claim release, retry pays once", () => {
  it("ledger failure after credits moved: net zero, back to pending, retry succeeds once", async () => {
    const w = makeWorld();
    seedPending(w, U1);
    w.profiles.add(U1);
    w.ledgerFails = true;
    const failed = await maybeGrantPendingReferralWelcome(U1, { deps: w.deps });
    expect(failed).toEqual({ granted: false, amount: 0, reason: "error" });
    expect(w.balances.get(U1)).toBe(0); // +1000 then clawed back
    expect(w.addCreditsCalls).toEqual([
      { userId: U1, amount: 1000 },
      { userId: U1, amount: -1000 },
    ]);
    expect(w.rows.get(U1)!.welcomeStatus).toBe("pending");

    w.ledgerFails = false;
    const retry = await maybeGrantPendingReferralWelcome(U1, { deps: w.deps });
    expect(retry.granted).toBe(true);
    expect(w.balances.get(U1)).toBe(1000);
    expect(w.ledger).toHaveLength(1);
  });
});
