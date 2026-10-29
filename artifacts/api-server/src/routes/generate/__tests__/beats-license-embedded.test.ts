/**
 * Beat license EMBEDDED checkout (World money-parity server lane):
 * POST /api/beats/:id/license passes uiMode through to
 * createPaymentCheckout; an embedded ask answers a clientSecret (no
 * hosted URL) so the World BeatsDesk mounts the payment form
 * in-panel, while the hosted answer stays exactly the legacy shape.
 * The EMBEDDED_CHECKOUT kill switch forces the hosted shape.
 *
 * Fake-db style mirrors beats-payments.test.ts: REAL router + REAL
 * table objects, fake db chains. Stripe is faked at the
 * lib/stripe-checkout boundary, following the helper's real contract:
 * embedded in → { sessionId, clientSecret }, hosted in →
 * { sessionId, url }.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
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
    if (input.uiMode === "embedded") {
      return { sessionId: `cs_test_${h.sessionSeq}`, clientSecret: `cs_test_${h.sessionSeq}_secret` };
    }
    return { sessionId: `cs_test_${h.sessionSeq}`, url: "https://checkout.example.com/pay" };
  }),
  retrieveCheckoutSession: vi.fn(async () => h.session),
  refundCheckoutSessionPayment: vi.fn(async () => true),
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
  ]);
  h.checkoutCalls = [];
  h.session = null;
  h.sessionSeq = 0;
  h.userId = BUYER;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

describe("beat license checkout presentation", () => {
  it("hosted (no uiMode): legacy answer — hosted URL, no clientSecret demanded", async () => {
    const beat = seedBeat();
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "basic" });
    expect(start.status).toBe(201);
    expect(start.data.checkoutUrl).toBe("https://checkout.example.com/pay");
    expect(start.data.clientSecret).toBeNull();
    expect(start.data.uiMode).toBe("hosted");
    expect(h.checkoutCalls).toHaveLength(1);
    expect(h.checkoutCalls[0]!.uiMode).toBeUndefined();
    expect(h.checkoutCalls[0]!.amountCents).toBe(2999);
    expect(h.stores.get("beat_licenses")![0]!.stripe_session_id).toBe(start.data.sessionId);
  });

  it("embedded: uiMode passes through; answer carries the clientSecret and no hosted URL", async () => {
    const beat = seedBeat();
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "premium", uiMode: "embedded" });
    expect(start.status).toBe(201);
    expect(start.data.clientSecret).toBe("cs_test_1_secret");
    expect(start.data.checkoutUrl).toBeNull();
    expect(start.data.uiMode).toBe("embedded");
    expect(start.data.paymentStatus).toBe("pending_payment");
    /* Same money, same metadata — only the presentation differs. */
    expect(h.checkoutCalls[0]!.uiMode).toBe("embedded");
    expect(h.checkoutCalls[0]!.amountCents).toBe(9999);
    expect(h.checkoutCalls[0]!.metadata).toMatchObject({
      purchase_kind: "beat_license",
      beat_id: beat.id,
      buyer_user_id: BUYER,
      tier: "premium",
    });
    expect(h.stores.get("beat_licenses")![0]!.stripe_session_id).toBe("cs_test_1");

    /* The success flow is unchanged: the same verify rail completes
       the license once the session reads paid. */
    h.session = {
      id: "cs_test_1",
      payment_status: "paid",
      amount_total: 9999,
      metadata: {
        purchase_kind: "beat_license",
        license_id: start.data.license.id,
        beat_id: beat.id,
        buyer_user_id: BUYER,
        tier: "premium",
      },
    };
    const v = await call("POST", "/beats/licenses/verify", { sessionId: "cs_test_1" });
    expect(v.status).toBe(200);
    expect(v.data.success).toBe(true);
    expect(v.data.license.status).toBe("completed");
    expect(v.data.downloadUrl).toBe("https://cdn.example.com/beat.mp3");
  });

  it("kill switch off: an embedded ask is answered with the hosted shape", async () => {
    vi.stubEnv("EMBEDDED_CHECKOUT", "off");
    const beat = seedBeat();
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "basic", uiMode: "embedded" });
    expect(start.status).toBe(201);
    expect(start.data.uiMode).toBe("hosted");
    expect(start.data.checkoutUrl).toBe("https://checkout.example.com/pay");
    expect(start.data.clientSecret).toBeNull();
    expect(h.checkoutCalls[0]!.uiMode).toBeUndefined();
  });

  it("refusal paths are unchanged: a producer still cannot license their own beat", async () => {
    const beat = seedBeat();
    h.userId = PRODUCER;
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "basic", uiMode: "embedded" });
    expect(start.status).toBe(400);
    expect(h.checkoutCalls).toHaveLength(0);
    expect(h.stores.get("beat_licenses")).toHaveLength(0);
  });
});
