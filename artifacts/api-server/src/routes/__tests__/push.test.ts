/**
 * Push tests (routes/push + lib/push):
 *   GET    /api/push/config          honest configured/unconfigured
 *   POST   /api/push/subscriptions   register + endpoint re-register
 *   DELETE /api/push/subscriptions   removes only your own rows
 *   sendPushToUser with no VAPID keys → logged no-op, never a fake send
 *   deliverPushToSubscriptions prunes dead (410) endpoints
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const USER = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";

const h = vi.hoisted(() => ({ subs: [] as Array<Record<string, unknown>>, seq: 0 }));

const dialect = new PgDialect();
function parseEq(cond: unknown): Array<[string, unknown]> {
  const q = dialect.sqlToQuery(cond as never);
  const out: Array<[string, unknown]> = [];
  for (const m of q.sql.matchAll(/"(\w+)" = \$(\d+)/g)) out.push([m[1], q.params[Number(m[2]) - 1]]);
  return out;
}
function matches(row: Record<string, unknown>, cond: unknown): boolean {
  return parseEq(cond).every(([col, val]) => String(row[col] ?? "") === String(val ?? ""));
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = user;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h;
  const db = {
    select: () => ({
      from: () => {
        let cond: unknown;
        let limitN: number | null = null;
        const run = () => {
          let rows = state.subs.filter((r) => (cond ? matches(r, cond) : true));
          if (limitN !== null) rows = rows.slice(0, limitN);
          return rows.map((r) => ({ ...r }));
        };
        const self: any = {
          where: (c: unknown) => {
            cond = c;
            return self;
          },
          limit: (n: number) => {
            limitN = n;
            return self;
          },
          then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
        };
        return self;
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        const row = { id: `sub-${++state.seq}`, created_at: new Date(), updated_at: new Date(), ...values };
        state.subs.push(row);
        return { returning: async () => [{ ...row }] };
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (cond: unknown) => {
          for (const row of state.subs) if (matches(row, cond)) Object.assign(row, patch);
          return [];
        },
      }),
    }),
    delete: () => ({
      where: async (cond: unknown) => {
        state.subs = state.subs.filter((r) => !matches(r, cond));
        return [];
      },
    }),
  };
  return { ...actual, db };
});

import router from "../push";
import { sendPushToUser, deliverPushToSubscriptions } from "../../lib/push";

let server: Server;
let base = "";

async function req(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(opts.user ? { "x-test-user": opts.user } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

beforeAll(async () => {
  delete process.env["VAPID_PUBLIC_KEY"];
  delete process.env["VAPID_PRIVATE_KEY"];
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  h.subs = [];
  h.seq = 0;
});

const SUB = { endpoint: "https://push.example.com/sub-1", keys: { p256dh: "pk-1", auth: "auth-1" } };

describe("push subscriptions", () => {
  it("config is honestly unconfigured when VAPID keys are unset", async () => {
    const { status, json } = await req("GET", "/api/push/config");
    expect(status).toBe(200);
    expect(json).toEqual({ configured: false, publicKey: null });
  });

  it("registers a subscription, and re-registering the same endpoint updates it in place", async () => {
    const first = await req("POST", "/api/push/subscriptions", { user: USER, body: SUB });
    expect(first.status).toBe(201);
    const again = await req("POST", "/api/push/subscriptions", {
      user: OTHER,
      body: { endpoint: SUB.endpoint, keys: { p256dh: "pk-2", auth: "auth-2" } },
    });
    expect(again.status).toBe(200);
    expect(h.subs).toHaveLength(1);
    expect(h.subs[0]).toMatchObject({ user_id: OTHER, p256dh: "pk-2" });
  });

  it("requires auth and a well-formed subscription", async () => {
    expect((await req("POST", "/api/push/subscriptions", { body: SUB })).status).toBe(401);
    expect((await req("POST", "/api/push/subscriptions", { user: USER, body: { endpoint: "nope" } })).status).toBe(400);
  });

  it("unsubscribe removes only the caller's own row", async () => {
    await req("POST", "/api/push/subscriptions", { user: USER, body: SUB });
    const byOther = await req("DELETE", "/api/push/subscriptions", { user: OTHER, body: { endpoint: SUB.endpoint } });
    expect(byOther.status).toBe(200);
    expect(h.subs).toHaveLength(1);
    await req("DELETE", "/api/push/subscriptions", { user: USER, body: { endpoint: SUB.endpoint } });
    expect(h.subs).toHaveLength(0);
  });
});

describe("push delivery honesty", () => {
  it("sendPushToUser no-ops with vapid_unset when keys are missing — never a fake send", async () => {
    const result = await sendPushToUser(USER, { title: "t", body: "b", link: "/live/x", kind: "live" }, {});
    expect(result).toEqual({ sent: 0, pruned: 0, failed: 0, skippedReason: "vapid_unset" });
  });

  it("deliverPushToSubscriptions prunes 410 endpoints and counts real sends", async () => {
    const subs = [
      { id: "s1", user_id: USER, endpoint: "https://push.example.com/a", p256dh: "k", auth: "a", created_at: new Date(), updated_at: new Date() },
      { id: "s2", user_id: USER, endpoint: "https://push.example.com/b", p256dh: "k", auth: "a", created_at: new Date(), updated_at: new Date() },
    ] as any[];
    const pruned: string[] = [];
    const result = await deliverPushToSubscriptions(
      subs,
      { title: "t", body: "b", link: "/live/x", kind: "live" },
      async (sub) => {
        if (sub.endpoint.endsWith("/b")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      },
      async (sub) => {
        pruned.push(sub.id);
      },
    );
    expect(result.sent).toBe(1);
    expect(result.pruned).toBe(1);
    expect(pruned).toEqual(["s2"]);
  });
});
