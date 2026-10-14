/**
 * Route tests for the fan-contest hardening (routes/generate/contests):
 *
 *   1. THE DRAW IS ONE-SHOT. POST /contests/:id/draw used to re-roll on
 *      every call: a fresh seed (new drawnAt) overwrote winner_entry_id
 *      AND the stored audit, so a creator could re-draw until a favored
 *      entry won and the "provably fair" trail showed only the last roll.
 *      Now: a fast-path 409 when a winner exists + a conditional UPDATE
 *      (winner_entry_id IS NULL) as the atomic backstop.
 *   2. ENTRY ADDS ARE SERIALIZED. The duplicate check was read-then-insert
 *      with no lock — concurrent adds of the same handle + method both
 *      passed and both inserted (double entry, double draw odds). The
 *      check + insert now run in one transaction under a per-contest
 *      pg_advisory_xact_lock.
 *
 * Fake-db style (mirrors lib/__tests__/credits-team-pool.test.ts): the
 * fake implements only the chains these handlers use, but it applies the
 * draw's IS NULL predicate as a synchronous check-and-set and models the
 * advisory lock as a per-contest async mutex — so a handler that skipped
 * the lock or the guard would fail these tests exactly as it would fail
 * in production. The rendered WHERE of the draw UPDATE is also asserted
 * to carry the IS NULL guard.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

interface ContestRow {
  id: string;
  user_id: string;
  title: string;
  prize: string;
  description: string;
  rules: string;
  entry_methods: string[];
  starts_at: Date | null;
  ends_at: Date | null;
  status: string;
  winner_entry_id: string | null;
  draw_audit: unknown;
  announcement_image_url: string | null;
  created_at: Date;
  updated_at: Date;
}

interface EntryRow {
  id: string;
  contest_id: string;
  handle: string;
  email: string | null;
  entry_method: string;
  is_verified: boolean;
  created_at: Date;
}

const h = vi.hoisted(() => ({
  state: {
    userId: "" as string | null,
    contests: new Map<string, ContestRow>(),
    entries: new Map<string, EntryRow>(),
    locks: new Map<string, Promise<void>>(),
    lockAcquired: 0,
    drawUpdateConditions: [] as Array<{ sql: string; params: unknown[] }>,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!h.state.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = h.state.userId;
    (req as any).userCredits = 100000;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { contestsTable, contestEntriesTable } = actual;

  const entriesFor = (contestId: string) =>
    [...state.entries.values()].filter((e) => e.contest_id === contestId);

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const rendered = render(cond);
          const params = rendered.params as any[];
          const chain: any = {
            limit: async (_n: number) => {
              if (table === contestsTable) {
                const [cid, uid] = params;
                const row = state.contests.get(cid);
                return row && row.user_id === uid ? [row] : [];
              }
              return [];
            },
            orderBy: (..._args: unknown[]) => {
              if (table === contestEntriesTable) {
                const cid = params[0];
                let rows = entriesFor(cid);
                // The draw's select filters is_verified = true.
                if (rendered.sql.includes("is_verified") && params.includes(true)) {
                  rows = rows.filter((e) => e.is_verified);
                }
                return Promise.resolve(rows);
              }
              return Promise.resolve([]);
            },
            then: (res: any, rej: any) => chain.limit(1000).then(res, rej),
          };
          return chain;
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: (cond: unknown) => ({
          returning: async () => {
            if (table !== contestsTable) return [];
            const rendered = render(cond);
            state.drawUpdateConditions.push(rendered);
            const cid = rendered.params[0] as string;
            const row = state.contests.get(cid);
            // CAS: the UPDATE lands only while winner_entry_id IS NULL.
            if (!row || row.winner_entry_id !== null) return [];
            Object.assign(row, vals);
            return [row];
          },
        }),
      }),
    }),
    transaction: async (cb: (tx: any) => Promise<unknown>) => {
      let releaseLock: (() => void) | null = null;
      const tx: any = {
        execute: async (sqlObj: unknown) => {
          const rendered = render(sqlObj);
          if (rendered.sql.includes("pg_advisory_xact_lock")) {
            const key = String(rendered.params[0]);
            const prior = state.locks.get(key) ?? Promise.resolve();
            let release!: () => void;
            const mine = new Promise<void>((r) => (release = r));
            state.locks.set(key, prior.then(() => mine));
            await prior;
            state.lockAcquired++;
            releaseLock = release;
          }
          return { rows: [] };
        },
        select: (_fields?: unknown) => ({
          from: (table: unknown) => ({
            where: (cond: unknown) => {
              const rendered = render(cond);
              const cid = rendered.params[0] as string;
              if (table === contestEntriesTable) return Promise.resolve(entriesFor(cid));
              return Promise.resolve([]);
            },
          }),
        }),
        insert: (table: unknown) => ({
          values: (vals: Record<string, unknown>) => ({
            returning: async () => {
              if (table !== contestEntriesTable) return [];
              const row: EntryRow = {
                id: randomUUID(),
                contest_id: String(vals["contest_id"]),
                handle: String(vals["handle"]),
                email: (vals["email"] as string | null) ?? null,
                entry_method: String(vals["entry_method"]),
                is_verified: false,
                created_at: new Date(),
              };
              state.entries.set(row.id, row);
              return [row];
            },
          }),
        }),
      };
      try {
        return await cb(tx);
      } finally {
        releaseLock?.();
      }
    },
  };

  return {
    ...actual,
    get db() {
      return fakeDb;
    },
  };
});

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => {}),
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({ images: { generate: vi.fn(async () => ({ data: [] })) } }),
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async () => "supabase://x"),
  refreshSupabaseStorageUrl: vi.fn(async (v: unknown) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (v: unknown) => v),
  normalizeToStorageRef: vi.fn((v: unknown) => v),
}));

import router from "../generate/contests";

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

beforeEach(() => {
  h.state.userId = randomUUID();
  h.state.contests = new Map();
  h.state.entries = new Map();
  h.state.locks = new Map();
  h.state.lockAcquired = 0;
  h.state.drawUpdateConditions = [];
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

function seedContest(opts: { owner?: string } = {}): ContestRow {
  const row: ContestRow = {
    id: randomUUID(),
    user_id: opts.owner ?? h.state.userId!,
    title: "Test Giveaway",
    prize: "A signed poster",
    description: "",
    rules: "",
    entry_methods: ["follow", "comment"],
    starts_at: null,
    ends_at: null,
    status: "active",
    winner_entry_id: null,
    draw_audit: null,
    announcement_image_url: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
  h.state.contests.set(row.id, row);
  return row;
}

function seedEntry(contestId: string, handle: string, method = "follow", verified = true): EntryRow {
  const row: EntryRow = {
    id: randomUUID(),
    contest_id: contestId,
    handle,
    email: null,
    entry_method: method,
    is_verified: verified,
    created_at: new Date(),
  };
  h.state.entries.set(row.id, row);
  return row;
}

describe("POST /api/contests/:id/draw — one-shot", () => {
  it("draws a verified winner, ends the contest, stores the audit", async () => {
    const contest = seedContest();
    seedEntry(contest.id, "@alpha");
    seedEntry(contest.id, "@bravo");
    const ghost = seedEntry(contest.id, "@ghost", "follow", false);

    const res = await req("POST", `/contests/${contest.id}/draw`);
    expect(res.status).toBe(200);
    expect(res.json.winner.id).not.toBe(ghost.id);
    expect(contest.winner_entry_id).toBe(res.json.winner.id);
    expect(contest.status).toBe("ended");
    const audit = contest.draw_audit as any;
    expect(audit.entryIds).not.toContain(ghost.id);
    expect(audit.entryIds).toHaveLength(2);
  });

  it("the draw UPDATE's WHERE carries the winner_entry_id IS NULL guard", async () => {
    const contest = seedContest();
    seedEntry(contest.id, "@alpha");
    await req("POST", `/contests/${contest.id}/draw`);
    expect(h.state.drawUpdateConditions).toHaveLength(1);
    expect(h.state.drawUpdateConditions[0]!.sql).toContain('"winner_entry_id" is null');
  });

  it("a second draw 409s — winner and audit are NOT overwritten", async () => {
    const contest = seedContest();
    seedEntry(contest.id, "@alpha");
    seedEntry(contest.id, "@bravo");
    seedEntry(contest.id, "@charlie");

    const first = await req("POST", `/contests/${contest.id}/draw`);
    expect(first.status).toBe(200);
    const winnerAfterFirst = contest.winner_entry_id;
    const auditAfterFirst = JSON.stringify(contest.draw_audit);

    const second = await req("POST", `/contests/${contest.id}/draw`);
    expect(second.status).toBe(409);
    expect(contest.winner_entry_id).toBe(winnerAfterFirst);
    expect(JSON.stringify(contest.draw_audit)).toBe(auditAfterFirst);
  });

  it("two concurrent draws: exactly one wins, exactly one audit", async () => {
    const contest = seedContest();
    seedEntry(contest.id, "@alpha");
    seedEntry(contest.id, "@bravo");
    const [a, b] = await Promise.all([
      req("POST", `/contests/${contest.id}/draw`),
      req("POST", `/contests/${contest.id}/draw`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(contest.winner_entry_id).not.toBeNull();
  });

  it("draw with no verified entries 400s", async () => {
    const contest = seedContest();
    seedEntry(contest.id, "@ghost", "follow", false);
    const res = await req("POST", `/contests/${contest.id}/draw`);
    expect(res.status).toBe(400);
    expect(contest.winner_entry_id).toBeNull();
  });

  it("a non-owner cannot draw", async () => {
    const contest = seedContest({ owner: randomUUID() });
    seedEntry(contest.id, "@alpha");
    const res = await req("POST", `/contests/${contest.id}/draw`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/contests/:id/entries — serialized duplicate guard", () => {
  it("adds an entry, then rejects the same handle + method (case-insensitive)", async () => {
    const contest = seedContest();
    const first = await req("POST", `/contests/${contest.id}/entries`, {
      handle: "@FanOne",
      entryMethod: "follow",
    });
    expect(first.status).toBe(201);
    const dup = await req("POST", `/contests/${contest.id}/entries`, {
      handle: "@fanone",
      entryMethod: "follow",
    });
    expect(dup.status).toBe(409);
    expect(h.state.lockAcquired).toBe(2); // both adds took the advisory lock
  });

  it("the same handle via a different method is a distinct entry", async () => {
    const contest = seedContest();
    await req("POST", `/contests/${contest.id}/entries`, { handle: "@fan", entryMethod: "follow" });
    const second = await req("POST", `/contests/${contest.id}/entries`, {
      handle: "@fan",
      entryMethod: "comment",
    });
    expect(second.status).toBe(201);
  });

  it("two concurrent adds of the same handle + method insert exactly one row", async () => {
    const contest = seedContest();
    const [a, b] = await Promise.all([
      req("POST", `/contests/${contest.id}/entries`, { handle: "@racer", entryMethod: "follow" }),
      req("POST", `/contests/${contest.id}/entries`, { handle: "@Racer", entryMethod: "follow" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const rows = [...h.state.entries.values()].filter(
      (e) => e.contest_id === contest.id && e.handle.toLowerCase() === "@racer",
    );
    expect(rows).toHaveLength(1);
  });
});
