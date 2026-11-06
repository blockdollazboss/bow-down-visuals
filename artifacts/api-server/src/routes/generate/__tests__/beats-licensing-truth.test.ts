/**
 * Beats licensing truth (stack1100 Lane X4): the machinery must keep
 * the words the sale is made in. Fake-db style mirrors
 * beats-payments.test.ts: REAL router + REAL table objects, fake db
 * chains, Stripe faked at the lib/stripe-checkout boundary.
 *
 * Convictions pinned here:
 *  C1 — an exclusive sale closes the WHOLE market: every offer (fixed
 *       tiers + custom templates) 409s at purchase and lists
 *       unavailable on the offers shelf. The exclusive buyer's plain
 *       words: "once you buy it, the producer stops selling this beat".
 *  C2 — verify's dangling-flag release: a REFUNDED rival exclusive is
 *       terminal, not a live rival — it must not block the release.
 *  C3 — the producer dashboard's headline numbers read COMPLETED
 *       sales only (pending + refunded rows stay in the sales list,
 *       out of the totals).
 *  C4 — stems (migration 0304): listed/PATCHed by the producer,
 *       masked on public reads, delivered ONLY on a completed license
 *       whose sold terms_snapshot carries a stems format.
 *  C5 — GET /licenses/mine names the beat (beatTitle) on every row.
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
  let lim = Number.POSITIVE_INFINITY;
  let off = 0;
  const chain: any = {
    where: (c: unknown) => {
      cond = c;
      return chain;
    },
    orderBy: (..._a: unknown[]) => chain,
    /* limit/offset record and stay chainable (the browse handler
       chains .limit().offset()); awaiting the chain resolves the
       sliced rows. */
    limit: (n: number) => {
      lim = n;
      return chain;
    },
    offset: (n: number) => {
      off = n;
      return chain;
    },
    then: (resolve: (v: unknown) => void) =>
      resolve(matchRows(table, cond).slice(off, off + lim).map((r) => ({ ...r }))),
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
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
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
const BUYER2 = randomUUID();
const STEMS = "https://cdn.example.com/stems-pack.zip";

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

function seedTemplate(overrides: Record<string, any> = {}): Record<string, any> {
  const tpl = {
    id: randomUUID(),
    producer_id: PRODUCER,
    name: "Unlimited Lease",
    price_cents: 19999,
    is_exclusive: false,
    format: "mp3",
    streams_cap: null,
    sales_cap: null,
    music_videos_cap: null,
    radio_tv_allowed: false,
    live_performances_cap: null,
    term_years: null,
    territory: "Worldwide",
    credit_line: null,
    terms_note: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  h.stores.get("beat_license_templates")!.push(tpl);
  return tpl;
}

function seedLicense(overrides: Record<string, any> = {}): Record<string, any> {
  const lic = {
    id: randomUUID(),
    beat_id: randomUUID(),
    buyer_id: BUYER,
    producer_id: PRODUCER,
    tier: "basic",
    template_id: null,
    terms_snapshot: null,
    price_cents: 2999,
    commission_cents: 450,
    status: "pending_payment",
    stripe_session_id: null,
    terms_accepted_at: null,
    created_at: new Date(),
    ...overrides,
  };
  h.stores.get("beat_licenses")!.push(lic);
  return lic;
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

/** Buy + pay + verify in one go; returns the verify response. */
async function buyAndVerify(beatId: string, body: Record<string, any>, amountCents: number) {
  const start = await call("POST", `/beats/${beatId}/license`, body);
  expect(start.status).toBe(201);
  h.session = {
    id: start.data.sessionId,
    payment_status: "paid",
    amount_total: amountCents,
    metadata: {
      purchase_kind: "beat_license",
      license_id: start.data.license.id,
      beat_id: beatId,
      buyer_user_id: BUYER,
      tier: start.data.license.tier,
    },
  };
  return call("POST", "/beats/licenses/verify", { sessionId: start.data.sessionId });
}

describe("C1 — an exclusive sale closes the whole market", () => {
  it("every offer 409s on an exclusive-sold beat — tiers and templates alike", async () => {
    const beat = seedBeat({ exclusive_sold: true });
    const tpl = seedTemplate();
    const tplX = seedTemplate({ name: "One Only", is_exclusive: true, format: "ownership_stems" });

    for (const body of [{ tier: "basic" }, { tier: "premium" }, { tier: "exclusive" }, { templateId: tpl.id }, { templateId: tplX.id }]) {
      const r = await call("POST", `/beats/${beat.id}/license`, body);
      expect(r.status, JSON.stringify(body)).toBe(409);
      expect(r.data.error).toContain("no longer for sale");
    }
    /* No checkout was ever opened for a closed market. */
    expect(h.checkoutCalls).toHaveLength(0);
    expect(h.stores.get("beat_licenses")).toHaveLength(0);
  });

  it("the offers shelf lists every offer unavailable once the beat is sold", async () => {
    const beat = seedBeat({ exclusive_sold: true });
    seedTemplate();
    const r = await call("GET", `/beats/${beat.id}/offers`);
    expect(r.status).toBe(200);
    expect(r.data.offers.length).toBeGreaterThanOrEqual(4);
    for (const o of r.data.offers) expect(o.available, o.name).toBe(false);
  });

  it("control: an unsold beat sells and lists normally", async () => {
    /* Stems on file, so the stems guard (ruling #2) leaves every
       offer available — this control pins the unsold shelf, not the
       guard (the guard's own cases live in beats-plain-offers). */
    const beat = seedBeat({ stems_url: STEMS });
    seedTemplate();
    const offers = await call("GET", `/beats/${beat.id}/offers`);
    for (const o of offers.data.offers) expect(o.available, o.name).toBe(true);
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "basic" });
    expect(start.status).toBe(201);
  });
});

describe("C2 — verify's dangling-flag release ignores refunded rivals", () => {
  function seedDangling(rivalStatus: string) {
    const beat = seedBeat({ exclusive_sold: true });
    seedLicense({
      beat_id: beat.id,
      buyer_id: BUYER2,
      tier: "exclusive",
      price_cents: 49999,
      commission_cents: 7500,
      status: rivalStatus,
      stripe_session_id: "cs_rival",
    });
    const mine = seedLicense({
      beat_id: beat.id,
      buyer_id: BUYER,
      tier: "exclusive",
      price_cents: 49999,
      commission_cents: 7500,
      status: "pending_payment",
      stripe_session_id: "cs_mine",
    });
    h.session = {
      id: "cs_mine",
      payment_status: "paid",
      amount_total: 49999,
      metadata: { purchase_kind: "beat_license", license_id: mine.id, beat_id: beat.id, buyer_user_id: BUYER, tier: "exclusive" },
    };
    return { beat, mine };
  }

  it("a refunded rival does not block the release — the paid buyer completes", async () => {
    const { mine } = seedDangling("refunded");
    const v = await call("POST", "/beats/licenses/verify", { sessionId: "cs_mine" });
    expect(v.status).toBe(200);
    expect(v.data.license.status).toBe("completed");
    expect(h.stores.get("beat_licenses")!.find((l) => l.id === mine.id)!.status).toBe("completed");
    expect(h.stores.get("beats")![0]!.exclusive_sold).toBe(true);
  });

  it("a still-pending rival keeps the 409", async () => {
    seedDangling("pending_payment");
    const v = await call("POST", "/beats/licenses/verify", { sessionId: "cs_mine" });
    expect(v.status).toBe(409);
  });
});

describe("C3 — producer dashboard totals read completed sales only", () => {
  it("pending and refunded rows stay in the list but out of the numbers", async () => {
    seedLicense({ status: "completed", price_cents: 10000, commission_cents: 1500 });
    seedLicense({ status: "pending_payment", price_cents: 5000, commission_cents: 750 });
    seedLicense({ status: "refunded", price_cents: 8000, commission_cents: 1200 });
    const r = await call("GET", "/beats/mine/dashboard", undefined, { "x-test-user": PRODUCER });
    expect(r.status).toBe(200);
    expect(r.data.sales).toHaveLength(3);
    expect(r.data.stats.saleCount).toBe(1);
    expect(r.data.stats.grossCents).toBe(10000);
    expect(r.data.stats.commissionCents).toBe(1500);
    expect(r.data.stats.netCents).toBe(8500);
  });
});

describe("C4 — stems: on file, masked in public, delivered by the sold terms", () => {
  it("listing stores the stems; public reads never see them", async () => {
    h.userId = PRODUCER;
    const created = await call("POST", "/beats", {
      title: "Stemmy",
      audioUrl: "https://cdn.example.com/stemmy.wav",
      stemsUrl: STEMS,
    });
    expect(created.status).toBe(201);
    expect(created.data.beat.stems_url).toBe(STEMS);
    const row = h.stores.get("beats")![0]!;
    expect(row.stems_url).toBe(STEMS);

    const browse = await call("GET", "/beats");
    expect(browse.data.beats[0].stems_url).toBeNull();
    expect(browse.data.beats[0].stems_path).toBeNull();
    const detail = await call("GET", `/beats/${row.id}`);
    expect(detail.data.beat.stems_url).toBeNull();
    expect(detail.data.beat.stems_path).toBeNull();
  });

  it("an exclusive license delivers the stems at verify and in the library", async () => {
    const beat = seedBeat({ stems_url: STEMS });
    const v = await buyAndVerify(beat.id, { tier: "exclusive" }, 49999);
    expect(v.status).toBe(200);
    expect(v.data.downloadUrl).toBe(beat.audio_url);
    expect(v.data.stemsUrl).toBe(STEMS);

    const mine = await call("GET", "/beats/licenses/mine");
    expect(mine.data.licenses).toHaveLength(1);
    expect(mine.data.licenses[0].stemsUrl).toBe(STEMS);
    expect(mine.data.licenses[0].downloadUrl).toBe(beat.audio_url);
  });

  it("premium (no stems in its terms) delivers no stems on the same beat", async () => {
    const beat = seedBeat({ stems_url: STEMS });
    const v = await buyAndVerify(beat.id, { tier: "premium" }, 9999);
    expect(v.status).toBe(200);
    expect(v.data.stemsUrl).toBeNull();
  });

  it("exclusive on a beat with NO stems on file is refused at creation (ruling #2 supersedes the old delivers-null sale)", async () => {
    /* Stack1400 ruling #2: a stems-format sale with nothing to
       deliver must not happen at all — the rail 409s up front
       instead of completing a sale whose stemsUrl comes back null.
       No license row, no checkout. */
    const beat = seedBeat();
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "exclusive" });
    expect(start.status).toBe(409);
    expect(start.data.error).toContain("no stems on file");
    expect(h.stores.get("beat_licenses")).toHaveLength(0);
    expect(h.checkoutCalls).toHaveLength(0);
  });

  it("a wav_mp3_stems template license delivers the stems", async () => {
    const beat = seedBeat({ stems_url: STEMS });
    const tpl = seedTemplate({ name: "Stems Lease", format: "wav_mp3_stems", price_cents: 19999 });
    const v = await buyAndVerify(beat.id, { templateId: tpl.id }, 19999);
    expect(v.status).toBe(200);
    expect(v.data.stemsUrl).toBe(STEMS);
  });

  it("the snapshot decides: a completed stems license sold BEFORE the stems were added (a pre-guard sale) gets them once on file", async () => {
    /* Since ruling #2 the purchase rail refuses a new stems sale on
       a no-stems beat, so this row is seeded directly — it stands
       for sales completed before the guard existed. Delivery still
       reads the sold snapshot + the beat's CURRENT stems file: null
       while nothing is on file, the stems once the producer adds
       them (PATCH remediation). */
    const beat = seedBeat();
    seedLicense({
      beat_id: beat.id,
      tier: "exclusive",
      status: "completed",
      price_cents: 49999,
      terms_snapshot: {
        name: "Exclusive", format: "ownership_stems", streamsCap: null, salesCap: null,
        musicVideosCap: null, radioTvAllowed: true, livePerformancesCap: null,
        termYears: null, territory: "Worldwide", creditLine: null, termsNote: null,
        isExclusive: true,
      },
    });
    const before = await call("GET", "/beats/licenses/mine");
    expect(before.data.licenses[0].stemsUrl).toBeNull();
    const patched = await call("PATCH", `/beats/${beat.id}`, { stemsUrl: STEMS }, { "x-test-user": PRODUCER });
    expect(patched.status).toBe(200);
    const mine = await call("GET", "/beats/licenses/mine");
    expect(mine.data.licenses[0].stemsUrl).toBe(STEMS);
  });

  it("a pending stems license carries no stemsUrl in the library", async () => {
    const beat = seedBeat({ stems_url: STEMS });
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "exclusive" });
    expect(start.status).toBe(201);
    const mine = await call("GET", "/beats/licenses/mine");
    expect(mine.data.licenses[0].status).toBe("pending_payment");
    expect(mine.data.licenses[0].stemsUrl).toBeNull();
    expect(mine.data.licenses[0].downloadUrl).toBeNull();
  });
});

describe("C5 — the library names the beat", () => {
  it("licenses/mine rows carry beatTitle for pending and completed rows alike", async () => {
    const beat = seedBeat({ title: "Named Beat" });
    seedLicense({ beat_id: beat.id, status: "pending_payment" });
    const done = await buyAndVerify(beat.id, { tier: "basic" }, 2999);
    expect(done.status).toBe(200);
    const mine = await call("GET", "/beats/licenses/mine");
    expect(mine.data.licenses).toHaveLength(2);
    for (const l of mine.data.licenses) expect(l.beatTitle).toBe("Named Beat");
  });
});
