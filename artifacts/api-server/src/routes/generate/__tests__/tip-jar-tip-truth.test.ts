/**
 * TIP-TRUTH (stack1200) — the three defects the Gate #5 staging run
 * proved live on Nov 1 (stack1100 build), reproduced against the
 * tip-jar router:
 *
 *  1. TOTALS LIE — a fan paid a $5.00 tip; the payment confirmed and
 *     the jar summary showed $5.00 · 1 PAID, yet the creator's
 *     /tips dashboard ("Tip jar totals") still read $0.00 TIPPED,
 *     0 TIPS, "No tips yet". Cause proven in the lane report: the
 *     dashboard read ONLY the in-memory intent map; the durable
 *     paid rows in tip_jar_tips were never read there.
 *  2. NO CREATOR NOTIFICATION — the paid tip generated no bell/push
 *     for the creator. Tips now ride the one notification door
 *     (job_notifications exactly-once claim + notifyUserEvent),
 *     fired from the paid transition itself, so the verify path,
 *     the webhook settle path, and any replays all land it once.
 *  3. (API half) A tip must be able to settle WITHOUT the fan's
 *     browser returning — settleTipBySessionId is the settle the
 *     Stripe webhook drives (see lib/__tests__/
 *     stripe-webhook-tip-jar.test.ts for the webhook half).
 *
 * The fake db below models the status filter faithfully (the older
 * tip suites' fakes matched rows by key only); assertions about
 * totals are therefore about the router's read paths, not the fake.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";

const OWNER_ID = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  tips: [] as Array<Record<string, any>>,
  stripePaid: true,
  sessionSeq: 0,
  claims: [] as Array<Record<string, any>>,
  claimKeys: new Set<string>(),
  pushes: [] as Array<Record<string, any>>,
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { tipJarTipsTable, creatorProfilesTable } = actual;

  function selectRows(table: unknown, cond: unknown): Array<Record<string, any>> {
    if (table === creatorProfilesTable) return [];
    if (table !== tipJarTipsTable) return [];
    if (cond === undefined) return [...h.tips];
    const { params } = render(cond);
    /* Page-scoped reads carry the owner id among the params; key
       lookups (session id / tip id) match exactly one row. A status
       param on a page-scoped read is a real filter. */
    const pageScoped = h.tips.filter((r) => params.includes(r.page_user_id));
    let rows =
      pageScoped.length > 0
        ? pageScoped
        : h.tips.filter((r) => params.includes(r.stripe_session_id) || params.includes(r.id));
    if (pageScoped.length > 0) {
      if (params.includes("paid")) rows = rows.filter((r) => r.status === "paid");
      else if (params.includes("pending_payment")) rows = rows.filter((r) => r.status === "pending_payment");
    }
    return rows;
  }

  function applyUpdate(table: unknown, patch: Record<string, any>, cond: unknown) {
    if (table !== tipJarTipsTable) return [];
    const { params } = render(cond);
    const row = h.tips.find((r) => params.includes(r.id) || params.includes(r.stripe_session_id));
    if (!row) return [];
    const statusGuard = params.find((p) => p === "pending_payment");
    if (statusGuard && row.status !== statusGuard) return [];
    Object.assign(row, patch);
    return [row];
  }

  const fakeDb: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const rows = () => selectRows(table, cond);
          return {
            limit: async () => rows(),
            orderBy: () => ({ limit: async () => rows() }),
            then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
          };
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, any>) => ({
        returning: async () => {
          const row = {
            id: randomUUID(),
            stripe_session_id: null,
            paid_at: null,
            created_at: new Date(),
            ...v,
          };
          h.tips.push(row);
          return [row];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, any>) => ({
        where: (cond: unknown) => ({
          returning: async () => applyUpdate(table, patch, cond),
          then: (res: any, rej: any) => Promise.resolve(applyUpdate(table, patch, cond)).then(res, rej),
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: async (cond: unknown) => {
        const { params } = render(cond);
        h.tips = h.tips.filter((r) => !params.includes(r.id));
      },
    }),
  };
  return { ...actual, db: fakeDb };
});

vi.mock("stripe", () => ({
  default: class FakeStripe {
    checkout = {
      sessions: {
        create: async () => {
          h.sessionSeq += 1;
          return {
            id: `cs_tip_${h.sessionSeq}`,
            url: `https://checkout.example/tip/${h.sessionSeq}`,
            client_secret: `cs_tip_${h.sessionSeq}_secret`,
          };
        },
        retrieve: async (id: string) => ({
          id,
          payment_status: h.stripePaid ? "paid" : "unpaid",
          metadata: { type: "tip_jar" },
        }),
      },
    };
  },
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = OWNER_ID;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

/* The notification door: the claim is exactly-once per
   (jobType, jobId); the push fires only behind a landed claim. */
vi.mock("../../../lib/job-notifications", () => ({
  createJobNotification: async (input: Record<string, any>) => {
    const key = `${input["jobType"]}:${input["jobId"]}`;
    if (h.claimKeys.has(key)) return false;
    h.claimKeys.add(key);
    h.claims.push(input);
    return true;
  },
}));

vi.mock("../../../lib/push-events", () => ({
  notifyUserEvent: async (input: Record<string, any>) => {
    h.pushes.push(input);
    return { bellLanded: true, push: null, pushSkippedReason: null };
  },
}));

import router, { __resetTipJarStores, settleTipBySessionId } from "../tip-jar";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

beforeEach(async () => {
  h.tips = [];
  h.stripePaid = true;
  h.sessionSeq = 0;
  h.claims = [];
  h.claimKeys = new Set();
  h.pushes = [];
  __resetTipJarStores();
  const { status } = await call("POST", "/tips/settings", {
    handle: "royal-voice",
    displayName: "Royal Voice",
    message: "Thanks for the love!",
    suggestedAmounts: [5, 10, 25],
  });
  expect(status).toBe(200);
});

async function call(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

/** Drive one tip through checkout + the fan's return-verify. */
async function payTip(amount: number, fanName = "Big Fan", message = "Love the show!") {
  const co = await call("POST", "/tips/royal-voice/checkout", { amount, fanName, message });
  expect(co.status).toBe(200);
  const sessionId = h.tips[0]!.stripe_session_id as string;
  const verify = await call("POST", "/tips/checkout/verify", { sessionId });
  expect(verify.json?.status).toBe("paid");
  return { tipId: h.tips[0]!.id as string, sessionId };
}

describe("tip truth — dashboard totals read the paid rows (defect 1)", () => {
  it("a verified paid tip lands in the totals and the recent-tips feed", async () => {
    await payTip(5, "Big Fan", "Love the show!");

    const { status, json } = await call("GET", "/tips/dashboard");
    expect(status).toBe(200);
    expect(json.total).toBe(5);
    expect(json.count).toBe(1);
    expect(json.average).toBe(5);
    expect(json.feed).toHaveLength(1);
    expect(json.feed[0]).toMatchObject({
      amount: 5,
      fanName: "Big Fan",
      message: "Love the show!",
      status: "paid",
    });
  });

  it("totals count paid money only; pending intents stay visible in the feed as intent", async () => {
    /* A recorded intent is NOT money — it must not inflate totals. */
    const intent = await call("POST", "/tips/royal-voice/tip", {
      amount: 10,
      fanName: "Window Shopper",
      message: "",
    });
    expect(intent.status).toBe(201);

    await payTip(5);
    /* Make the paid tip unambiguously the newest feed entry. */
    h.tips[0]!.paid_at = new Date(Date.now() + 60_000);

    const { json } = await call("GET", "/tips/dashboard");
    expect(json.total).toBe(5);
    expect(json.count).toBe(1);
    expect(json.average).toBe(5);
    expect(json.feed).toHaveLength(2);
    expect(json.feed[0].status).toBe("paid");
    expect(json.feed[1]).toMatchObject({ status: "pending_payment", amount: 10 });
  });

  it("an unpaid session never reaches the totals", async () => {
    await call("POST", "/tips/royal-voice/checkout", { amount: 5, fanName: "Fan", message: "" });
    h.stripePaid = false;
    const verify = await call("POST", "/tips/checkout/verify", { sessionId: "cs_tip_1" });
    expect(verify.json.paid).toBe(false);

    const { json } = await call("GET", "/tips/dashboard");
    expect(json.total).toBe(0);
    expect(json.count).toBe(0);
    expect(json.feed).toHaveLength(0);
  });
});

describe("tip truth — the creator is told, exactly once (defect 2)", () => {
  it("verify fires one claim + one gated push with honest no-fee copy", async () => {
    const { tipId } = await payTip(5, "Big Fan", "");

    expect(h.claims).toHaveLength(1);
    expect(h.claims[0]).toMatchObject({
      jobType: "sale",
      jobId: `tip:${tipId}`,
      userId: OWNER_ID,
      status: "completed",
    });
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0]).toMatchObject({
      userId: OWNER_ID,
      category: "money",
      kind: "tip_received",
      link: "/tips",
    });
    const body = String(h.pushes[0]!["body"] ?? "");
    expect(body).toContain("$5.00");
    expect(body).toContain("Big Fan");
    expect(body.toLowerCase()).toContain("no platform fee");
  });

  it("replays never double-tell: verify again + settle again stay at one", async () => {
    const { sessionId } = await payTip(5);
    expect(h.claims).toHaveLength(1);
    expect(h.pushes).toHaveLength(1);

    const again = await call("POST", "/tips/checkout/verify", { sessionId });
    expect(again.json.status).toBe("paid");
    const settled = await settleTipBySessionId(sessionId);
    expect(settled.status).toBe("paid");

    expect(h.claims).toHaveLength(1);
    expect(h.pushes).toHaveLength(1);
    const { json } = await call("GET", "/tips/dashboard");
    expect(json.count).toBe(1);
    expect(json.total).toBe(5);
  });

  it("an unpaid tip tells nobody", async () => {
    await call("POST", "/tips/royal-voice/checkout", { amount: 5, fanName: "Fan", message: "" });
    h.stripePaid = false;
    await call("POST", "/tips/checkout/verify", { sessionId: "cs_tip_1" });
    const settled = await settleTipBySessionId("cs_tip_1");
    expect(settled.status).toBe("pending_payment");
    expect(h.claims).toHaveLength(0);
    expect(h.pushes).toHaveLength(0);
  });
});

describe("tip truth — settle without the fan's return (defect 1, webhook path)", () => {
  it("settleTipBySessionId flips the tip paid, counts it, and tells the creator once", async () => {
    const co = await call("POST", "/tips/royal-voice/checkout", {
      amount: 25,
      fanName: "Quiet Closer",
      message: "",
    });
    expect(co.status).toBe(200);
    const sessionId = h.tips[0]!.stripe_session_id as string;
    /* The fan closed the tab: no verify call ever happens. The
       webhook's settle is the only completion path. */
    const settled = await settleTipBySessionId(sessionId);
    expect(settled).toMatchObject({ found: true, status: "paid", transitioned: true });
    expect(h.tips[0]!.status).toBe("paid");
    expect(h.tips[0]!.paid_at).toBeInstanceOf(Date);

    const { json } = await call("GET", "/tips/dashboard");
    expect(json.total).toBe(25);
    expect(json.count).toBe(1);
    expect(h.claims).toHaveLength(1);
    expect(h.pushes).toHaveLength(1);
  });

  it("settle on an unknown session reports not found and tells nobody", async () => {
    const settled = await settleTipBySessionId("cs_nope");
    expect(settled).toMatchObject({ found: false });
    expect(h.claims).toHaveLength(0);
    expect(h.pushes).toHaveLength(0);
  });
});
