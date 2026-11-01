/**
 * Shoutout fan-out (stack1100 Y3). Creator tells ride the door seam;
 * fan tells are email (a guest's only channel). Pins: free request →
 * creator told at create; priced request → creator told at the paid
 * flip, exactly once; delivered → fan emailed with the watch link,
 * once; declined → fan emailed with NO refund promise (this rail
 * fires no refund on a creator decline — see the lane report flag).
 * Fake-db idiom mirrors shoutouts-checkout.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const CREATOR_USER_ID = "11111111-1111-4111-8111-111111111111";
const SETTINGS_ID = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  settings: [] as Array<Record<string, any>>,
  requests: [] as Array<Record<string, any>>,
  stripePaid: true,
  sessionSeq: 0,
}));

function render(cond: unknown): { sql: string; params: unknown[] } {
  const { PgDialect } = require("drizzle-orm/pg-core");
  const q = new PgDialect().sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { shoutoutSettingsTable, shoutoutRequestsTable } = actual;

  function selectRows(table: unknown, cond: unknown): Array<Record<string, any>> {
    const { params } = render(cond);
    const key = String(params[0] ?? "");
    if (table === shoutoutSettingsTable) {
      return h.settings.filter((r) => r.id === key || r.user_id === key);
    }
    if (table === shoutoutRequestsTable) {
      return h.requests.filter((r) => r.id === key || r.creator_user_id === key);
    }
    return [];
  }

  function applyUpdate(table: unknown, patch: Record<string, any>, cond: unknown) {
    if (table !== shoutoutRequestsTable) return [];
    const { params } = render(cond);
    const id = String(params[0] ?? "");
    const row = h.requests.find((r) => r.id === id);
    if (!row) return [];
    const statusGuard = params.find((p) => typeof p === "string" && p === "pending_payment");
    if (statusGuard && row.status !== statusGuard) return [];
    Object.assign(row, patch);
    return [row];
  }

  const fakeDb: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const chain: any = {
            limit: async () => selectRows(table, cond),
            orderBy: () => ({ limit: async () => selectRows(table, cond) }),
            then: (res: any, rej: any) => Promise.resolve(selectRows(table, cond)).then(res, rej),
          };
          return chain;
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, any>) => ({
        returning: async () => {
          const row = {
            id: randomUUID(),
            delivery_url: null,
            stripe_session_id: null,
            paid_at: null,
            delivered_at: null,
            created_at: new Date(),
            updated_at: new Date(),
            ...v,
          };
          h.requests.push(row);
          return [row];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, any>) => ({
        where: (cond: unknown) => {
          const run = () => applyUpdate(table, patch, cond);
          return {
            returning: async () => run(),
            then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
          };
        },
      }),
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
          return { id: `cs_test_${h.sessionSeq}`, url: `https://checkout.example/${h.sessionSeq}` };
        },
        retrieve: async (id: string) => ({
          id,
          payment_status: h.stripePaid ? "paid" : "unpaid",
          metadata: { type: "shoutout_request" },
        }),
      },
    };
  },
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = CREATOR_USER_ID;
    req.userCredits = 0;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: vi.fn(() => "test-model"),
}));

vi.mock("../../../lib/objectStorage", () => ({
  normalizeToStorageRef: (v: string) => v,
  refreshSupabaseStorageUrl: async (v: string) => v,
}));

vi.mock("../../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: string) => v,
}));

import router, {
  __setShoutoutEventNotifier,
  __setShoutoutFanMailer,
  buildShoutoutDeclinedEmail,
  type ShoutoutFanEmail,
} from "../shoutouts";
import type { UserEventInput } from "../../../lib/push-events";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;
let events: UserEventInput[];
let mails: ShoutoutFanEmail[];

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
  __setShoutoutEventNotifier(null);
  __setShoutoutFanMailer(null);
  server.closeAllConnections?.();
  server.close();
});

function seedSettings(priceCents: number) {
  h.settings = [
    {
      id: SETTINGS_ID,
      user_id: CREATOR_USER_ID,
      display_name: "Royal Voice",
      price_cents: priceCents,
      turnaround_days: 3,
      guidelines: "",
      accepting: "true",
    },
  ];
}

beforeEach(() => {
  h.requests = [];
  h.stripePaid = true;
  h.sessionSeq = 0;
  events = [];
  mails = [];
  __setShoutoutEventNotifier(async (input) => {
    events.push(input);
  });
  __setShoutoutFanMailer(async (email) => {
    mails.push(email);
  });
});

async function call(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function createRequest() {
  const r = await call("POST", "/shoutouts/requests", {
    creatorId: SETTINGS_ID,
    fanName: "Jamie Fan",
    fanEmail: "jamie@example.com",
    occasion: "Birthday",
    message: "Say happy birthday to Alex!",
  });
  expect(r.status).toBe(201);
  return r.json.request.id as string;
}

describe("creator tells", () => {
  it("a free request tells the creator at create — once", async () => {
    seedSettings(0);
    await createRequest();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: CREATOR_USER_ID, kind: "shoutout_request", category: "money", link: "/shoutouts" });
    expect(events[0]!.body).toContain("Jamie Fan");
  });

  it("a priced request tells the creator at the paid flip — and the verify replay stays silent", async () => {
    seedSettings(2500);
    const id = await createRequest();
    expect(events).toHaveLength(0);

    const co = await call("POST", `/shoutouts/requests/${id}/checkout`);
    expect(co.status).toBe(200);
    const sessionId = h.requests[0]!["stripe_session_id"] as string;
    expect(sessionId).toBeTruthy();

    const v1 = await call("POST", `/shoutouts/requests/${id}/checkout/verify`, { sessionId });
    expect(v1.json.paid).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: CREATOR_USER_ID, kind: "shoutout_paid" });
    expect(events[0]!.body).toContain("$25.00");

    const v2 = await call("POST", `/shoutouts/requests/${id}/checkout/verify`, { sessionId });
    expect(v2.json.paid).toBe(true);
    expect(events).toHaveLength(1);
  });
});

describe("fan emails", () => {
  async function paidRequest() {
    seedSettings(2500);
    const id = await createRequest();
    await call("POST", `/shoutouts/requests/${id}/checkout`);
    const sessionId = h.requests[0]!["stripe_session_id"] as string;
    await call("POST", `/shoutouts/requests/${id}/checkout/verify`, { sessionId });
    events = [];
    return id;
  }

  it("delivered → the fan is emailed the watch link, once (a same-status URL fix does not re-mail)", async () => {
    const id = await paidRequest();
    const started = await call("PATCH", `/shoutouts/requests/${id}`, { status: "in_progress" });
    expect(started.status).toBe(200);
    expect(mails).toHaveLength(0);
    const p1 = await call("PATCH", `/shoutouts/requests/${id}`, { status: "delivered", deliveryUrl: "https://cdn.example.com/shoutout.mp4" });
    expect(p1.status).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe("jamie@example.com");
    expect(mails[0]!.subject).toContain("ready");
    expect(mails[0]!.html).toContain("https://cdn.example.com/shoutout.mp4");
    expect(mails[0]!.html).toContain("Royal Voice");

    const p2 = await call("PATCH", `/shoutouts/requests/${id}`, { status: "delivered", deliveryUrl: "https://cdn.example.com/shoutout-v2.mp4" });
    expect(p2.status).toBe(200);
    expect(mails).toHaveLength(1);
  });

  it("declined → the fan is emailed, and the copy never promises a refund", async () => {
    const id = await paidRequest();
    const p = await call("PATCH", `/shoutouts/requests/${id}`, { status: "declined" });
    expect(p.status).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe("jamie@example.com");
    expect(mails[0]!.html.toLowerCase()).not.toContain("refund");
  });

  it("the declined-email builder itself carries no refund language", () => {
    const mail = buildShoutoutDeclinedEmail({
      fanName: "Jamie Fan",
      fanEmail: "jamie@example.com",
      creatorName: "Royal Voice",
      occasion: "Birthday",
    });
    expect(mail.html.toLowerCase()).not.toContain("refund");
    expect(mail.html).toContain("Jamie Fan");
  });
});
