/**
 * Trial grant ledger rows (board item 58, payments lane).
 *
 * POST /credits/claim-trial used to bump profiles.credits with NO
 * credit_usage row — the grant was invisible on /credit-history (the
 * disease the referral fix cured for referral grants only). The route
 * now writes a strict ledger row keyed `trial-grant:${userId}` after
 * the grant lands, and on ledger failure it follows the referral
 * pattern: claw the credits back, release the claim flag, fail the
 * request — so the member can retry from a clean state.
 *
 * Supabase is faked at the module seam (chainable query builder over
 * in-test state); the grant-ledger module is faked with a controllable
 * recordGrantLedger so both its success and failure legs are pinned.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-trial-1";

const h = vi.hoisted(() => ({
  profile: null as null | { trial_credits_claimed: boolean },
  balanceDelta: 0,
  ledgerCalls: [] as Array<{ kind: string; userId: string }>,
  ledgerFails: false,
  flagUpdates: [] as boolean[],
}));

/* Minimal chainable Supabase fake: every builder method returns the
   same query object; awaiting it (or its terminal helpers) resolves
   from the in-test profile state. */
function makeQuery() {
  const q: any = {
    _op: "",
    select: () => q,
    insert: (row: any) => {
      h.profile = { trial_credits_claimed: row.trial_credits_claimed === true };
      return Promise.resolve({ error: null });
    },
    update: (patch: any) => {
      q._op = "update";
      q._patch = patch;
      return q;
    },
    eq: () => q,
    maybeSingle: async () => ({
      data: h.profile ? { trial_credits_claimed: h.profile.trial_credits_claimed } : null,
      error: null,
    }),
    then: (resolve: any, reject: any) => {
      if (q._op === "update" && q._patch) {
        const claimed = q._patch.trial_credits_claimed === true;
        h.flagUpdates.push(claimed);
        if (h.profile) {
          if (claimed && h.profile.trial_credits_claimed) {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
          h.profile.trial_credits_claimed = claimed;
        }
        return Promise.resolve({
          data: claimed ? [{ id: USER }] : [],
          error: null,
        }).then(resolve, reject);
      }
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    },
  };
  return q;
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER;
    next();
  },
}));

vi.mock("../../lib/payment-record", () => ({
  getPaymentHistory: async () => [],
  getCreditUsage: async () => [],
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ from: () => makeQuery() }),
  addCreditsAtomic: async (_userId: string, amount: number) => {
    h.balanceDelta += amount;
    return { oldCredits: 0, newCredits: h.balanceDelta, created: false };
  },
}));

vi.mock("../../lib/grant-ledger", () => ({
  TRIAL_GRANT_CREDITS: 1000,
  STARTER_GRANT_CREDITS: 300,
  grantLedgerKey: (kind: string, userId: string) => `${kind}-grant:${userId}`,
  recordGrantLedger: async (kind: string, userId: string) => {
    h.ledgerCalls.push({ kind, userId });
    if (h.ledgerFails) throw new Error("ledger down");
    return "recorded";
  },
}));

import creditsRouter from "../credits";

let server: any;
let base = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {} };
    next();
  });
  app.use("/api", creditsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.profile = { trial_credits_claimed: false };
  h.balanceDelta = 0;
  h.ledgerCalls = [];
  h.ledgerFails = false;
  h.flagUpdates = [];
});

async function claim() {
  const r = await realFetch(`${base}/credits/claim-trial`, { method: "POST" });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("POST /credits/claim-trial — ledger discipline", () => {
  it("a successful claim grants 1,000 and writes the trial ledger row", async () => {
    const r = await claim();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ granted: true, credits: 1000 });
    expect(h.balanceDelta).toBe(1000);
    expect(h.ledgerCalls).toEqual([{ kind: "trial", userId: USER }]);
  });

  it("an already-claimed profile grants nothing and writes nothing", async () => {
    h.profile = { trial_credits_claimed: true };
    const r = await claim();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ granted: false, reason: "already_claimed" });
    expect(h.balanceDelta).toBe(0);
    expect(h.ledgerCalls).toHaveLength(0);
  });

  it("ledger failure claws the grant back and releases the claim flag (referral pattern)", async () => {
    h.ledgerFails = true;
    const r = await claim();
    expect(r.status).toBe(500);
    /* +1000 grant, then −1000 clawback: the member is made whole and
       can retry; the flag rollback is the last flag update. */
    expect(h.balanceDelta).toBe(0);
    expect(h.ledgerCalls).toHaveLength(1);
    expect(h.flagUpdates).toContain(false);
    expect(h.profile?.trial_credits_claimed).toBe(false);
  });

  it("a brand-new profile (insert path) also writes the ledger row", async () => {
    h.profile = null;
    const r = await claim();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ granted: true, credits: 1000 });
    expect(h.ledgerCalls).toEqual([{ kind: "trial", userId: USER }]);
  });

  it("insert-path ledger failure releases the claim so a retry can succeed", async () => {
    h.profile = null;
    h.ledgerFails = true;
    const r = await claim();
    expect(r.status).toBe(500);
    expect(h.flagUpdates).toContain(false);
    expect(h.profile?.trial_credits_claimed).toBe(false);
  });
});
