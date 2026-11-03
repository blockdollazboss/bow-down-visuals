/**
 * Stack1400 ruling #23 (H-1) — beats UNDELIVERABLE files.
 *
 * A buyer must never be left paid-for-nothing: (1) redelivery first
 * (producer supplies the missing master/stems through PATCH), (2)
 * auto-refund through the existing refundCheckoutSessionPayment
 * helper — exactly once — when the file is still undeliverable past
 * the 7-day delivery window (mirrors DUNNING_GRACE_DAYS).
 * Undeliverable is stored state only: master audio_url/audio_path
 * empty; stems-format terms with stems_url/stems_path empty.
 *
 * Harness mirrors beats-failure-paths.test.ts: REAL router + REAL
 * table objects, fake db chains filtered on rendered equality
 * params, Stripe faked at the lib/stripe-checkout boundary. Aging a
 * license = rewriting its stored created_at, the window's anchor.
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
  checkoutFails: false,
  session: null as any,
  sessionsById: null as Map<string, any> | null,
  sessionSeq: 0,
  refundCalls: [] as Array<unknown>,
  refundResult: true,
  creditCharges: [] as Array<unknown[]>,
  aiCalls: 0,
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

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.headers["x-test-user"] ?? h.userId;
    if (req.headers["x-test-credits"] !== undefined) {
      req.userCredits = Number(req.headers["x-test-credits"]);
    }
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  generationLimiter: (_req: any, _res: any, next: any) => next(),
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async (...args: unknown[]) => {
    h.creditCharges.push(args);
    return 900;
  }),
  refundCredits: vi.fn(async () => 0),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(() => ({
    chat: {
      completions: {
        create: async () => {
          h.aiCalls += 1;
          return {
            choices: [
              { message: { content: JSON.stringify({ genre: "trap", moodTags: ["dark", "hard"] }) } },
            ],
          };
        },
      },
    },
  })),
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
    if (h.checkoutFails) throw new Error("stripe unavailable");
    h.checkoutCalls.push(input);
    h.sessionSeq += 1;
    return { sessionId: `cs_test_${h.sessionSeq}`, url: "https://checkout.example.com/pay" };
  }),
  retrieveCheckoutSession: vi.fn(async (id: string) => h.sessionsById?.get(id) ?? h.session),
  refundCheckoutSessionPayment: vi.fn(async (session: unknown) => {
    h.refundCalls.push(session);
    return h.refundResult;
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

import router from "../beats";

const PRODUCER = randomUUID();
const BUYER = randomUUID();
const BUYER2 = randomUUID();

let server: ReturnType<typeof express.application.listen>;
let baseUrl = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
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
    stems_url: null,
    stems_path: null,
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
  h.stores.get("beats")!.push(beat);
  return beat;
}

beforeEach(() => {
  h.stores = new Map([
    ["beats", []],
    ["beat_licenses", []],
    ["beat_license_templates", []],
  ]);
  h.checkoutCalls = [];
  h.checkoutFails = false;
  h.session = null;
  h.sessionsById = null;
  h.sessionSeq = 0;
  h.refundCalls = [];
  h.refundResult = true;
  h.creditCharges = [];
  h.aiCalls = 0;
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

function paidSession(start: any, beatId: string, tier: string, amount: number, buyer = BUYER) {
  return {
    id: start.data.sessionId,
    payment_status: "paid",
    amount_total: amount,
    metadata: {
      purchase_kind: "beat_license",
      license_id: start.data.license.id,
      beat_id: beatId,
      buyer_user_id: buyer,
      tier,
    },
  };
}

async function producerStats() {
  const r = await call("GET", "/beats/mine/dashboard", undefined, { "x-test-user": PRODUCER });
  expect(r.status).toBe(200);
  return r.data.stats;
}

const DAY_MS = 24 * 3600 * 1000;

function ageLicense(licenseId: string, days: number) {
  const row = h.stores.get("beat_licenses")!.find((l) => l.id === licenseId)!;
  row.created_at = new Date(Date.now() - days * DAY_MS);
  return row;
}

async function buyAndVerify(beat: Record<string, any>, tier: string, amount: number) {
  const start = await call("POST", `/beats/${beat.id}/license`, { tier });
  expect(start.status).toBe(201);
  h.session = paidSession(start, beat.id, tier, amount);
  const v = await call("POST", "/beats/licenses/verify", { sessionId: start.data.sessionId });
  return { start, v };
}

async function mineLicenses() {
  const mine = await call("GET", "/beats/licenses/mine");
  expect(mine.status).toBe(200);
  return mine.data.licenses;
}

describe("ruling #23 — undeliverable beat files: redelivery first, auto-refund after the window", () => {
  it("1. a dead-master purchase completes as AWAITING delivery — never delivered with a dead download", async () => {
    const beat = seedBeat({ audio_url: "", audio_path: null });
    const { v } = await buyAndVerify(beat, "premium", 9999);
    expect(v.status).toBe(200);
    expect(v.data.license.status).toBe("completed");
    expect(v.data.downloadUrl).toBeNull();
    expect(v.data.deliveryState).toBe("awaiting_delivery");
    expect(v.data.missingDelivery).toEqual(["master"]);
    /* The deadline is exactly the 7-day window from creation. */
    const lic = h.stores.get("beat_licenses")![0]!;
    expect(new Date(v.data.deliveryDeadline).getTime() - new Date(lic.created_at).getTime())
      .toBe(7 * DAY_MS);
    expect(h.refundCalls).toHaveLength(0);

    const [mine] = await mineLicenses();
    expect(mine.downloadUrl).toBeNull();
    expect(mine.deliveryState).toBe("awaiting_delivery");
    expect(mine.missingDelivery).toEqual(["master"]);
    expect(mine.deliveryMessage).toContain("Waiting on the producer");
    expect(h.refundCalls).toHaveLength(0);

    /* The producer's sales list names the obligation + deadline. */
    const dash = await call("GET", "/beats/mine/dashboard", undefined, { "x-test-user": PRODUCER });
    expect(dash.data.sales[0].deliveryState).toBe("awaiting_delivery");
    expect(dash.data.sales[0].missingDelivery).toEqual(["master"]);
    expect(dash.data.sales[0].deliveryDeadline).toBe(v.data.deliveryDeadline);
  });

  it("2. master redelivery heals the license: producer PATCHes audioUrl and the buyer gets the file", async () => {
    const beat = seedBeat({ audio_url: "", audio_path: null });
    const { v } = await buyAndVerify(beat, "premium", 9999);
    expect(v.data.deliveryState).toBe("awaiting_delivery");

    /* Only the producer can supply the file. */
    const stranger = await call("PATCH", `/beats/${beat.id}`, { audioUrl: "https://cdn.example.com/nope.mp3" }, { "x-test-user": BUYER2 });
    expect(stranger.status).toBe(403);

    const patched = await call("PATCH", `/beats/${beat.id}`, { audioUrl: "https://cdn.example.com/fixed-master.mp3" }, { "x-test-user": PRODUCER });
    expect(patched.status).toBe(200);
    expect(h.stores.get("beats")![0]!.audio_url).toBe("https://cdn.example.com/fixed-master.mp3");

    const [mine] = await mineLicenses();
    expect(mine.deliveryState).toBe("delivered");
    expect(mine.downloadUrl).toBe("https://cdn.example.com/fixed-master.mp3");
    expect(mine.missingDelivery).toEqual([]);
    expect(h.refundCalls).toHaveLength(0);
  });

  it("3. stems-null follows the same path: awaiting, then the existing stems PATCH heals it", async () => {
    const beat = seedBeat({ stems_url: null, stems_path: null });
    const { v } = await buyAndVerify(beat, "exclusive", 49999);
    expect(v.status).toBe(200);
    /* The master IS deliverable and is handed over; the stems are
       what's owed, and the state says so. */
    expect(v.data.downloadUrl).toBe(beat.audio_url);
    expect(v.data.stemsUrl).toBeNull();
    expect(v.data.deliveryState).toBe("awaiting_delivery");
    expect(v.data.missingDelivery).toEqual(["stems"]);

    const patched = await call("PATCH", `/beats/${beat.id}`, { stemsUrl: "https://cdn.example.com/stems-pack.zip" }, { "x-test-user": PRODUCER });
    expect(patched.status).toBe(200);

    const [mine] = await mineLicenses();
    expect(mine.deliveryState).toBe("delivered");
    expect(mine.stemsUrl).toBe("https://cdn.example.com/stems-pack.zip");
    expect(h.refundCalls).toHaveLength(0);
  });

  it("4. window expiry auto-refunds a dead master exactly once — double evaluation = one refund", async () => {
    const beat = seedBeat({ audio_url: "", audio_path: null });
    const { start, v } = await buyAndVerify(beat, "premium", 9999);
    expect(v.data.deliveryState).toBe("awaiting_delivery");
    ageLicense(start.data.license.id, 8);

    const [first] = await mineLicenses();
    expect(first.status).toBe("refunded");
    expect(first.deliveryState).toBe("refunded");
    expect(first.downloadUrl).toBeNull();
    expect(first.deliveryMessage).toContain("refunded in full");
    expect(h.refundCalls).toHaveLength(1);
    expect(h.stores.get("beat_licenses")![0]!.status).toBe("refunded");
    /* The producer is no longer paid for the undelivered sale. */
    expect(await producerStats()).toMatchObject({ saleCount: 0, grossCents: 0, netCents: 0 });

    /* Second evaluation (library again + a replayed verify): the
       terminal status short-circuits — still exactly one refund. */
    const [second] = await mineLicenses();
    expect(second.status).toBe("refunded");
    const replay = await call("POST", "/beats/licenses/verify", { sessionId: start.data.sessionId });
    expect(replay.status).toBe(200);
    expect(replay.data.refunded).toBe(true);
    expect(h.refundCalls).toHaveLength(1);
  });

  it("5. window expiry auto-refunds missing stems exactly once, and releases the exclusive beat", async () => {
    const beat = seedBeat({ stems_url: null, stems_path: null });
    const { start, v } = await buyAndVerify(beat, "exclusive", 49999);
    expect(v.data.deliveryState).toBe("awaiting_delivery");
    expect(h.stores.get("beats")![0]!.exclusive_sold).toBe(true);
    ageLicense(start.data.license.id, 8);

    const [mine] = await mineLicenses();
    expect(mine.status).toBe("refunded");
    expect(mine.deliveryState).toBe("refunded");
    expect(h.refundCalls).toHaveLength(1);
    /* The refunded exclusive's claim on the beat dies with it. */
    expect(h.stores.get("beats")![0]!.exclusive_sold).toBe(false);

    await mineLicenses();
    expect(h.refundCalls).toHaveLength(1);
  });

  it("6. a paid session that settles only after the window lapsed is refunded at the settle, once", async () => {
    const beat = seedBeat({ audio_url: "", audio_path: null });
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "premium" });
    expect(start.status).toBe(201);
    ageLicense(start.data.license.id, 8);
    h.session = paidSession(start, beat.id, "premium", 9999);

    const v = await call("POST", "/beats/licenses/verify", { sessionId: start.data.sessionId });
    expect(v.status).toBe(409);
    expect(v.data.refunded).toBe(true);
    expect(v.data.error).toContain("refunded in full");
    expect(h.refundCalls).toHaveLength(1);
    expect(h.stores.get("beat_licenses")![0]!.status).toBe("refunded");

    const replay = await call("POST", "/beats/licenses/verify", { sessionId: start.data.sessionId });
    expect(replay.status).toBe(200);
    expect(replay.data.refunded).toBe(true);
    expect(h.refundCalls).toHaveLength(1);
  });

  it("7. a failed auto-refund at expiry is honest: no refund claimed, license not marked refunded", async () => {
    const beat = seedBeat({ audio_url: "", audio_path: null });
    const { start } = await buyAndVerify(beat, "premium", 9999);
    ageLicense(start.data.license.id, 8);
    h.refundResult = false;

    const [mine] = await mineLicenses();
    expect(mine.status).toBe("completed");
    expect(mine.deliveryState).toBe("awaiting_delivery");
    expect(mine.deliveryMessage).toContain("couldn't be refunded automatically");
    expect(mine.deliveryMessage).not.toContain("refunded in full");
    expect(h.stores.get("beat_licenses")![0]!.status).toBe("completed");
    expect(h.refundCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("8. healthy delivery is untouched: delivered state, real URLs, no deadline, no refund", async () => {
    const beat = seedBeat({ stems_url: "https://cdn.example.com/stems-pack.zip" });
    const { v } = await buyAndVerify(beat, "exclusive", 49999);
    expect(v.status).toBe(200);
    expect(v.data.deliveryState).toBe("delivered");
    expect(v.data.deliveryDeadline).toBeNull();
    expect(v.data.missingDelivery).toEqual([]);
    expect(v.data.downloadUrl).toBe(beat.audio_url);
    expect(v.data.stemsUrl).toBe("https://cdn.example.com/stems-pack.zip");

    const [mine] = await mineLicenses();
    expect(mine.deliveryState).toBe("delivered");
    expect(mine.downloadUrl).toBe(beat.audio_url);
    expect(mine.stemsUrl).toBe("https://cdn.example.com/stems-pack.zip");
    expect(h.refundCalls).toHaveLength(0);
  });
});
