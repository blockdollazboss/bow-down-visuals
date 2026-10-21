/**
 * Producer-custom beat license templates (migration 0188).
 *
 * Covers: template CRUD owner-scoping + validation, purchase under a
 * template (producer price, untouched 15% commission), the terms
 * SNAPSHOT taken at purchase (later template edits AND deletion never
 * rewrite a sold license), cross-producer template refusal, exclusive
 * templates riding the same claim machinery as the fixed exclusive
 * tier, and the fixed tiers' default terms snapshots.
 *
 * Fake-db style mirrors beats-payments.test.ts: REAL router + REAL
 * table objects, fake db chains filtered on rendered equality params;
 * Stripe faked at the lib/stripe-checkout boundary.
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

import router from "../beats";

const PRODUCER = randomUUID();
const OTHER_PRODUCER = randomUUID();
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
    ["beat_license_templates", []],
  ]);
  h.checkoutCalls = [];
  h.session = null;
  h.sessionSeq = 0;
  h.refundCalls = [];
  h.userId = BUYER;
});

async function call(method: string, path: string, body?: unknown, asUser?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (asUser) headers["x-test-user"] = asUser;
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

const TEMPLATE_BODY = {
  name: "Sync Special",
  priceCents: 15000,
  format: "wav_mp3",
  streamsCap: 250000,
  salesCap: 5000,
  musicVideosCap: 3,
  radioTvAllowed: true,
  livePerformancesCap: 10,
  termYears: 3,
  territory: "Worldwide",
  creditLine: "Prod. by Midnight",
  termsNote: "One featured artist verse swap allowed.",
};

async function createTemplate(asUser = PRODUCER, body: Record<string, unknown> = TEMPLATE_BODY) {
  return call("POST", "/beats/license-templates", body, asUser);
}

describe("license template CRUD", () => {
  it("creates a template and lists it only for its producer", async () => {
    const created = await createTemplate();
    expect(created.status).toBe(201);
    expect(created.data.template.name).toBe("Sync Special");
    expect(created.data.template.priceCents).toBe(15000);
    expect(created.data.template.streamsCap).toBe(250000);
    expect(created.data.template.producerId).toBe(PRODUCER);

    const mine = await call("GET", "/beats/license-templates/mine", undefined, PRODUCER);
    expect(mine.data.templates).toHaveLength(1);
    const strangers = await call("GET", "/beats/license-templates/mine", undefined, OTHER_PRODUCER);
    expect(strangers.data.templates).toHaveLength(0);
  });

  it("rejects invalid template payloads", async () => {
    const badPrice = await createTemplate(PRODUCER, { ...TEMPLATE_BODY, priceCents: -5 });
    expect(badPrice.status).toBe(400);
    const badCap = await createTemplate(PRODUCER, { ...TEMPLATE_BODY, streamsCap: -1 });
    expect(badCap.status).toBe(400);
    const badTerm = await createTemplate(PRODUCER, { ...TEMPLATE_BODY, termYears: 0 });
    expect(badTerm.status).toBe(400);
    expect(h.stores.get("beat_license_templates")).toHaveLength(0);
  });

  it("owner-scopes patch and delete; unknown ids 404", async () => {
    const created = await createTemplate();
    const id = created.data.template.id as string;

    const strangerPatch = await call("PATCH", `/beats/license-templates/${id}`, { priceCents: 1 }, OTHER_PRODUCER);
    expect(strangerPatch.status).toBe(403);
    const strangerDelete = await call("DELETE", `/beats/license-templates/${id}`, undefined, OTHER_PRODUCER);
    expect(strangerDelete.status).toBe(403);

    const missing = await call("PATCH", `/beats/license-templates/${randomUUID()}`, { priceCents: 1 }, PRODUCER);
    expect(missing.status).toBe(404);

    /* A patch touches only the fields it names — caps stay as created. */
    const patched = await call("PATCH", `/beats/license-templates/${id}`, { priceCents: 18000 }, PRODUCER);
    expect(patched.status).toBe(200);
    expect(patched.data.template.priceCents).toBe(18000);
    expect(patched.data.template.streamsCap).toBe(250000);
    expect(patched.data.template.isExclusive).toBe(false);

    const deleted = await call("DELETE", `/beats/license-templates/${id}`, undefined, PRODUCER);
    expect(deleted.status).toBe(200);
    const mine = await call("GET", "/beats/license-templates/mine", undefined, PRODUCER);
    expect(mine.data.templates).toHaveLength(0);
  });

  it("attaches a producer's templates to their beats for buyers", async () => {
    const beat = seedBeat();
    await createTemplate();
    const detail = await call("GET", `/beats/${beat.id}`);
    expect(detail.data.beat.license_templates).toHaveLength(1);
    expect(detail.data.beat.license_templates[0].name).toBe("Sync Special");
    expect(detail.data.beat.license_templates[0].priceCents).toBe(15000);
  });
});

describe("purchase under a custom template", () => {
  it("charges the producer's price with untouched 15% commission and snapshots the terms", async () => {
    const beat = seedBeat();
    const created = await createTemplate();
    const templateId = created.data.template.id as string;

    const start = await call("POST", `/beats/${beat.id}/license`, { templateId });
    expect(start.status).toBe(201);
    expect(start.data.license.tier).toBe("custom");
    expect(start.data.license.templateId).toBe(templateId);
    expect(start.data.license.priceCents).toBe(15000);
    expect(start.data.license.commissionCents).toBe(2250); // 15% of 15000
    expect(h.checkoutCalls[0]!.amountCents).toBe(15000);
    expect(start.data.license.terms).toMatchObject({
      name: "Sync Special",
      format: "wav_mp3",
      streamsCap: 250000,
      salesCap: 5000,
      musicVideosCap: 3,
      radioTvAllowed: true,
      termYears: 3,
      creditLine: "Prod. by Midnight",
      isExclusive: false,
    });

    /* The producer rewrites the template AFTER the sale… */
    await call("PATCH", `/beats/license-templates/${templateId}`, {
      name: "Changed Terms",
      priceCents: 999999,
      streamsCap: 1,
    }, PRODUCER);

    /* …and the sold license still shows the terms as sold. */
    const mine = await call("GET", "/beats/licenses/mine");
    expect(mine.data.licenses).toHaveLength(1);
    expect(mine.data.licenses[0].priceCents).toBe(15000);
    expect(mine.data.licenses[0].terms.name).toBe("Sync Special");
    expect(mine.data.licenses[0].terms.streamsCap).toBe(250000);

    /* Verify completes against the ORIGINAL price, snapshot intact. */
    h.session = {
      id: start.data.sessionId,
      payment_status: "paid",
      amount_total: 15000,
      metadata: {
        purchase_kind: "beat_license",
        license_id: start.data.license.id,
        beat_id: beat.id,
        buyer_user_id: BUYER,
        tier: "custom",
        template_id: templateId,
      },
    };
    const v = await call("POST", "/beats/licenses/verify", { sessionId: start.data.sessionId });
    expect(v.status).toBe(200);
    expect(v.data.license.status).toBe("completed");
    expect(v.data.license.terms.streamsCap).toBe(250000);

    /* Deleting the template never rewrites the sold license either. */
    await call("DELETE", `/beats/license-templates/${templateId}`, undefined, PRODUCER);
    const mineAfter = await call("GET", "/beats/licenses/mine");
    expect(mineAfter.data.licenses[0].terms.name).toBe("Sync Special");
    expect(mineAfter.data.licenses[0].terms.streamsCap).toBe(250000);

    /* And the deleted template can no longer be bought. */
    const rebuy = await call("POST", `/beats/${beat.id}/license`, { templateId });
    expect(rebuy.status).toBe(404);
  });

  it("refuses another producer's template on this beat", async () => {
    const beat = seedBeat();
    const foreign = await createTemplate(OTHER_PRODUCER);
    const start = await call("POST", `/beats/${beat.id}/license`, { templateId: foreign.data.template.id });
    expect(start.status).toBe(400);
    expect(h.stores.get("beat_licenses")).toHaveLength(0);
    expect(h.checkoutCalls).toHaveLength(0);
  });

  it("requires exactly one of tier / templateId", async () => {
    const beat = seedBeat();
    const created = await createTemplate();
    const both = await call("POST", `/beats/${beat.id}/license`, { tier: "basic", templateId: created.data.template.id });
    expect(both.status).toBe(400);
    const neither = await call("POST", `/beats/${beat.id}/license`, {});
    expect(neither.status).toBe(400);
    expect(h.stores.get("beat_licenses")).toHaveLength(0);
  });

  it("an exclusive template sells once, through the same claim as the fixed tier", async () => {
    const beat = seedBeat();
    const created = await createTemplate(PRODUCER, { ...TEMPLATE_BODY, name: "Full Buyout", isExclusive: true, priceCents: 80000 });
    const templateId = created.data.template.id as string;

    const start = await call("POST", `/beats/${beat.id}/license`, { templateId });
    expect(start.status).toBe(201);
    expect(start.data.license.tier).toBe("exclusive");
    expect(start.data.license.terms.isExclusive).toBe(true);

    h.session = {
      id: start.data.sessionId,
      payment_status: "paid",
      amount_total: 80000,
      metadata: {
        purchase_kind: "beat_license",
        license_id: start.data.license.id,
        beat_id: beat.id,
        buyer_user_id: BUYER,
        tier: "exclusive",
        template_id: templateId,
      },
    };
    const v = await call("POST", "/beats/licenses/verify", { sessionId: start.data.sessionId });
    expect(v.data.license.status).toBe("completed");
    expect(h.stores.get("beats")![0]!.exclusive_sold).toBe(true);

    /* A second exclusive — template or fixed tier — is refused. */
    const secondTemplate = await call("POST", `/beats/${beat.id}/license`, { templateId });
    expect(secondTemplate.status).toBe(409);
    const fixedExclusive = await call("POST", `/beats/${beat.id}/license`, { tier: "exclusive" });
    expect(fixedExclusive.status).toBe(409);
  });
});

describe("fixed tiers after templates exist", () => {
  it("a fixed-tier purchase snapshots the tier's standing terms and no template", async () => {
    const beat = seedBeat();
    await createTemplate();
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "basic" });
    expect(start.status).toBe(201);
    expect(start.data.license.tier).toBe("basic");
    expect(start.data.license.templateId).toBeNull();
    expect(start.data.license.priceCents).toBe(2999);
    expect(start.data.license.terms).toMatchObject({
      name: "Basic",
      format: "mp3",
      streamsCap: 50000,
      musicVideosCap: 1,
      isExclusive: false,
    });
  });

  it("producers still can't license their own beat, by tier or template", async () => {
    const beat = seedBeat();
    const created = await createTemplate();
    const byTier = await call("POST", `/beats/${beat.id}/license`, { tier: "basic" }, PRODUCER);
    expect(byTier.status).toBe(400);
    const byTemplate = await call("POST", `/beats/${beat.id}/license`, { templateId: created.data.template.id }, PRODUCER);
    expect(byTemplate.status).toBe(400);
    expect(h.stores.get("beat_licenses")).toHaveLength(0);
  });
});
