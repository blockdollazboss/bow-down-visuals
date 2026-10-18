/**
 * Store name-your-price (0132): creators opt an item into PWYW with a
 * minimum; checkout accepts amount >= minimum on the existing store rail
 * and the charged amount is the fan's amount — displayed = charged.
 * Fixed-price items refuse client-supplied amounts outright.
 *
 * Harness mirrors store-refresh-links.test.ts: REAL store router, fake
 * db.execute dispatched on rendered SQL text, Stripe faked at the
 * `stripe` package boundary with create params recorded.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const VIEWER_ID = "00000000-0000-4000-8000-000000000099";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const TRACK_ID = "22222222-2222-4222-8222-222222222222";

const dialect = new PgDialect();

const h = vi.hoisted(() => ({
  state: {
    stripeCreateParams: null as any,
    row: null as Record<string, unknown> | null,
  },
}));

process.env["STRIPE_SECRET_KEY"] = "sk_test_fake_for_pwyw_route_tests";

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = VIEWER_ID;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
}));

vi.mock("../generate/storefronts", () => ({
  STOREFRONT_PLATFORM_FEE_BPS: 500,
}));

vi.mock("../../lib/job-notifications", () => ({
  createJobNotification: async () => undefined,
}));

vi.mock("../../lib/email", () => ({
  sendEmail: async () => undefined,
  emailShell: (_title: string, html: string) => html,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  escapeHtml: (s: string) => s,
  baseUrlForEmail: () => "https://example.com",
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

vi.mock("stripe", () => {
  class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: any) => {
          h.state.stripeCreateParams = params;
          return { id: "cs_test_pwyw", url: "https://checkout.example.com/cs_test_pwyw" };
        },
        retrieve: async () => {
          throw new Error("not used in this suite");
        },
      },
    };
  }
  return { default: FakeStripe };
});

function baseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TRACK_ID,
    profile_id: PROFILE_ID,
    title: "Golden Track",
    download_price_cents: 199,
    is_published: true,
    pwyw_enabled: false,
    pwyw_min_cents: 0,
    file_url: "https://cdn.example.com/track.mp3",
    artwork_url: null,
    artist_name: "Queen Creator",
    artist_slug: "queen-creator",
    ...overrides,
  };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fakeDb: any = {
    execute: async (q: unknown) => {
      const { sql: text } = dialect.sqlToQuery(q as never);
      if (text.includes("AS file_url")) return { rows: h.state.row ? [h.state.row] : [] };
      if (text.includes("SELECT id, slug FROM creator_profiles")) {
        return { rows: [{ id: PROFILE_ID, slug: "queen-creator" }] };
      }
      if (text.includes("UPDATE profile_tracks") || text.includes("UPDATE profile_videos")) {
        return {
          rows: [
            {
              id: TRACK_ID,
              title: "Golden Track",
              download_price_cents: 0,
              is_published: true,
              pwyw_enabled: true,
              pwyw_min_cents: 1000,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  return { ...actual, db: fakeDb };
});

import router, { resolveCheckoutAmountCents } from "../store";

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

beforeEach(() => {
  h.state.stripeCreateParams = null;
  h.state.row = baseRow();
});

async function call(method: string, path: string, body?: unknown) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

describe("resolveCheckoutAmountCents", () => {
  it("fixed items charge exactly the listed price and refuse other amounts", () => {
    const item = { priceCents: 199, pwywEnabled: false, pwywMinCents: 0 };
    expect(resolveCheckoutAmountCents(item)).toEqual({ ok: true, amountCents: 199 });
    expect(resolveCheckoutAmountCents(item, 199)).toEqual({ ok: true, amountCents: 199 });
    expect(resolveCheckoutAmountCents(item, 100).ok).toBe(false);
  });

  it("PWYW accepts any amount at or above the minimum", () => {
    const item = { priceCents: 0, pwywEnabled: true, pwywMinCents: 1000 };
    expect(resolveCheckoutAmountCents(item, 1000)).toEqual({ ok: true, amountCents: 1000 });
    expect(resolveCheckoutAmountCents(item, 5000)).toEqual({ ok: true, amountCents: 5000 });
    expect(resolveCheckoutAmountCents(item, 999).ok).toBe(false);
    expect(resolveCheckoutAmountCents(item, 0).ok).toBe(false);
  });
});

describe("store checkout with PWYW", () => {
  it("the item DTO exposes the PWYW minimum", async () => {
    h.state.row = baseRow({ download_price_cents: 0, pwyw_enabled: true, pwyw_min_cents: 1000 });
    const res = await call("GET", `/store/item/track/${TRACK_ID}`);
    expect(res.status).toBe(200);
    expect(res.data.item.pwyw).toEqual({ enabled: true, minCents: 1000, minPrice: "$10.00" });
  });

  it("checkout charges the fan's named amount, not the listed price", async () => {
    h.state.row = baseRow({ download_price_cents: 0, pwyw_enabled: true, pwyw_min_cents: 1000 });
    const res = await call("POST", "/store/checkout", { kind: "track", id: TRACK_ID, amountCents: 5000 });
    expect(res.status).toBe(200);
    expect(res.data.amountCents).toBe(5000);
    expect(h.state.stripeCreateParams.line_items[0].price_data.unit_amount).toBe(5000);
    /* Fee split follows the charged amount: 5% platform fee. */
    expect(h.state.stripeCreateParams.metadata.platform_fee_cents).toBe("250");
    expect(h.state.stripeCreateParams.metadata.creator_amount_cents).toBe("4750");
  });

  it("checkout below the minimum is refused before any session exists", async () => {
    h.state.row = baseRow({ download_price_cents: 0, pwyw_enabled: true, pwyw_min_cents: 1000 });
    const res = await call("POST", "/store/checkout", { kind: "track", id: TRACK_ID, amountCents: 500 });
    expect(res.status).toBe(400);
    expect(res.data.error).toBe("INVALID_AMOUNT");
    expect(h.state.stripeCreateParams).toBeNull();
  });

  it("a fixed-price item refuses a tampered amount", async () => {
    const res = await call("POST", "/store/checkout", { kind: "track", id: TRACK_ID, amountCents: 1 });
    expect(res.status).toBe(400);
    expect(h.state.stripeCreateParams).toBeNull();
  });

  it("enabling PWYW without a minimum is refused; with one it saves", async () => {
    const bad = await call("PATCH", "/store/price", { kind: "track", id: TRACK_ID, priceCents: 0, pwywEnabled: true });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toBe("PWYW_MIN_REQUIRED");

    const good = await call("PATCH", "/store/price", {
      kind: "track",
      id: TRACK_ID,
      priceCents: 0,
      pwywEnabled: true,
      pwywMinCents: 1000,
    });
    expect(good.status).toBe(200);
    expect(good.data.product.pwyw).toEqual({ enabled: true, minCents: 1000, minPrice: "$10.00" });
  });
});
