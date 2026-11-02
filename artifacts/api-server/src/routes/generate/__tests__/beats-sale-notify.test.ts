/**
 * beats-sale-notify.test.ts — notification-completeness census
 * (stack1200): a completed beat license sale must TELL the producer.
 *
 * THE GAP: POST /beats/licenses/verify flips the license to
 * "completed" — the sale lands, the producer's earnings start
 * counting it — and nobody tells the producer: no bell, no push, no
 * email. Every sibling sale finale (shop, digital store) tells the
 * seller through the one door with a job_notifications claim gating
 * exactly-once. This suite drives the REAL router over the
 * beats-payments fake-db harness: the completion tells the producer
 * exactly once (a duplicate verify stays silent), names the true
 * net (price − the row's own commission), and still lands the bell
 * when the producer's "money" push category is off (the door's
 * contract: a preference silences the ping, never the record).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

const dialect = new PgDialect();
function renderParams(cond: unknown): unknown[] {
  return dialect.sqlToQuery(cond as never).params as unknown[];
}
function renderSql(cond: unknown): string {
  return dialect.sqlToQuery(cond as never).sql;
}

const h = vi.hoisted(() => ({
  userId: "",
  stores: new Map<string, Array<Record<string, any>>>(),
  checkoutCalls: [] as Array<Record<string, any>>,
  session: null as any,
  sessionSeq: 0,
  refundCalls: [] as Array<unknown>,
  claims: new Map<string, Record<string, unknown>>(),
}));

function storeFor(table: unknown): Array<Record<string, any>> {
  const name = getTableName(table as never);
  if (!h.stores.has(name)) h.stores.set(name, []);
  return h.stores.get(name)!;
}

function matchRows(table: unknown, cond: unknown): Array<Record<string, any>> {
  const rows = storeFor(table);
  if (!cond) return [...rows];
  const sqlText = renderSql(cond);
  const params = renderParams(cond);
  const pairs: Array<[string, unknown]> = [];
  const re = /"(\w+)"\s*=\s*\$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sqlText)) !== null) pairs.push([m[1]!, params[Number(m[2]) - 1]]);
  if (pairs.length === 0) return [...rows];
  return rows.filter((r) => pairs.every(([col, val]) => r[col] === val));
}

function selectChain(table: unknown) {
  let cond: unknown;
  const chain: any = {
    where: (c: unknown) => {
      cond = c;
      return chain;
    },
    orderBy: (..._a: unknown[]) => chain,
    limit: async (n: number) => matchRows(table, cond).slice(0, n).map((r) => ({ ...r })),
    then: (resolve: (v: unknown) => void) => resolve(matchRows(table, cond).map((r) => ({ ...r }))),
  };
  return chain;
}

function buildFakeDb() {
  return {
    select: () => ({ from: (table: unknown) => selectChain(table) }),
    insert: (table: unknown) => ({
      values: (v: Record<string, any>) => {
        let inserted: Record<string, any> | null = null;
        const doInsert = () => {
          if (inserted) return inserted;
          inserted = {
            id: randomUUID(),
            created_at: new Date(),
            updated_at: new Date(),
            stripe_session_id: null,
            ...v,
          };
          storeFor(table).push(inserted);
          return inserted;
        };
        return {
          returning: async () => [{ ...doInsert() }],
          then: (resolve: (v: unknown) => void) => resolve([doInsert()]),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (v: Record<string, any>) => ({
        where: (cond: unknown) => {
          let done: Array<Record<string, any>> | null = null;
          const apply = () => {
            if (done) return done;
            done = matchRows(table, cond);
            for (const r of done) Object.assign(r, v);
            return done;
          };
          return {
            returning: async () => apply().map((r) => ({ ...r })),
            then: (resolve: (v: unknown) => void) => resolve(apply()),
          };
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (cond: unknown) => {
        const matched = new Set(matchRows(table, cond));
        const rows = storeFor(table);
        for (let i = rows.length - 1; i >= 0; i--) if (matched.has(rows[i]!)) rows.splice(i, 1);
      },
    }),
  };
}

/* The job_notifications claim db: emulate the INSERT … ON CONFLICT
   DO NOTHING … RETURNING semantics createJobNotification relies on
   (params in statement order: id, job_type, job_id, user_id,
   project_id, status, title, message, video_url). */
const fakeJobNotificationsDb = {
  execute: async (query: unknown) => {
    const params = renderParams(query);
    const [id, jobType, jobId, userId, projectId, status, title, message, videoUrl] = params;
    const key = `${jobType}:${jobId}`;
    if (h.claims.has(key)) return { rows: [] };
    const row = {
      id, job_type: jobType, job_id: jobId, user_id: userId, project_id: projectId,
      status, title, message, video_url: videoUrl,
      delivered_at: null, delivery_channel: null, delivery_attempts: 0, created_at: new Date(),
    };
    h.claims.set(key, row);
    return { rows: [row] };
  },
};

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.headers["x-test-user"] ?? h.userId;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  generationLimiter: (_req: any, _res: any, next: any) => next(),
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => 0),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: vi.fn(() => "gpt-test"),
}));

vi.mock("../../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async () => null),
}));

vi.mock("../../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (u: string) => u),
  isStorageRef: (u: string) => typeof u === "string" && (u.startsWith("r2://") || u.startsWith("supabase://")),
}));

vi.mock("../../../lib/stripe-checkout", () => ({
  createPaymentCheckout: vi.fn(async (input: Record<string, any>) => {
    h.checkoutCalls.push(input);
    h.sessionSeq += 1;
    return { sessionId: `cs_test_${h.sessionSeq}`, url: "https://checkout.example.com/pay" };
  }),
  retrieveCheckoutSession: vi.fn(async () => h.session),
  refundCheckoutSessionPayment: vi.fn(async (session: unknown) => {
    h.refundCalls.push(session);
    return true;
  }),
  checkoutBaseUrl: () => "https://example.com",
  isCheckoutTestMode: () => true,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return buildFakeDb();
    },
  };
});

import { beatsTable, beatLicensesTable, notificationsTable, pushNotificationPrefsTable } from "@workspace/db";
import router from "../beats";
import { __setJobNotificationsDb } from "../../../lib/job-notifications";

const PRODUCER = randomUUID();
const BUYER = randomUUID();

let server: ReturnType<typeof express.application.listen>;
let baseUrl = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  __setJobNotificationsDb(fakeJobNotificationsDb as never);
  const app = express();
  app.use(express.json());
  app.use(router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  __setJobNotificationsDb(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function seedBeat(overrides: Record<string, any> = {}): Record<string, any> {
  const beat = {
    id: randomUUID(),
    user_id: PRODUCER,
    title: "Midnight Loop",
    audio_url: "https://cdn.example.com/beat.mp3",
    audio_path: null,
    preview_url: null,
    genre: "trap",
    bpm: 140,
    musical_key: "C min",
    mood_tags: [],
    description: null,
    basic_price_cents: 2999,
    premium_price_cents: 9999,
    exclusive_price_cents: 49999,
    exclusive_sold: false,
    plays: 0,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  storeFor(beatsTable).push(beat);
  return beat;
}

beforeEach(() => {
  h.stores = new Map([
    ["beats", []],
    ["beat_licenses", []],
    ["notifications", []],
    ["push_notification_prefs", []],
    ["push_subscriptions", []],
  ]);
  h.claims = new Map();
  h.checkoutCalls = [];
  h.session = null;
  h.sessionSeq = 0;
  h.refundCalls = [];
  h.userId = BUYER;
});

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

async function buyAndVerify() {
  const beat = seedBeat();
  const start = await call("POST", `/beats/${beat.id}/license`, { tier: "premium" });
  expect(start.status).toBe(201);
  const licenseId = start.data.license.id as string;
  const sessionId = start.data.sessionId as string;
  h.session = {
    id: sessionId,
    payment_status: "paid",
    amount_total: 9999,
    metadata: { purchase_kind: "beat_license", license_id: licenseId, beat_id: beat.id, buyer_user_id: BUYER, tier: "premium" },
  };
  const v = await call("POST", "/beats/licenses/verify", { sessionId });
  expect(v.status).toBe(200);
  expect(v.data.success).toBe(true);
  return { beat, licenseId, sessionId };
}

describe("beat license sale — the producer hears it", () => {
  it("completion tells the producer exactly once, naming the true net", async () => {
    const { licenseId, sessionId } = await buyAndVerify();

    const claim = h.claims.get(`sale:beat-license:${licenseId}`);
    expect(claim).toBeDefined();
    expect(claim!["user_id"]).toBe(PRODUCER);

    const bells = storeFor(notificationsTable).filter((n) => (n["userId"] ?? n["user_id"]) === PRODUCER);
    expect(bells).toHaveLength(1);
    expect(bells[0]!["kind"]).toBe("beat_sale");
    const license = storeFor(beatLicensesTable).find((l) => l["id"] === licenseId)!;
    const net = ((license["priceCents"] ?? license["price_cents"]) - (license["commissionCents"] ?? license["commission_cents"])) / 100;
    expect(bells[0]!["body"]).toContain(`$${net.toFixed(2)}`);
    expect(bells[0]!["body"]).toContain("Midnight Loop");

    /* A duplicate verify completes nothing new and tells nothing new. */
    const v2 = await call("POST", "/beats/licenses/verify", { sessionId });
    expect(v2.data.duplicate).toBe(true);
    expect(h.claims.size).toBe(1);
    expect(storeFor(notificationsTable).filter((n) => (n["userId"] ?? n["user_id"]) === PRODUCER)).toHaveLength(1);
  });

  it("the bell still lands when the producer's money push category is off", async () => {
    storeFor(pushNotificationPrefsTable).push({
      user_id: PRODUCER,
      money_enabled: false,
      messages_enabled: true,
      live_enabled: true,
      mentions_enabled: true,
      social_enabled: false,
      updated_at: new Date(),
    });
    await buyAndVerify();
    const bells = storeFor(notificationsTable).filter((n) => (n["userId"] ?? n["user_id"]) === PRODUCER);
    expect(bells).toHaveLength(1);
    expect(bells[0]!["kind"]).toBe("beat_sale");
  });
});
