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
  activeTeam: null as any,
  deductCalls: [] as { userId: string; amount: number }[],
  refundCalls: [] as { userId: string; amount: number }[],
}));

const dbState = vi.hoisted(() => ({
  teams: [] as any[],
  teamMembers: [] as any[],
  creditUsage: [] as any[],
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
  return true;
}

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __eq: true, col: col.__col, val }),
  and: (...conds: any[]) => ({ __and: true, conds }),
  inArray: (col: any, vals: any[]) => ({ __inArray: true, col: col.__col, vals }),
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({ __sql: true, strings, values }),
}));

function mkTable(name: string, rowsKey: "teams" | "teamMembers" | "creditUsage", cols: string[]) {
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
  // without .returning()).
  const insertValues = (table: any) => (vals: any) => {
    const doInsert = () => {
      const arr = Array.isArray(vals) ? vals : [vals];
      return arr.map((v) => {
        const row = { id: nextId("row"), ...v };
        (dbState as any)[table.__rowsKey].push(row);
        return row;
      });
    };
    return {
      returning: () => Promise.resolve(doInsert()),
      then: (resolve: any) => Promise.resolve(doInsert()).then(resolve),
    };
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

  return { db, teamsTable, teamMembersTable, creditUsageTable };
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
  testState.entitled = true;
  testState.activeTeam = null;
  testState.deductCalls = [];
  testState.refundCalls = [];
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
  it("non-entitled users still see invites with canCreate=false", async () => {
    testState.entitled = false;
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
});

describe("POST /api/teams/:id/fund — membership + idempotency", () => {
  it("403s for non-members", async () => {
    dbState.teams.push({ id: "team-1", name: "T", ownerId: "owner-9", credits: 50 });
    const { status } = await post("/api/teams/team-1/fund", { credits: 10, idempotencyKey: "k-1" });
    expect(status).toBe(403);
    expect(testState.deductCalls).toHaveLength(0);
  });

  it("returns the original result on a duplicate idempotency key without charging again", async () => {
    seedTeam({ credits: 100 });
    dbState.creditUsage.push({
      id: "cu-1",
      userId: "user-1",
      action: "team_fund",
      creditsUsed: -25,
      teamId: "team-1",
      idempotencyKey: "key-dup",
    });
    const { status, body } = await post("/api/teams/team-1/fund", { credits: 25, idempotencyKey: "key-dup" });
    expect(status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(testState.deductCalls).toHaveLength(0);
    expect(dbState.teams[0].credits).toBe(100);
  });

  it("does not treat another team's key as a duplicate", async () => {
    seedTeam({ credits: 100 });
    dbState.creditUsage.push({
      id: "cu-1",
      userId: "user-9",
      action: "team_fund",
      creditsUsed: -25,
      teamId: "team-other",
      idempotencyKey: "key-shared",
    });
    const { status, body } = await post("/api/teams/team-1/fund", { credits: 25, idempotencyKey: "key-shared" });
    expect(status).toBe(200);
    expect(body.duplicate).not.toBe(true);
    expect(testState.deductCalls).toHaveLength(1);
    expect(dbState.teams[0].credits).toBe(125);
  });

  it("funds the pool and writes exactly one ledger row on success", async () => {
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
  });

  it("rejects non-positive amounts", async () => {
    seedTeam();
    const { status } = await post("/api/teams/team-1/fund", { credits: 0, idempotencyKey: "k-0" });
    expect(status).toBe(400);
    expect(testState.deductCalls).toHaveLength(0);
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
