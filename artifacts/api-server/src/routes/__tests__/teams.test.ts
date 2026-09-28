/**
 * Route-level tests for Team Workspace:
 *   POST   /api/teams
 *   GET    /api/teams
 *   POST   /api/teams/:id/fund
 *   POST   /api/teams/:id/transfer
 *
 * Covers the production-safety properties:
 * - Shot Caller entitlement is fail-closed on team creation (403 when the
 *   tier check fails or the tier is unknown).
 * - Membership gating: non-members cannot fund the pool or transfer ownership.
 * - Fund idempotency: a repeated idempotency key returns the original result
 *   without charging again (scoped per team).
 * - Ownership transfer atomically swaps roles and owner_id.
 * - Non-entitled users can still see/accept invites (creation is the
 *   entitlement boundary, not membership).
 *
 * Heavy modules (DB, auth, Supabase, credits) are mocked; the real Express
 * router runs against a local ephemeral server. No real database is touched.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  userId: "user-1",
  userEmail: "user-1@example.com",
  entitled: true,
  ownerTier: 4,
  activeTeam: null as any,
  deductCalls: [] as { userId: string; amount: number }[],
  refundCalls: [] as { userId: string; amount: number }[],
  failTx: false,
}));

const dbState = vi.hoisted(() => ({
  teams: [] as any[],
  teamMembers: [] as any[],
  creditUsage: [] as any[],
  fundingOps: [] as any[],
  idSeq: 0,
}));

function nextId(prefix: string): string {
  dbState.idSeq += 1;
  return `${prefix}-${dbState.idSeq}`;
}

function matchRow(row: any, where: any): boolean {
  if (!where) return true;
  if (where.__eq) return row[where.col] === where.val;
  if (where.__and) return (where.conds as any[]).every((c: any) => matchRow(row, c));
  if (where.__inArray) return (where.vals as any[]).includes(row[where.col]);
  if (where.__sql) {
    // Comparison predicates like sql`${col} < ${cutoff}` (reconciler lease).
    const col = (where.values as any[]).find((v: any) => v?.__col)?.__col;
    const cmp = (where.values as any[]).find((v: any) => v instanceof Date || typeof v === "number");
    const joined: string = (where.strings as string[]).join("");
    if (col === undefined || cmp === undefined) return true;
    if (joined.includes("<")) return row[col] < cmp;
    if (joined.includes(">")) return row[col] > cmp;
    return true;
  }
  return true;
}

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __eq: true, col: col.__col, val }),
  and: (...conds: any[]) => ({ __and: true, conds }),
  inArray: (col: any, vals: any[]) => ({ __inArray: true, col: col.__col, vals }),
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({ __sql: true, strings, values }),
}));

function mkTable(name: string, rowsKey: "teams" | "teamMembers" | "creditUsage" | "fundingOps", cols: string[]) {
  const t: any = { __table: name, __rowsKey: rowsKey };
  for (const c of cols) t[c] = { __col: c };
  return t;
}

function applySet(row: any, vals: any) {
  for (const [k, v] of Object.entries(vals)) {
    if ((v as any)?.__sql) {
      const sqlv = v as any;
      const colName = sqlv.values[0]?.__col;
      const num = sqlv.values.find((x: any) => typeof x === "number");
      const joined: string = sqlv.strings.join("");
      if (colName && typeof num === "number") {
        if (joined.includes("+")) row[colName] = (row[colName] ?? 0) + num;
        else if (joined.includes("-")) row[colName] = (row[colName] ?? 0) - num;
      }
    } else {
      row[k] = v;
    }
  }
}

vi.mock("@workspace/db", () => {
  const teamsTable = mkTable("teams", "teams", ["id", "name", "ownerId", "credits", "allowPersonalFallback", "updatedAt"]);
  const teamMembersTable = mkTable("team_members", "teamMembers", ["id", "teamId", "userId", "email", "role", "status", "joinedAt"]);
  const creditUsageTable = mkTable("credit_usage", "creditUsage", ["id", "userId", "action", "creditsUsed", "teamId", "idempotencyKey"]);
  const teamFundingOpsTable = mkTable("team_funding_ops", "fundingOps", ["id", "teamId", "userId", "idempotencyKey", "amount", "status", "createdAt", "updatedAt"]);

  const rowsOf = (t: any): any[] => (dbState as any)[t.__rowsKey];

  const selectBuilder = () => ({
    from: (table: any) => ({
      where: (w: any) => {
        const rows = rowsOf(table).filter((r) => matchRow(r, w));
        // Thenable so both `await where(...)` and `where(...).limit(n)` work.
        return {
          then: (resolve: any) => resolve(rows),
          limit: (n: number) => Promise.resolve(rows.slice(0, n)),
          orderBy: (..._o: any[]) => Promise.resolve(rows),
        };
      },
    }),
  });
  // values() is thenable (real drizzle builders are awaitable with or
  // without .returning()). onConflictDoNothing() skips rows whose
  // (teamId, idempotencyKey) already exists — the funding mutex.
  const insertValues = (table: any) => (vals: any) => {
    const doInsert = (ignoreConflicts: boolean) => {
      const arr = Array.isArray(vals) ? vals : [vals];
      const out: any[] = [];
      for (const v of arr) {
        if (ignoreConflicts && table.__table === "team_funding_ops") {
          const dup = (dbState as any).fundingOps.find(
            (r: any) => r.teamId === v.teamId && r.idempotencyKey === v.idempotencyKey,
          );
          if (dup) continue;
        }
        const row = { id: nextId("row"), createdAt: new Date(), updatedAt: new Date(), ...v };
        (dbState as any)[table.__rowsKey].push(row);
        out.push(row);
      }
      return out;
    };
    const chain = (ignoreConflicts: boolean) => ({
      returning: () => Promise.resolve(doInsert(ignoreConflicts)),
      then: (resolve: any) => Promise.resolve(doInsert(ignoreConflicts)).then(resolve),
    });
    return { ...chain(false), onConflictDoNothing: () => chain(true) };
  };
  // insert needs the table captured: rebuild per-table via closure below.
  let currentTable: any = null;
  const updateBuilder = () => ({
    set: (vals: any) => ({
      // where() is thenable: real drizzle builders apply on await with or
      // without .returning().
      where: (w: any) => {
        const apply = () => {
          const rows = rowsOf(currentTable).filter((r) => matchRow(r, w));
          for (const r of rows) applySet(r, vals);
          return rows;
        };
        return {
          returning: () => Promise.resolve(apply()),
          then: (resolve: any) => Promise.resolve(apply()).then(resolve),
        };
      },
    }),
  });
  const deleteBuilder = () => ({
    where: (w: any) => {
      const key = currentTable.__rowsKey;
      (dbState as any)[key] = (dbState as any)[key].filter((r: any) => !matchRow(r, w));
      return Promise.resolve([]);
    },
  });

  const db = {
    select: (_fields?: any) => selectBuilder(),
    insert: (table: any) => {
      currentTable = table;
      return { values: insertValues(table) };
    },
    update: (table: any) => {
      currentTable = table;
      return updateBuilder();
    },
    delete: (table: any) => {
      currentTable = table;
      return deleteBuilder();
    },
    transaction: async (fn: any) => {
      if ((testState as any).failTx) throw new Error("tx boom (test)");
      const tx = {
        select: (_fields?: any) => selectBuilder(),
        insert: (table: any) => {
          currentTable = table;
          return { values: insertValues(table) };
        },
        update: (table: any) => {
          currentTable = table;
          return updateBuilder();
        },
        delete: (table: any) => {
          currentTable = table;
          return deleteBuilder();
        },
      };
      return fn(tx);
    },
  };

  return { db, teamsTable, teamMembersTable, creditUsageTable, teamFundingOpsTable };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
    req.log = { info: () => {}, warn: () => {}, error: () => {} };
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {
    status = 402;
    constructor() {
      super("out_of_credits");
      this.name = "OutOfCreditsError";
    }
  }
  return {
    OutOfCreditsError,
    deductCredits: vi.fn(async (userId: string, amount: number) => {
      testState.deductCalls.push({ userId, amount });
      return 1000 - amount;
    }),
  };
});

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      admin: {
        getUserById: vi.fn(async (_id: string) => ({
          data: { user: { email: testState.userEmail } },
          error: null,
        })),
        listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
      },
    },
  }),
  addCreditsToProfile: vi.fn(async (userId: string, amount: number) => {
    testState.refundCalls.push({ userId, amount });
  }),
}));

vi.mock("../../lib/teams", () => ({
  isShotCallerOrHigher: vi.fn(async (_userId: string) => testState.entitled),
  getUserActiveTeam: vi.fn(async (_userId: string) => testState.activeTeam),
  isTeamPoolActive: vi.fn(async (_team: any) => (testState.ownerTier ?? 4) >= 4),
}));

import router from "../teams";

let server: any;
let baseUrl: string;
const AUTH = { Authorization: "Bearer test-token" };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  dbState.teams = [];
  dbState.teamMembers = [];
  dbState.creditUsage = [];
  dbState.fundingOps = [];
  testState.entitled = true;
  testState.ownerTier = 4;
  testState.activeTeam = null;
  testState.deductCalls = [];
  testState.refundCalls = [];
  testState.failTx = false;
  testState.userId = "user-1";
  testState.userEmail = "user-1@example.com";
});

const post = (p: string, body: any = {}) =>
  fetch(`${baseUrl}${p}`, {
    method: "POST",
    headers: { ...AUTH, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const get = (p: string) =>
  fetch(`${baseUrl}${p}`, { headers: AUTH }).then(async (r) => ({ status: r.status, body: await r.json() }));

function seedTeam(opts?: { credits?: number; ownerId?: string; memberRole?: string; memberUserId?: string }) {
  const team = {
    id: "team-1",
    name: "Test Team",
    ownerId: opts?.ownerId ?? "user-1",
    credits: opts?.credits ?? 100,
    allowPersonalFallback: true,
  };
  dbState.teams.push(team);
  const membership = {
    id: "m-1",
    teamId: "team-1",
    userId: opts?.memberUserId ?? "user-1",
    email: "user-1@example.com",
    role: opts?.memberRole ?? "admin",
    status: "active",
    joinedAt: new Date(),
  };
  dbState.teamMembers.push(membership);
  return { team, membership };
}

describe("POST /api/teams — Shot Caller entitlement (fail-closed)", () => {
  it("403s when the tier check fails", async () => {
    testState.entitled = false;
    const { status, body } = await post("/api/teams", { name: "Nope" });
    expect(status).toBe(403);
    expect(body.error).toMatch(/Shot Caller/i);
    expect(dbState.teams).toHaveLength(0);
  });

  it("creates a team with an owner membership when entitled", async () => {
    const { status, body } = await post("/api/teams", { name: "Alpha" });
    expect(status).toBe(200);
    expect(body.team.name).toBe("Alpha");
    expect(dbState.teams).toHaveLength(1);
    const members = dbState.teamMembers.filter((m) => m.teamId === body.team.id);
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
    expect(members[0].status).toBe("active");
  });

  it("rejects a second team while already on one", async () => {
    testState.activeTeam = { team: { id: "team-9" }, membership: { role: "member" } };
    const { status } = await post("/api/teams", { name: "Second" });
    expect(status).toBe(400);
    expect(dbState.teams).toHaveLength(0);
  });

  it("rejects blank names", async () => {
    const { status } = await post("/api/teams", { name: "   " });
    expect(status).toBe(400);
  });
});

describe("GET /api/teams — creation is the entitlement boundary", () => {
  it("non-entitled users still see invites with canCreate=false", async () => {    testState.entitled = false;
    dbState.teams.push({ id: "team-1", name: "Inviter Team", ownerId: "owner-9", credits: 0 });
    dbState.teamMembers.push({
      id: "m-inv",
      teamId: "team-1",
      userId: null,
      email: "user-1@example.com",
      role: "member",
      status: "invited",
    });
    const { status, body } = await get("/api/teams");
    expect(status).toBe(200);
    expect(body.canCreate).toBe(false);
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0].team.name).toBe("Inviter Team");
  });

  it("entitled users get canCreate=true", async () => {
    const { status, body } = await get("/api/teams");
    expect(status).toBe(200);
    expect(body.canCreate).toBe(true);
  });

  it("marks poolSuspended=false when the owner is entitled", async () => {
    seedTeam({ ownerId: "user-1" });
    const { status, body } = await get("/api/teams");
    expect(status).toBe(200);
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].poolSuspended).toBe(false);
  });

  it("marks poolSuspended=true when the owner was downgraded", async () => {
    testState.ownerTier = 2;
    seedTeam({ ownerId: "user-1" });
    const { status, body } = await get("/api/teams");
    expect(status).toBe(200);
    expect(body.teams[0].poolSuspended).toBe(true);
  });
});

describe("GET /api/teams/:id — pool suspension flag", () => {
  it("returns poolSuspended=false for an entitled owner's team", async () => {
    seedTeam({ ownerId: "user-1" });
    const { status, body } = await get("/api/teams/team-1");
    expect(status).toBe(200);
    expect(body.poolSuspended).toBe(false);
  });

  it("returns poolSuspended=true after the owner is downgraded", async () => {
    testState.ownerTier = 3;
    seedTeam({ ownerId: "user-1" });
    const { status, body } = await get("/api/teams/team-1");
    expect(status).toBe(200);
    expect(body.poolSuspended).toBe(true);
  });
});

describe("POST /api/teams/:id/fund — funding saga", () => {
  it("403s for non-members", async () => {
    dbState.teams.push({ id: "team-1", name: "T", ownerId: "owner-9", credits: 50 });
    const { status } = await post("/api/teams/team-1/fund", { credits: 10, idempotencyKey: "k-1" });
    expect(status).toBe(403);
    expect(testState.deductCalls).toHaveLength(0);
  });

  it("requires an idempotencyKey", async () => {
    seedTeam();
    const { status } = await post("/api/teams/team-1/fund", { credits: 10 });
    expect(status).toBe(400);
    expect(testState.deductCalls).toHaveLength(0);
  });

  it("returns the original result on a duplicate idempotency key without charging again", async () => {
    seedTeam({ credits: 100 });
    dbState.fundingOps.push({
      id: "op-1", teamId: "team-1", userId: "user-1",
      idempotencyKey: "key-dup", amount: 25, status: "completed",
      createdAt: new Date(), updatedAt: new Date(),
    });
    const { status, body } = await post("/api/teams/team-1/fund", { credits: 25, idempotencyKey: "key-dup" });
    expect(status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(testState.deductCalls).toHaveLength(0);
    expect(dbState.teams[0].credits).toBe(100);
    expect(dbState.fundingOps).toHaveLength(1); // mutex held: no second op row
  });

  it("409s when the same key is already in flight (no double personal deduction)", async () => {
    seedTeam({ credits: 100 });
    dbState.fundingOps.push({
      id: "op-1", teamId: "team-1", userId: "user-1",
      idempotencyKey: "key-flight", amount: 25, status: "started",
      createdAt: new Date(), updatedAt: new Date(), // fresh: not stale
    });
    const { status } = await post("/api/teams/team-1/fund", { credits: 25, idempotencyKey: "key-flight" });
    expect(status).toBe(409);
    expect(testState.deductCalls).toHaveLength(0);
    expect(dbState.teams[0].credits).toBe(100);
  });

  it("does not treat another team's key as a duplicate", async () => {
    seedTeam({ credits: 100 });
    dbState.fundingOps.push({
      id: "op-9", teamId: "team-other", userId: "user-9",
      idempotencyKey: "key-shared", amount: 25, status: "completed",
      createdAt: new Date(), updatedAt: new Date(),
    });
    const { status, body } = await post("/api/teams/team-1/fund", { credits: 25, idempotencyKey: "key-shared" });
    expect(status).toBe(200);
    expect(body.duplicate).not.toBe(true);
    expect(testState.deductCalls).toHaveLength(1);
    expect(dbState.teams[0].credits).toBe(125);
  });

  it("funds the pool, writes exactly one ledger row, and completes the op", async () => {
    seedTeam({ credits: 100 });
    const { status, body } = await post("/api/teams/team-1/fund", { credits: 30, idempotencyKey: "key-ok" });
    expect(status).toBe(200);
    expect(body.team.credits).toBe(130);
    expect(testState.deductCalls).toEqual([{ userId: "user-1", amount: 30 }]);
    const ledger = dbState.creditUsage.filter((r) => r.action === "team_fund");
    expect(ledger).toHaveLength(1);
    expect(ledger[0].creditsUsed).toBe(-30);
    expect(ledger[0].teamId).toBe("team-1");
    expect(ledger[0].idempotencyKey).toBe("key-ok");
    expect(dbState.fundingOps).toHaveLength(1);
    expect(dbState.fundingOps[0].status).toBe("completed");
  });

  it("refunds the personal deduction and marks the op refunded when the pool credit fails", async () => {
    seedTeam({ credits: 100 });
    testState.failTx = true;
    const { status } = await post("/api/teams/team-1/fund", { credits: 30, idempotencyKey: "key-poolfail" });
    expect(status).toBe(500);
    expect(testState.deductCalls).toHaveLength(1);
    expect(testState.refundCalls).toEqual([{ userId: "user-1", amount: 30 }]);
    expect(dbState.teams[0].credits).toBe(100);
    expect(dbState.fundingOps[0].status).toBe("refunded");
  });

  it("rejects non-positive amounts", async () => {
    seedTeam();
    const { status } = await post("/api/teams/team-1/fund", { credits: 0, idempotencyKey: "k-0" });
    expect(status).toBe(400);
    expect(testState.deductCalls).toHaveLength(0);
  });

  describe("stuck-op reconciliation", () => {
    const stale = (over: any) => ({
      id: "op-stale", teamId: "team-1", userId: "user-1",
      idempotencyKey: "key-stale", amount: 40, status: "personal_deducted",
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
      ...over,
    });

    it("refunds a stale personal_deducted op whose pool credit never landed", async () => {
      seedTeam({ credits: 100 });
      dbState.fundingOps.push(stale({}));
      const { status, body } = await post("/api/teams/team-1/fund", { credits: 10, idempotencyKey: "key-fresh" });
      expect(status).toBe(200);
      expect(body.team.credits).toBe(110);
      // The crashed attempt was healed: personal balance refunded...
      expect(testState.refundCalls).toEqual([{ userId: "user-1", amount: 40 }]);
      // ...and the fresh fund still went through exactly once.
      expect(testState.deductCalls).toEqual([{ userId: "user-1", amount: 10 }]);
      expect(dbState.fundingOps.find((o: any) => o.id === "op-stale")!.status).toBe("refunded");
    });

    it("completes a stale personal_deducted op when the ledger shows the pool credit", async () => {
      seedTeam({ credits: 100 });
      dbState.fundingOps.push(stale({}));
      dbState.creditUsage.push({
        id: "cu-1", userId: "user-1", action: "team_fund",
        creditsUsed: -40, teamId: "team-1", idempotencyKey: "key-stale",
      });
      const { status } = await post("/api/teams/team-1/fund", { credits: 10, idempotencyKey: "key-fresh" });
      expect(status).toBe(200);
      expect(testState.refundCalls).toHaveLength(0); // no refund: pool got it
      expect(dbState.fundingOps.find((o: any) => o.id === "op-stale")!.status).toBe("completed");
    });

    it("abandons a stale started op instead of auto-retrying (fail-safe)", async () => {
      seedTeam({ credits: 100 });
      dbState.fundingOps.push(stale({ status: "started" }));
      const { status } = await post("/api/teams/team-1/fund", { credits: 10, idempotencyKey: "key-fresh" });
      expect(status).toBe(200);
      // Ambiguous whether the deduct happened: never auto-retry, no refund.
      expect(testState.refundCalls).toHaveLength(0);
      expect(testState.deductCalls).toEqual([{ userId: "user-1", amount: 10 }]);
      expect(dbState.fundingOps.find((o: any) => o.id === "op-stale")!.status).toBe("abandoned");
    });
  });
});

describe("POST /api/teams/:id/transfer — owner-only atomic handoff", () => {
  it("403s for non-owners", async () => {
    seedTeam({ memberRole: "admin" });
    const { status } = await post("/api/teams/team-1/transfer", { email: "member@example.com" });
    // caller is admin, not owner
    expect(status).toBe(403);
  });

  it("atomically swaps owner role and owner_id", async () => {
    seedTeam({ ownerId: "user-1", memberRole: "owner", memberUserId: "user-1" });
    dbState.teamMembers.push({
      id: "m-2",
      teamId: "team-1",
      userId: "user-2",
      email: "member@example.com",
      role: "member",
      status: "active",
      joinedAt: new Date(),
    });
    const { status, body } = await post("/api/teams/team-1/transfer", { email: "member@example.com" });
    expect(status).toBe(200);
    expect(body.team.ownerId).toBe("user-2");
    const byId = new Map(dbState.teamMembers.map((m) => [m.id, m]));
    expect(byId.get("m-2")!.role).toBe("owner");
    expect(byId.get("m-1")!.role).toBe("admin");
  });

  it("rejects transfer to a non-member", async () => {
    seedTeam({ memberRole: "owner", memberUserId: "user-1" });
    const { status } = await post("/api/teams/team-1/transfer", { email: "stranger@example.com" });
    expect(status).toBe(400);
  });
});
