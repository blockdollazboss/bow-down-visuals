/**
 * Push preferences + event service tests (migration 0299 foundation):
 *   GET /api/push/preferences   defaults materialize with no row
 *   PUT /api/push/preferences   partial upsert, resolved map returned
 *   notifyUserEvent             bell always lands; push gated per category
 *   pushIfCategoryEnabled       the fan-out gate used by go-live alerts
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const USER = "00000000-0000-4000-8000-0000000000aa";

const h = vi.hoisted(() => ({
  prefs: [] as Array<Record<string, unknown>>,
  notifications: [] as Array<Record<string, unknown>>,
}));

const dialect = new PgDialect();
function parseEq(cond: unknown): Array<[string, unknown]> {
  const q = dialect.sqlToQuery(cond as never);
  const out: Array<[string, unknown]> = [];
  for (const m of q.sql.matchAll(/"(\w+)" = \$(\d+)/g)) out.push([m[1], q.params[Number(m[2]) - 1]]);
  return out;
}
function matches(row: Record<string, unknown>, cond: unknown): boolean {
  const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return parseEq(cond).every(
    ([col, val]) => String(row[col] ?? row[camel(col)] ?? "") === String(val ?? ""),
  );
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
  const { notificationsTable, pushNotificationPrefsTable } = actual;
  const tableOf = (t: unknown) =>
    t === notificationsTable ? "notifications" : t === pushNotificationPrefsTable ? "prefs" : "?";
  const rowsOf = (kind: string) => (kind === "notifications" ? h.notifications : h.prefs);

  const db = {
    select: () => ({
      from: (table: unknown) => {
        const kind = tableOf(table);
        let cond: unknown;
        let limitN: number | null = null;
        const run = () => {
          let rows = rowsOf(kind).filter((r) => (cond ? matches(r, cond) : true));
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
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const kind = tableOf(table);
        const self: any = {
          onConflictDoUpdate: (cfg: { set: Record<string, unknown> }) => {
            self.conflictSet = cfg.set;
            return self;
          },
          returning: async () => {
            if (kind === "prefs") {
              const existing = h.prefs.find((r) => r["userId"] === values["userId"]);
              if (existing) {
                Object.assign(existing, self.conflictSet ?? {});
                return [{ ...existing }];
              }
              const row = { ...values };
              h.prefs.push(row);
              return [{ ...row }];
            }
            return [];
          },
          then: (res: any, rej: any) => {
            if (kind === "notifications") {
              h.notifications.push({ id: `n-${h.notifications.length + 1}`, ...values });
            }
            return Promise.resolve([]).then(res, rej);
          },
        };
        return self;
      },
    }),
  };
  return { ...actual, db };
});

import router from "../push";
import {
  notifyUserEvent,
  pushIfCategoryEnabled,
  prefsFromRow,
  PUSH_CATEGORY_DEFAULTS,
  type NotifyDeps,
} from "../../lib/push-events";

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
  h.prefs = [];
  h.notifications = [];
});

describe("push preferences routes", () => {
  it("requires auth", async () => {
    expect((await req("GET", "/api/push/preferences")).status).toBe(401);
    expect((await req("PUT", "/api/push/preferences", { body: { money: false } })).status).toBe(401);
  });

  it("materializes the defaults when the user has no row", async () => {
    const { status, json } = await req("GET", "/api/push/preferences", { user: USER });
    expect(status).toBe(200);
    expect(json.preferences).toEqual({
      money: true,
      messages: true,
      live: true,
      mentions: true,
      social: false,
    });
  });

  it("upserts a partial change and returns the resolved map", async () => {
    const put = await req("PUT", "/api/push/preferences", { user: USER, body: { social: true } });
    expect(put.status).toBe(200);
    expect(put.json.preferences).toEqual({ ...PUSH_CATEGORY_DEFAULTS, social: true });
    expect(h.prefs).toHaveLength(1);

    const again = await req("PUT", "/api/push/preferences", { user: USER, body: { money: false } });
    expect(again.json.preferences).toEqual({ ...PUSH_CATEGORY_DEFAULTS, social: true, money: false });
    expect(h.prefs).toHaveLength(1);

    const get = await req("GET", "/api/push/preferences", { user: USER });
    expect(get.json.preferences).toEqual(again.json.preferences);
  });

  it("rejects non-boolean category values", async () => {
    const { status } = await req("PUT", "/api/push/preferences", { user: USER, body: { money: "yes" } });
    expect(status).toBe(400);
    expect(h.prefs).toHaveLength(0);
  });
});

describe("prefsFromRow", () => {
  it("returns the defaults for no row and honors stored switches", () => {
    expect(prefsFromRow(undefined)).toEqual(PUSH_CATEGORY_DEFAULTS);
    expect(
      prefsFromRow({
        userId: USER,
        moneyEnabled: false,
        messagesEnabled: true,
        liveEnabled: true,
        mentionsEnabled: false,
        socialEnabled: true,
        updatedAt: new Date(),
      } as any),
    ).toEqual({ money: false, messages: true, live: true, mentions: false, social: true });
  });
});

describe("notifyUserEvent", () => {
  function fakeDeps(prefs: Record<string, boolean>) {
    const calls: { bell: unknown[]; push: unknown[] } = { bell: [], push: [] };
    const deps: NotifyDeps = {
      getPrefs: async () => prefs as any,
      insertBell: async (input) => {
        calls.bell.push(input);
      },
      sendPush: async (userId, payload) => {
        calls.push.push({ userId, payload });
        return { sent: 2, pruned: 0, failed: 0, skippedReason: null };
      },
    };
    return { deps, calls };
  }

  const sale = {
    userId: USER,
    category: "money" as const,
    kind: "sale",
    title: "You just got paid 👑",
    body: "“Track” just sold for $5.00",
    link: "/store/dashboard",
  };

  it("lands the bell and pings devices when the category is on", async () => {
    const { deps, calls } = fakeDeps({ ...PUSH_CATEGORY_DEFAULTS });
    const result = await notifyUserEvent(sale, deps);
    expect(result.bellLanded).toBe(true);
    expect(result.push).toEqual({ sent: 2, pruned: 0, failed: 0, skippedReason: null });
    expect(result.pushSkippedReason).toBeNull();
    expect(calls.bell).toHaveLength(1);
    expect(calls.push).toEqual([
      {
        userId: USER,
        payload: { title: sale.title, body: sale.body, link: sale.link, kind: "sale" },
      },
    ]);
  });

  it("lands the bell but never pings when the category is off", async () => {
    const { deps, calls } = fakeDeps({ ...PUSH_CATEGORY_DEFAULTS, money: false });
    const result = await notifyUserEvent(sale, deps);
    expect(result.bellLanded).toBe(true);
    expect(result.push).toBeNull();
    expect(result.pushSkippedReason).toBe("category_off");
    expect(calls.bell).toHaveLength(1);
    expect(calls.push).toHaveLength(0);
  });

  it("never throws when a leg fails", async () => {
    const deps: NotifyDeps = {
      getPrefs: async () => {
        throw new Error("db down");
      },
      insertBell: async () => {
        throw new Error("db down");
      },
      sendPush: async () => {
        throw new Error("push down");
      },
    };
    const result = await notifyUserEvent(sale, deps);
    expect(result.bellLanded).toBe(false);
    expect(result.push).toBeNull();
  });
});

describe("pushIfCategoryEnabled", () => {
  it("returns null when off and the send result when on", async () => {
    const payload = { title: "t", body: "b", link: "/live/x", kind: "live" };
    const off = await pushIfCategoryEnabled(USER, "live", payload, {
      getPrefs: async () => ({ ...PUSH_CATEGORY_DEFAULTS, live: false }),
      sendPush: async () => ({ sent: 1, pruned: 0, failed: 0, skippedReason: null }),
    });
    expect(off).toBeNull();
    const on = await pushIfCategoryEnabled(USER, "live", payload, {
      getPrefs: async () => ({ ...PUSH_CATEGORY_DEFAULTS }),
      sendPush: async () => ({ sent: 3, pruned: 0, failed: 0, skippedReason: null }),
    });
    expect(on?.sent).toBe(3);
  });
});
