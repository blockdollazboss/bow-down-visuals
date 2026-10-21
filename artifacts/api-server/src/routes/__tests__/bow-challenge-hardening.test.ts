/**
 * Route tests for POST /api/bow (Global Bow Race prize grant).
 *
 * The Postgres function bow_race_record marks the winner atomically —
 * exactly one request ever sees o_won. The grant that follows used to be
 * a read-modify-write of profiles.credits, and only a LEDGER failure
 * rolled the win back (bow_race_undo_win). A profile read/write failure
 * left the month marked won with the prize never paid and no retry path:
 * every later bow short-circuits on the frozen race.
 *
 * The hardened handler grants via addCreditsAtomic (increment_credits
 * RPC) and treats ANY grant-stage failure the same way: compensate the
 * delta if the grant landed, un-mark the win, fail loudly — the race
 * reopens and a later bow can land on the target again.
 *
 * Supabase (config + RPCs) and the strict ledger are mocked; the handler
 * logic under test is the real one.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  state: {
    userId: "" as string | null,
    userEmail: "winner@example.com",
    raceEnabled: true,
    rewardCredits: 5000,
    won: true,
    recordCalls: 0,
    undoCalls: [] as any[],
    atomicCalls: [] as Array<{ userId: string; amount: number }>,
    atomicFailures: 0, // next N addCreditsAtomic calls throw
    ledgerCalls: [] as any[],
    ledgerFailures: 0,
    emailStamps: 0,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!h.state.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = h.state.userId;
    req.userEmail = h.state.userEmail;
    next();
  },
}));

vi.mock("../admin", () => ({
  requireAdmin: (_req: any, res: any, next: any) => next(),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "bow_challenge_config") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _v: unknown) => ({
              single: async () => ({
                data: {
                  reward_credits: h.state.rewardCredits,
                  enabled: h.state.raceEnabled,
                  target_override: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "bow_race_months") {
        return {
          update: (_vals: unknown) => ({
            eq: (_c1: string, _v1: unknown) => ({
              eq: async (_c2: string, _v2: unknown) => {
                h.state.emailStamps++;
                return { error: null };
              },
            }),
          }),
          select: (_cols: string) => ({
            eq: (_c: string, _v: unknown) => ({
              single: async () => ({ data: null, error: null }),
            }),
            not: (_c: string, _op: string, _v: unknown) => ({
              order: (_c2: string, _o: unknown) => ({
                limit: async (_n: number) => ({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (fn: string, args: any) => {
      if (fn === "bow_race_record") {
        h.state.recordCalls++;
        return {
          data: [
            {
              o_total: 4321,
              o_target: 4321,
              o_won: h.state.won,
              o_race_over: h.state.won,
            },
          ],
          error: null,
        };
      }
      if (fn === "bow_race_undo_win") {
        h.state.undoCalls.push(args);
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  }),
  addCreditsAtomic: vi.fn(async (userId: string, amount: number) => {
    if (h.state.atomicFailures > 0) {
      h.state.atomicFailures--;
      throw new Error("increment_credits failed (test)");
    }
    h.state.atomicCalls.push({ userId, amount });
    return { oldCredits: 100, newCredits: 100 + amount, created: false };
  }),
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: vi.fn(async (rec: any) => {
    if (h.state.ledgerFailures > 0) {
      h.state.ledgerFailures--;
      throw new Error("ledger failed (test)");
    }
    h.state.ledgerCalls.push(rec);
  }),
}));

import router from "../bow-challenge";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.state.userId = randomUUID();
  h.state.raceEnabled = true;
  h.state.rewardCredits = 5000;
  h.state.won = true;
  h.state.recordCalls = 0;
  h.state.undoCalls = [];
  h.state.atomicCalls = [];
  h.state.atomicFailures = 0;
  h.state.ledgerCalls = [];
  h.state.ledgerFailures = 0;
  h.state.emailStamps = 0;
});

async function bow() {
  const r = await realFetch(`${baseUrl}/bow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("POST /api/bow — prize grant hardening", () => {
  it("win: grants atomically once, writes the ledger, never undoes", async () => {
    const res = await bow();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, rewarded: true, rewardCredits: 5000 });
    expect(h.state.atomicCalls).toEqual([{ userId: h.state.userId, amount: 5000 }]);
    expect(h.state.ledgerCalls).toHaveLength(1);
    expect(h.state.ledgerCalls[0]).toMatchObject({ action: "Global Bow Race", creditsUsed: -5000 });
    expect(h.state.undoCalls).toHaveLength(0);
    expect(h.state.emailStamps).toBe(1);
  });

  it("grant failure: the win is un-marked so the race reopens", async () => {
    h.state.atomicFailures = 1;
    const res = await bow();
    expect(res.status).toBe(500);
    expect(h.state.undoCalls).toHaveLength(1);
    expect(h.state.undoCalls[0]).toMatchObject({ p_user_id: h.state.userId });
    expect(h.state.ledgerCalls).toHaveLength(0);
    // No compensation: the grant never landed.
    expect(h.state.atomicCalls).toHaveLength(0);
  });

  it("ledger failure: delta compensated AND the win is un-marked", async () => {
    h.state.ledgerFailures = 1;
    const res = await bow();
    expect(res.status).toBe(500);
    expect(h.state.atomicCalls).toEqual([
      { userId: h.state.userId, amount: 5000 },
      { userId: h.state.userId, amount: -5000 },
    ]);
    expect(h.state.undoCalls).toHaveLength(1);
  });

  it("ordinary bow (no win): no grant, no ledger, no undo", async () => {
    h.state.won = false;
    const res = await bow();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, rewarded: false, rewardCredits: 0 });
    expect(h.state.atomicCalls).toHaveLength(0);
    expect(h.state.undoCalls).toHaveLength(0);
  });

  it("race disabled: the recorder is never even called", async () => {
    h.state.raceEnabled = false;
    const res = await bow();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ rewarded: false });
    expect(h.state.recordCalls).toBe(0);
  });
});
