/**
 * Public subscribe door (Oct 21) — the ONE narrow opening in the staging
 * wall, proven end-to-end against the REAL gate, the REAL door CORS, the
 * REAL global CORS config, and the REAL email-list router (fake db):
 *
 *  (a) POST /api/email-list/subscribe from https://join.bowdownvisuals.com
 *      passes the gate with NO cookie and succeeds (200, ACAO = join
 *      origin); duplicate + invalid-email behavior unchanged.
 *  (b) A gated route without the cookie still returns 401 staging_locked.
 *  (c) A preflight from a random origin gets NO Access-Control-Allow-Origin;
 *      a preflight from the join origin to a DIFFERENT route also gets none
 *      (the door is route-scoped, it did not leak into the global policy).
 *  (d) GET on the subscribe path is still gated (401) — POST only.
 *
 * Middleware order mirrors app.ts exactly: door CORS (path-scoped) →
 * global CORS → json → stagingGate → /api router.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import cors from "cors";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";

const h = vi.hoisted(() => ({
  lists: [] as Array<Record<string, any>>,
  subscribers: [] as Array<Record<string, any>>,
  campaigns: [] as Array<Record<string, any>>,
  userId: "",
}));

/* ── fake db: select/insert/update/delete over in-memory rows ──────── */

function collectEq(node: any, out: Record<string, unknown>): void {
  if (!node || typeof node !== "object") return;
  const chunks: any[] = Array.isArray(node.queryChunks) ? node.queryChunks : [];
  let pendingCol: string | null = null;
  for (const ch of chunks) {
    if (ch && typeof ch === "object") {
      if (typeof ch.name === "string" && ch.table) { pendingCol = ch.name; continue; }
      if (ch.constructor?.name === "Param" && pendingCol) { out[pendingCol] = ch.value; pendingCol = null; continue; }
      if (Array.isArray(ch.queryChunks)) collectEq(ch, out);
      if (Array.isArray(ch.value)) for (const v of ch.value) collectEq(v, out);
    }
  }
}
const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
function matches(row: Record<string, any>, cond: any): boolean {
  if (!cond) return true;
  const eqs: Record<string, unknown> = {};
  collectEq(cond, eqs);
  return Object.entries(eqs).every(([k, v]) => String(row[camel(k)] ?? row[k]) === String(v));
}
function tableRows(table: any): Array<Record<string, any>> {
  const g = globalThis as any;
  if (table === g.__emailListsTable) return h.lists;
  if (table === g.__emailCampaignsTable) return h.campaigns;
  return h.subscribers;
}
function fakeDb() {
  return {
    select: (fields?: Record<string, any>) => ({
      from: (table: any) => {
        let cond: any = null; let lim: number | null = null;
        const run = () => {
          let rows = tableRows(table).filter((r) => matches(r, cond));
          if (lim !== null) rows = rows.slice(0, lim);
          /* select({ value: count() }) — SQL count returns one row even
             when the filtered set is empty. */
          if (fields && "value" in fields) return [{ value: rows.length }];
          if (fields) rows = rows.map((r) => Object.fromEntries(Object.keys(fields).map((k) => [k, r[k]])));
          return rows;
        };
        const chain: any = {
          where: (c: any) => { cond = c; return chain; },
          orderBy: (..._a: any[]) => chain,
          limit: async (n: number) => { lim = n; return run(); },
          then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
        };
        return chain;
      },
    }),
    insert: (table: any) => ({
      values: (v: Record<string, any>) => ({
        returning: async () => {
          const row = { id: randomUUID(), createdAt: new Date(), ...v };
          tableRows(table).push(row);
          return [row];
        },
      }),
    }),
    update: (table: any) => ({
      set: (v: Record<string, any>) => ({
        where: (cond: any) => ({
          returning: async () => {
            const hit = tableRows(table).filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, v);
            return hit;
          },
        }),
      }),
    }),
    delete: (table: any) => ({
      where: (cond: any) => ({
        returning: async (_fields?: any) => {
          const rows = tableRows(table);
          const hit = rows.filter((r) => matches(r, cond));
          for (const r of hit) rows.splice(rows.indexOf(r), 1);
          return hit.map((r) => ({ id: r.id }));
        },
      }),
    }),
  };
}

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = h.userId; req.userCredits = 100000; next(); },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  (globalThis as any).__emailListsTable = actual.emailListsTable;
  (globalThis as any).__emailCampaignsTable = actual.emailCampaignsTable;
  return { ...actual, db: fakeDb() };
});

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(() => { throw new Error("no ai in public-subscribe-door tests"); }),
  getTextModel: vi.fn(() => "gpt-6-sol"),
}));
vi.mock("../../../lib/rate-limit", () => ({ publicApiLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../../lib/logger", () => ({ logger: { error: () => {}, warn: () => {}, info: () => {} } }));
vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 100000),
  refundCredits: vi.fn(async () => 100000),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));
vi.mock("../../../lib/payment-record", () => ({ recordCreditUsage: vi.fn(async () => {}) }));
vi.mock("../../../lib/email-campaign-sender", () => ({ queueWelcomeSequence: vi.fn(async () => {}) }));

import emailListRouter from "../email-list";
import { stagingGate } from "../../../lib/staging-gate";
import { publicSubscribeCors, PUBLIC_SUBSCRIBE_PATH, PUBLIC_JOIN_ORIGIN } from "../../../lib/public-subscribe-door";

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const USER = randomUUID();
const GATE_PASSWORD = "door-test-gate-password";
const JOIN = PUBLIC_JOIN_ORIGIN;

beforeAll(async () => {
  process.env["STAGING_PASSWORD"] = GATE_PASSWORD;
  const app = express();
  /* app.ts order: door CORS (path-scoped) → global CORS → json → gate → /api. */
  app.use(PUBLIC_SUBSCRIBE_PATH, publicSubscribeCors);
  app.use(cors({
    origin: [
      "https://bowdownvisuals.com",
      "https://www.bowdownvisuals.com",
      "https://bow-down-visuals-staging.onrender.com",
      "capacitor://localhost",
      "http://localhost",
    ],
    credentials: true,
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(stagingGate);
  app.use("/api", emailListRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  delete process.env["STAGING_PASSWORD"];
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.userId = USER;
  h.lists = [{
    id: randomUUID(),
    userId: USER,
    name: "Bow Down Visuals — Launch List",
    handle: "bowdownvisuals",
    description: "The cheat code drops January 1. Get on the list.",
  }];
  h.subscribers = [];
  h.campaigns = [];
});

function subscribe(email: string, origin?: string) {
  return realFetch(`${baseUrl}/api/email-list/subscribe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ handle: "bowdownvisuals", email, source: "landing" }),
  });
}

describe("the door: subscribe POST from the join origin passes the wall", () => {
  it("(a) succeeds with NO gate cookie and carries ACAO for the join origin", async () => {
    const r = await subscribe("door-fan@example.com", JOIN);
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(JOIN);
    const json = (await r.json()) as any;
    expect(json.ok).toBe(true);
    expect(h.subscribers).toHaveLength(1);
    expect(h.subscribers[0]!["email"]).toBe("door-fan@example.com");
  });

  it("(a) duplicate subscribe keeps the existing contract (alreadySubscribed)", async () => {
    await subscribe("dupe@example.com", JOIN);
    const r = await subscribe("dupe@example.com", JOIN);
    expect(r.status).toBe(200);
    const json = (await r.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.alreadySubscribed).toBe(true);
    expect(h.subscribers).toHaveLength(1);
  });

  it("(a) invalid email keeps the existing 400 contract", async () => {
    const r = await subscribe("not-an-email", JOIN);
    expect(r.status).toBe(400);
    const json = (await r.json()) as any;
    expect(json.code).toBe("invalid_email");
    expect(h.subscribers).toHaveLength(0);
  });

  it("preflight from the join origin is answered with the door's headers", async () => {
    const r = await realFetch(`${baseUrl}/api/email-list/subscribe`, {
      method: "OPTIONS",
      headers: {
        Origin: JOIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(r.headers.get("access-control-allow-origin")).toBe(JOIN);
    expect(r.headers.get("access-control-allow-methods") ?? "").toContain("POST");
    expect((r.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain("content-type");
  });
});

describe("the walls still hold", () => {
  it("(b) a gated API route without the cookie still returns 401 staging_locked", async () => {
    const r = await realFetch(`${baseUrl}/api/email-list/join/bowdownvisuals`);
    expect(r.status).toBe(401);
    const json = (await r.json()) as any;
    expect(json.error).toBe("staging_locked");
  });

  it("(b) a gated page route without the cookie still returns the 401 wall", async () => {
    const r = await realFetch(`${baseUrl}/dashboard`);
    expect(r.status).toBe(401);
  });

  it("(c) preflight from a random origin gets NO allow-origin", async () => {
    const r = await realFetch(`${baseUrl}/api/email-list/subscribe`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("(c) preflight from the join origin to a DIFFERENT route gets NO allow-origin (no leak)", async () => {
    const r = await realFetch(`${baseUrl}/api/email-list/lists`, {
      method: "OPTIONS",
      headers: {
        Origin: JOIN,
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("(d) GET on the subscribe path is still gated — POST only", async () => {
    const r = await realFetch(`${baseUrl}/api/email-list/subscribe`, {
      headers: { Origin: JOIN },
    });
    expect(r.status).toBe(401);
    const json = (await r.json()) as any;
    expect(json.error).toBe("staging_locked");
  });
});

describe("source contracts", () => {
  it("app.ts mounts the door CORS on the subscribe path BEFORE the global CORS", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../../app.ts"), "utf8");
    const doorIdx = src.indexOf("app.use(PUBLIC_SUBSCRIBE_PATH, publicSubscribeCors)");
    const globalIdx = src.indexOf("app.use(cors({");
    expect(doorIdx).toBeGreaterThan(-1);
    expect(globalIdx).toBeGreaterThan(doorIdx);
    /* The global allowlist did NOT gain the join origin — the door is scoped. */
    const globalBlock = src.slice(globalIdx, src.indexOf("}));", globalIdx));
    expect(globalBlock).not.toContain("join.bowdownvisuals.com");
  });

  it("the gate exemption is exactly the door's method+path check", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../../lib/staging-gate.ts"), "utf8");
    expect(src).toContain("isPublicSubscribePost(req)");
  });

  it("the subscribe route still applies its rate limiter", () => {
    const src = fs.readFileSync(path.join(__dirname, "../email-list.ts"), "utf8");
    expect(src).toContain('"/email-list/subscribe", publicApiLimiter');
  });
});
