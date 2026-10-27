/**
 * One-tap beat leases (Stack-200 upgrade N11) — the plain-words shelf
 * and the acceptance record, over the REAL beats router with the
 * house fake-db pattern (mirrors beats-payments.test.ts scaffolding;
 * Stripe is faked at the lib/stripe-checkout boundary).
 *
 * Pins:
 *  - GET /beats/:id/offers serves every priced tier + the producer's
 *    templates, each with plain-words sections rendered from the SAME
 *    terms object the purchase snapshots — the words are the deal;
 *  - an exclusive already sold is listed but unavailable;
 *  - POST /beats/:id/license with plainTermsAgreed stamps
 *    terms_accepted_at on the license row (the durable record);
 *  - without the flag the row keeps terms_accepted_at null — the
 *    legacy purchase path is untouched;
 *  - GET /beats/licenses/mine returns the stamp + the plain words of
 *    the sold snapshot.
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
    req.userId = h.userId;
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
  retrieveCheckoutSession: vi.fn(async () => null),
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

function seedTemplate(overrides: Record<string, any> = {}): Record<string, any> {
  const t = {
    id: randomUUID(),
    producer_id: PRODUCER,
    name: "Unlimited Lease",
    price_cents: 19999,
    is_exclusive: false,
    format: "wav_mp3_stems",
    streams_cap: null,
    sales_cap: 1000,
    music_videos_cap: null,
    radio_tv_allowed: true,
    live_performances_cap: null,
    term_years: null,
    territory: "Worldwide",
    credit_line: "Prod. by Midnight",
    terms_note: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  h.stores.get("beat_license_templates")!.push(t);
  return t;
}

beforeEach(() => {
  h.stores = new Map([
    ["beats", []],
    ["beat_licenses", []],
    ["beat_license_templates", []],
  ]);
  h.checkoutCalls = [];
  h.sessionSeq = 0;
  h.userId = BUYER;
});

async function call(method: string, path: string, body?: unknown) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

const flatLines = (offer: any) => (offer.plainWords as any[]).flatMap((s) => s.lines as string[]);

describe("one-tap beat leases (N11)", () => {
  it("the offers shelf renders every priced tier + template in plain words", async () => {
    const beat = seedBeat();
    seedTemplate();
    const r = await call("GET", `/beats/${beat.id}/offers`);
    expect(r.status).toBe(200);
    const offers = r.json.offers as any[];
    expect(offers.map((o) => o.name)).toEqual(["Basic", "Premium", "Exclusive", "Unlimited Lease"]);

    const basic = offers[0];
    expect(basic.kind).toBe("tier");
    expect(basic.priceCents).toBe(2999);
    expect(basic.available).toBe(true);
    expect(flatLines(basic)).toContain("Up to 50,000 streams of your song.");
    expect(flatLines(basic)).toContain("Radio and TV play is NOT covered by this license.");
    expect(basic.plainText).toContain("Basic license — in plain words:");

    const custom = offers[3];
    expect(custom.kind).toBe("template");
    expect(custom.priceCents).toBe(19999);
    expect(flatLines(custom)).toContain("Unlimited streams of your song.");
    expect(flatLines(custom)).toContain("Up to 1,000 copies or downloads sold.");
    expect(flatLines(custom)).toContain('Use this credit line wherever the song appears: "Prod. by Midnight"');
  });

  it("a sold exclusive is listed but unavailable; an unknown beat 404s", async () => {
    const beat = seedBeat({ exclusive_sold: true });
    const r = await call("GET", `/beats/${beat.id}/offers`);
    const exclusive = (r.json.offers as any[]).find((o) => o.tier === "exclusive");
    expect(exclusive.available).toBe(false);
    const missing = await call("GET", `/beats/${randomUUID()}/offers`);
    expect(missing.status).toBe(404);
  });

  it("the one tap stamps terms_accepted_at on the license row", async () => {
    const beat = seedBeat();
    const r = await call("POST", `/beats/${beat.id}/license`, { tier: "basic", plainTermsAgreed: true });
    expect(r.status).toBe(201);
    expect(r.json.license.termsAcceptedAt).toBeTruthy();
    expect(r.json.license.plainWords).toBeTruthy();
    const rows = h.stores.get("beat_licenses")!;
    expect(rows.length).toBe(1);
    expect(rows[0]!.terms_accepted_at).toBeInstanceOf(Date);
    expect(rows[0]!.terms_snapshot.streamsCap).toBe(50_000);
    expect(h.checkoutCalls.length).toBe(1);
  });

  it("without the tap the purchase is unchanged — no acceptance stamp", async () => {
    const beat = seedBeat();
    const r = await call("POST", `/beats/${beat.id}/license`, { tier: "premium" });
    expect(r.status).toBe(201);
    expect(r.json.license.termsAcceptedAt).toBeNull();
    expect(h.stores.get("beat_licenses")![0]!.terms_accepted_at).toBeNull();
  });

  it("the buyer's library returns the stamp and the agreed words", async () => {
    const beat = seedBeat();
    await call("POST", `/beats/${beat.id}/license`, { tier: "basic", plainTermsAgreed: true });
    const r = await call("GET", "/beats/licenses/mine");
    expect(r.status).toBe(200);
    const lic = (r.json.licenses as any[])[0];
    expect(lic.termsAcceptedAt).toBeTruthy();
    const lines = (lic.plainWords as any[]).flatMap((s) => s.lines as string[]);
    expect(lines).toContain("Up to 50,000 streams of your song.");
  });
});
