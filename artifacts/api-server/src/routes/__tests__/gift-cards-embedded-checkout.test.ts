/**
 * Embedded checkout on the gift-card rail (stack400 lane 7).
 *
 * Lane 6 brought the profile-storefront rail embedded; the gift-card
 * purchase on the same product page (POST /gift-cards/checkout,
 * routes/gift-cards.ts) was its named remainder — it minted hosted-only
 * sessions and the page redirected every buyer to Stripe's hosted page
 * (owner law 2026-10-26: "we should never have to leave my site").
 * Harness mirrors gift-cards.test.ts (REAL router + REAL lib/gift-cards
 * money functions, fake db.execute dispatched on rendered SQL text,
 * Stripe faked at the package boundary) and pins:
 *  - an embedded ask mints the SAME session in embedded_page ui_mode:
 *    return_url to the hosted success path on the product page (fixed
 *    server-side — no client input, no success/cancel URLs), same
 *    metadata, same idempotency key, and the response carries the
 *    clientSecret + uiMode "embedded";
 *  - no ask (or the EMBEDDED_CHECKOUT kill switch) keeps the legacy
 *    hosted shape byte-for-byte: success/cancel URLs, url to redirect
 *    to, clientSecret null;
 *  - an embedded session that comes back without a client secret fails
 *    like a failed creation (500) instead of answering a secret-less
 *    "embedded" response;
 *  - the rail's pricing re-pinned from code: NO fee and NO seller
 *    credit at issuance (platform_fee_cents "0", creator_amount_cents
 *    "0") on the embedded shape too — the buyer pays exactly the
 *    denomination; the fee lands once, at redemption, on another rail;
 *  - an embedded session settles through verify into exactly ONE card
 *    keyed to the BUYER'S ACCOUNT, delivered by exactly ONE email to
 *    the recipient; a duplicate verify issues nothing and emails
 *    nothing, and another account's verify is refused 403 (this rail
 *    never had the shops free-text-email disease: the buyer's identity
 *    is the authenticated session, and the recipient email is the
 *    delivery address by design).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";

const BUYER_ID = "00000000-0000-4000-8000-0000000000b1";
const OTHER_ID = "00000000-0000-4000-8000-0000000000b2";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const dialect = new PgDialect();

interface CardRow extends Record<string, unknown> {
  id: string; code_hash: string; code_last4: string; profile_id: string;
  product_id: string | null; buyer_user_id: string | null;
  recipient_email: string; recipient_name: string | null; message: string | null;
  initial_cents: number; balance_cents: number; reserved_cents: number;
  status: string; stripe_session_id: string | null; created_at: string;
}

const h = vi.hoisted(() => ({
  cards: new Map<string, CardRow>(),
  ledger: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to?: unknown; subject?: unknown; html?: unknown }>,
  creates: [] as Array<{ params: any; opts: any }>,
  session: null as any,
  secretMode: "secret" as "secret" | "none",
}));

const productRow = {
  id: PRODUCT_ID, profile_id: PROFILE_ID, kind: "gift_card",
  title: "Queen Gift Card", price_cents: 2500, is_active: true,
  gift_card_denominations_cents: [2500, 5000, 10000],
  artist_name: "Queen Creator", artist_slug: "queen-creator",
};

function fakeExecute(q: unknown): { rows: Record<string, unknown>[] } {
  const { sql: text, params } = dialect.sqlToQuery(q as never);
  const p = params as unknown[];
  const t = text.replace(/\s+/g, " ");

  if (t.includes("COUNT(*)") && t.includes("FROM gift_cards") && t.includes("buyer_user_id")) {
    const c = [...h.cards.values()].filter(
      (x) => x.buyer_user_id === p[0] && x.product_id === p[1]
        && x.initial_cents === Number(p[2]) && x.recipient_email.toLowerCase() === p[3],
    ).length;
    return { rows: [{ c }] };
  }
  if (t.includes("INSERT INTO gift_cards")) {
    if ([...h.cards.values()].some((c) => c.stripe_session_id === p[10])) return { rows: [] };
    const card: CardRow = {
      id: randomUUID(), code_hash: String(p[0]), code_last4: String(p[1]),
      profile_id: String(p[2]), product_id: (p[3] as string) ?? null,
      buyer_user_id: (p[4] as string) ?? null, recipient_email: String(p[5]),
      recipient_name: (p[6] as string) ?? null, message: (p[7] as string) ?? null,
      initial_cents: Number(p[8]), balance_cents: Number(p[9]),
      reserved_cents: 0, status: "active", stripe_session_id: (p[10] as string) ?? null,
      created_at: new Date().toISOString(),
    };
    h.cards.set(card.id, card);
    return { rows: [{ ...card }] };
  }
  if (t.includes("FROM gift_cards WHERE stripe_session_id")) {
    const card = [...h.cards.values()].find((c) => c.stripe_session_id === p[0]);
    return { rows: card ? [{ ...card }] : [] };
  }
  if (t.includes("INSERT INTO gift_card_ledger")) {
    const key = String(p[4]);
    if (!h.ledger.some((l) => l["idempotency_key"] === key)) {
      h.ledger.push({
        gift_card_id: p[0], kind: "issue", amount_cents: p[1],
        balance_after_cents: p[2], ref: p[3], idempotency_key: key,
      });
    }
    return { rows: [] };
  }
  if (t.includes("SELECT sp.*")) {
    return { rows: p[0] === PRODUCT_ID ? [{ ...productRow }] : [] };
  }
  if (t.includes("SELECT display_name, slug FROM creator_profiles")) {
    return { rows: [{ display_name: "Queen Creator", slug: "queen-creator" }] };
  }
  return { rows: [] };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, db: { execute: async (q: unknown) => fakeExecute(q) } };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.headers["x-test-user"] ?? BUYER_ID;
    req.userEmail = req.headers["x-test-email"] ?? "buyer@example.com";
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
}));

vi.mock("../../lib/email", () => ({
  sendEmail: async (args: { to?: unknown; subject?: unknown; html?: unknown }) => {
    h.emails.push(args);
    return { ok: true };
  },
  emailShell: (_title: string, html: string) => html,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
  emailDetailBox: (html: string) => html,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  escapeHtml: (s: string) => s,
  baseUrlForEmail: () => "https://example.com",
}));

vi.mock("stripe", () => {
  class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: any, opts: any) => {
          h.creates.push({ params, opts });
          const n = h.creates.length;
          return {
            id: `cs_test_gift_${n}`,
            /* Real Stripe answers url: null for embedded sessions; the
               fake keeps a url on both shapes so the assertions tell
               them apart by ui_mode, not by the fake. */
            url: `https://checkout.example.com/cs_test_gift_${n}`,
            ...(h.secretMode === "secret" ? { client_secret: `cs_test_gift_${n}_secret` } : {}),
          };
        },
        retrieve: async () => h.session,
      },
    };
  }
  return { default: FakeStripe };
});

process.env["STRIPE_SECRET_KEY"] = "sk_test_fake_for_gift_card_tests";

import giftCardsRouter from "../gift-cards";

let base = "";
let server: ReturnType<typeof express.application.listen>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(giftCardsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(method: string, path: string, body?: unknown, user = BUYER_ID) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

const CHECKOUT_BODY = {
  productId: PRODUCT_ID, amountCents: 5000,
  recipientEmail: "friend@example.com", recipientName: "Friend",
};

function paidSession(overrides: Record<string, string> = {}) {
  return {
    id: "cs_test_gift_1",
    payment_status: "paid",
    amount_total: 5000,
    payment_intent: "pi_test_gift_1",
    metadata: {
      type: "gift_card_purchase",
      buyer_user_id: BUYER_ID,
      profile_id: PROFILE_ID,
      product_id: PRODUCT_ID,
      amount_cents: "5000",
      recipient_email: "friend@example.com",
      recipient_name: "Friend",
      gift_message: "",
      platform_fee_cents: "0",
      creator_amount_cents: "0",
      ...overrides,
    },
  };
}

beforeEach(() => {
  h.cards.clear();
  h.ledger.length = 0;
  h.emails.length = 0;
  h.creates.length = 0;
  h.session = null;
  h.secretMode = "secret";
  delete process.env["EMBEDDED_CHECKOUT"];
});

describe("gift-card checkout: embedded presentation", () => {
  it("embedded ask mints embedded_page with the fixed return_url and answers the clientSecret", async () => {
    const r = await call("POST", "/gift-cards/checkout", { ...CHECKOUT_BODY, uiMode: "embedded" });
    expect(r.status).toBe(200);
    expect(r.data.uiMode).toBe("embedded");
    expect(r.data.clientSecret).toBe("cs_test_gift_1_secret");
    expect(r.data.sessionId).toBe("cs_test_gift_1");
    const params = h.creates[0]!.params;
    expect(params.ui_mode).toBe("embedded_page");
    expect(params.return_url).toMatch(
      new RegExp(`/storefront/product/${PRODUCT_ID}\\?gift=success&session_id=\\{CHECKOUT_SESSION_ID\\}$`),
    );
    expect(params.success_url).toBeUndefined();
    expect(params.cancel_url).toBeUndefined();
  });

  it("embedded ask: session metadata + idempotency key are identical to the hosted shape, fee stays zero", async () => {
    await call("POST", "/gift-cards/checkout", { ...CHECKOUT_BODY });
    await call("POST", "/gift-cards/checkout", { ...CHECKOUT_BODY, uiMode: "embedded" });
    const [hosted, embedded] = h.creates;
    expect(embedded!.params.metadata).toEqual(hosted!.params.metadata);
    expect(embedded!.opts.idempotencyKey).toBe(hosted!.opts.idempotencyKey);
    expect(embedded!.params.metadata.platform_fee_cents).toBe("0");
    expect(embedded!.params.metadata.creator_amount_cents).toBe("0");
    expect(embedded!.params.line_items[0].price_data.unit_amount).toBe(5000);
  });

  it("no ask keeps the legacy hosted shape byte-for-byte", async () => {
    const r = await call("POST", "/gift-cards/checkout", { ...CHECKOUT_BODY });
    expect(r.status).toBe(200);
    expect(r.data.uiMode).toBe("hosted");
    expect(r.data.clientSecret).toBeNull();
    expect(r.data.url).toContain("checkout.example.com");
    const params = h.creates[0]!.params;
    expect(params.ui_mode).toBeUndefined();
    expect(params.return_url).toBeUndefined();
    expect(params.success_url).toMatch(
      new RegExp(`/storefront/product/${PRODUCT_ID}\\?gift=success&session_id=\\{CHECKOUT_SESSION_ID\\}$`),
    );
    expect(params.cancel_url).toMatch(new RegExp(`/storefront/product/${PRODUCT_ID}$`));
  });

  it("EMBEDDED_CHECKOUT=off forces the hosted shape even when embedded is asked", async () => {
    process.env["EMBEDDED_CHECKOUT"] = "off";
    const r = await call("POST", "/gift-cards/checkout", { ...CHECKOUT_BODY, uiMode: "embedded" });
    expect(r.status).toBe(200);
    expect(r.data.uiMode).toBe("hosted");
    expect(r.data.clientSecret).toBeNull();
    expect(h.creates[0]!.params.ui_mode).toBeUndefined();
    expect(h.creates[0]!.params.success_url).toBeDefined();
  });

  it("an embedded session without a client secret fails like a failed creation", async () => {
    h.secretMode = "none";
    const r = await call("POST", "/gift-cards/checkout", { ...CHECKOUT_BODY, uiMode: "embedded" });
    expect(r.status).toBe(500);
    expect(r.data.clientSecret).toBeUndefined();
    expect(h.cards.size).toBe(0);
    /* …while the hosted shape is unaffected by the missing secret. */
    const hosted = await call("POST", "/gift-cards/checkout", { ...CHECKOUT_BODY });
    expect(hosted.status).toBe(200);
    expect(hosted.data.url).toContain("checkout.example.com");
  });
});

describe("gift-card verify: an embedded session settles exactly once", () => {
  it("issues ONE account-keyed card + ONE recipient email; duplicate verify re-issues nothing", async () => {
    const co = await call("POST", "/gift-cards/checkout", { ...CHECKOUT_BODY, uiMode: "embedded" });
    expect(co.status).toBe(200);
    h.session = paidSession();

    const v1 = await call("POST", "/gift-cards/verify", { sessionId: "cs_test_gift_1" });
    expect(v1.status).toBe(200);
    expect(v1.data.success).toBe(true);
    expect(v1.data.duplicate).toBe(false);
    expect(typeof v1.data.code).toBe("string");
    expect(h.cards.size).toBe(1);
    const card = [...h.cards.values()][0]!;
    expect(card.buyer_user_id).toBe(BUYER_ID);
    expect(card.recipient_email).toBe("friend@example.com");
    expect(card.initial_cents).toBe(5000);
    expect(h.ledger.filter((l) => l["kind"] === "issue")).toHaveLength(1);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0]!.to).toBe("friend@example.com");

    const v2 = await call("POST", "/gift-cards/verify", { sessionId: "cs_test_gift_1" });
    expect(v2.status).toBe(200);
    expect(v2.data.duplicate).toBe(true);
    expect(v2.data.code).toBeNull();
    expect(h.cards.size).toBe(1);
    expect(h.emails).toHaveLength(1);
  });

  it("another account's verify of the same session is refused and issues nothing", async () => {
    h.session = paidSession();
    const v = await call("POST", "/gift-cards/verify", { sessionId: "cs_test_gift_1" }, OTHER_ID);
    expect(v.status).toBe(403);
    expect(h.cards.size).toBe(0);
    expect(h.emails).toHaveLength(0);
  });
});
