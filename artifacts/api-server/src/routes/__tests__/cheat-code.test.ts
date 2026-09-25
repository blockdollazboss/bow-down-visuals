/**
 * Route tests for the Cheat Code Jackpot:
 *
 *   GET    /api/cheat-code/status
 *   POST   /api/cheat-code/attempt
 *   GET    /api/cheat-code/admin/events
 *   POST   /api/cheat-code/admin/events
 *   POST   /api/cheat-code/admin/events/:id/activate
 *   POST   /api/cheat-code/admin/events/:id/deactivate
 *
 * Real database semantics via pg-mem (the @workspace/db module is real;
 * only its `db` handle is swapped for the in-memory instance). Supabase
 * (profiles credit grant) and the credit ledger are mocked — no network,
 * no real credits move.
 *
 * Security assertions: the secret code and its hash are NEVER exposed via
 * the public endpoints; the claim is atomic (one winner); attempts are
 * rate-limited.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  db: null as any,
  userId: "" as string | null,
  userEmail: "player@example.com",
  isAdmin: false,
  credits: 50,
  grantCalls: [] as { id: string; vals: any }[],
  ledgerCalls: [] as any[],
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!testState.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = testState.userId;
    req.userEmail = testState.userEmail;
    next();
  },
}));

vi.mock("../admin", () => ({
  requireAdmin: (_req: any, res: any, next: any) => {
    if (!testState.isAdmin) {
      res.status(403).json({ error: "Not authorized." });
      return;
    }
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return testState.db;
    },
  };
});

vi.mock("../../lib/supabase-admin", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getSupabaseAdmin: () => ({
      from: (table: string) => {
        if (table !== "profiles") throw new Error(`unexpected table ${table}`);
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _id: string) => ({
              single: async () => ({
                data: { credits: testState.credits, display_name: "Test Shark" },
                error: null,
              }),
            }),
          }),
        };
      },
    }),
    /* Mirrors the real helper's delta semantics against testState. */
    addCreditsToProfile: async (userId: string, creditsToAdd: number) => {
      const oldCredits = testState.credits;
      const newCredits = oldCredits + creditsToAdd;
      testState.credits = newCredits;
      testState.grantCalls.push({ id: userId, vals: { credits: newCredits } });
      return { oldCredits, newCredits, created: false };
    },
  };
});

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: vi.fn(async (rec: any) => {
    testState.ledgerCalls.push(rec);
  }),
}));

import router, { hashCodeSequence } from "../cheat-code";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const EVENTS_DDL = `
CREATE TABLE cheat_code_events (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  code_hash text NOT NULL,
  code_length integer NOT NULL,
  prize_credits integer NOT NULL DEFAULT 100,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  winner_user_id uuid,
  winner_display_name text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cheat_code_attempts (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  user_id uuid,
  ip text,
  success boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);`;

const SEQ = ["up", "up", "down", "left", "right", "left", "down", "down", "right", "up"];
const WRONG = ["up", "down", "up", "down", "left", "left", "right", "right", "up", "down"];

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.none(EVENTS_DDL);
  testState.db = db;
  testState.userId = randomUUID();
  testState.userEmail = "player@example.com";
  testState.isAdmin = false;
  testState.credits = 50;
  testState.grantCalls = [];
  testState.ledgerCalls = [];
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function seedEvent(overrides: {
  name?: string;
  isActive?: boolean;
  startsAt?: Date;
  endsAt?: Date;
} = {}) {
  const id = randomUUID();
  const name = overrides.name ?? `Cheat Code Jackpot — Test ${id.slice(0, 8)}`;
  const startsAt = overrides.startsAt ?? new Date(Date.now() - 60_000);
  const endsAt = overrides.endsAt ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 180);
  const isActive = overrides.isActive ?? true;
  await testState.db.execute(sql`
    INSERT INTO cheat_code_events
      (id, name, code_hash, code_length, prize_credits, starts_at, ends_at, is_active)
    VALUES
      (${id}, ${name}, ${hashCodeSequence(SEQ)}, ${SEQ.length}, 100, ${startsAt}, ${endsAt}, ${isActive})
  `);
  return id;
}

describe("GET /api/cheat-code/status", () => {
  it("returns phase none when no events exist", async () => {
    const { status, json } = await req("GET", "/cheat-code/status");
    expect(status).toBe(200);
    expect(json.phase).toBe("none");
  });

  it("returns a live event without ever exposing the code or hash", async () => {
    await seedEvent();
    const { status, json } = await req("GET", "/cheat-code/status");
    expect(status).toBe(200);
    expect(json.phase).toBe("live");
    expect(json.prizeCredits).toBe(100);
    expect(json.codeLength).toBe(10);
    expect(json.startsAt).toBeTruthy();
    expect(json.endsAt).toBeTruthy();
    const raw = JSON.stringify(json).toLowerCase();
    expect(raw).not.toContain("codehash");
    expect(raw).not.toContain("code_hash");
    expect(raw).not.toContain(hashCodeSequence(SEQ));
  });

  it("reports claimed phase with the winner spotlight after a win", async () => {
    await seedEvent();
    const win = await req("POST", "/cheat-code/attempt", { sequence: SEQ });
    expect(win.json.correct).toBe(true);
    const { json } = await req("GET", "/cheat-code/status");
    expect(json.phase).toBe("claimed");
    expect(json.winnerDisplayName).toBe("Test Shark");
    expect(json.claimedAt).toBeTruthy();
  });
});

describe("POST /api/cheat-code/attempt", () => {
  it("requires auth", async () => {
    testState.userId = null;
    const { status } = await req("POST", "/cheat-code/attempt", { sequence: SEQ });
    expect(status).toBe(401);
  });

  it("404s when no live event exists", async () => {
    const { status } = await req("POST", "/cheat-code/attempt", { sequence: SEQ });
    expect(status).toBe(404);
  });

  it("rejects malformed sequences", async () => {
    await seedEvent();
    const bad = await req("POST", "/cheat-code/attempt", {
      sequence: ["up", "diagonal", "left"],
    });
    expect(bad.status).toBe(400);
    const short = await req("POST", "/cheat-code/attempt", { sequence: ["up"] });
    expect(short.status).toBe(400);
  });

  it("wrong sequence -> correct:false, no credits move", async () => {
    await seedEvent();
    const { status, json } = await req("POST", "/cheat-code/attempt", {
      sequence: WRONG,
    });
    expect(status).toBe(200);
    expect(json.correct).toBe(false);
    expect(json.claimed).toBe(false);
    expect(testState.grantCalls).toHaveLength(0);
    expect(testState.ledgerCalls).toHaveLength(0);
  });

  it("correct sequence wins exactly once: grants 100 credits + ledger entry", async () => {
    await seedEvent();
    const { status, json } = await req("POST", "/cheat-code/attempt", {
      sequence: SEQ,
    });
    expect(status).toBe(200);
    expect(json.correct).toBe(true);
    expect(json.claimed).toBe(true);
    expect(json.prizeCredits).toBe(100);
    expect(json.newBalance).toBe(150);
    expect(json.winnerDisplayName).toBe("Test Shark");
    expect(testState.grantCalls).toHaveLength(1);
    expect(testState.ledgerCalls).toHaveLength(1);
    expect(testState.ledgerCalls[0]).toMatchObject({
      userId: testState.userId,
      action: "Cheat Code Jackpot",
      creditsUsed: -100,
    });
  });

  it("a second winner cannot double-claim", async () => {
    await seedEvent();
    const first = await req("POST", "/cheat-code/attempt", { sequence: SEQ });
    expect(first.json.correct).toBe(true);

    testState.userId = randomUUID();
    const second = await req("POST", "/cheat-code/attempt", { sequence: SEQ });
    expect(second.json.correct).toBe(false);
    expect(second.json.claimed).toBe(true);
    expect(testState.grantCalls).toHaveLength(1);
    expect(testState.ledgerCalls).toHaveLength(1);
  });

  it("reverts credits and rolls back the claim if the ledger write fails", async () => {
    await seedEvent();
    const { recordCreditUsageStrict } = await import("../../lib/payment-record");
    vi.mocked(recordCreditUsageStrict).mockRejectedValueOnce(
      new Error("ledger down"),
    );

    const res = await req("POST", "/cheat-code/attempt", { sequence: SEQ });
    expect(res.status).toBe(500);
    /* credit delta reversed: back to the 50 we started with */
    expect(testState.credits).toBe(50);
    expect(testState.grantCalls).toHaveLength(2); // +100 then -100
    expect(testState.grantCalls[1]!.vals).toEqual({ credits: 50 });

    /* claim rolled back — the jackpot is winnable again */
    const status = await req("GET", "/cheat-code/status");
    expect(status.json.phase).toBe("live");
    expect(status.json.winnerDisplayName).toBeNull();
  });

  it("rate-limits after too many attempts", async () => {
    const eventId = await seedEvent();
    // 30 failed attempts = the per-user cap inside the 10-minute window.
    for (let i = 0; i < 30; i++) {
      await testState.db.execute(sql`
        INSERT INTO cheat_code_attempts (id, event_id, user_id, ip, success)
        VALUES (${randomUUID()}, ${eventId}, ${testState.userId}, '127.0.0.1', false)
      `);
    }
    const { status, json } = await req("POST", "/cheat-code/attempt", {
      sequence: WRONG,
    });
    expect(status).toBe(429);
    expect(json.error).toMatch(/too many/i);
  });
});

describe("admin event management", () => {
  it("denies non-admins", async () => {
    testState.isAdmin = false;
    const { status } = await req("GET", "/cheat-code/admin/events");
    expect(status).toBe(403);
  });

  it("creates, activates, and deactivates a cycle", async () => {
    testState.isAdmin = true;
    const newSeq = ["left", "right", "up", "down", "left", "up"];
    const created = await req("POST", "/cheat-code/admin/events", {
      name: "Cheat Code Jackpot — Season 2",
      codeSequence: newSeq,
      endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString(),
      prizeCredits: 100,
    });
    expect(created.status).toBe(201);
    expect(created.json.event.name).toBe("Cheat Code Jackpot — Season 2");
    expect(created.json.event.isActive).toBe(false);
    expect(JSON.stringify(created.json)).not.toContain(hashCodeSequence(newSeq));
    const id = created.json.event.id as string;

    const activated = await req("POST", `/cheat-code/admin/events/${id}/activate`);
    expect(activated.status).toBe(200);
    expect(activated.json.event.isActive).toBe(true);

    // The new code is live and winnable via the public attempt endpoint.
    testState.isAdmin = false;
    const attempt = await req("POST", "/cheat-code/attempt", { sequence: newSeq });
    expect(attempt.json.correct).toBe(true);

    testState.isAdmin = true;
    const deactivated = await req("POST", `/cheat-code/admin/events/${id}/deactivate`);
    expect(deactivated.json.event.isActive).toBe(false);

    const listed = await req("GET", "/cheat-code/admin/events");
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.json.events)).toBe(true);
    expect(JSON.stringify(listed.json)).not.toContain("codeHash");
  });

  it("activating one event retires the others", async () => {
    testState.isAdmin = true;
    const a = await req("POST", "/cheat-code/admin/events", {
      name: "Cycle A",
      codeSequence: ["up", "up", "down", "down"],
      endsAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const b = await req("POST", "/cheat-code/admin/events", {
      name: "Cycle B",
      codeSequence: ["left", "left", "right", "right"],
      endsAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await req("POST", `/cheat-code/admin/events/${a.json.event.id}/activate`);
    const second = await req("POST", `/cheat-code/admin/events/${b.json.event.id}/activate`);
    expect(second.json.event.isActive).toBe(true);

    const listed = await req("GET", "/cheat-code/admin/events");
    const cycleA = listed.json.events.find((e: any) => e.name === "Cycle A");
    expect(cycleA.isActive).toBe(false);
  });

  it("refuses to activate an already-ended event", async () => {
    testState.isAdmin = true;
    const id = await seedEvent({
      name: "Expired Cycle",
      isActive: false,
      startsAt: new Date(Date.now() - 86400000 * 200),
      endsAt: new Date(Date.now() - 86400000 * 10),
    });
    const { status } = await req("POST", `/cheat-code/admin/events/${id}/activate`);
    expect(status).toBe(400);
  });
});
