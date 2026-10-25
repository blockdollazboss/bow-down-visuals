/**
 * Gift cards (Stack-100 #3 #26) — stored value for a seller's store.
 *
 * Harness mirrors store-pwyw.test.ts: REAL gift-cards router + REAL
 * lib/gift-cards money functions, fake db.execute dispatched on
 * rendered SQL text over an in-memory store that implements the
 * lib's conditional-UPDATE guards honestly (reserve/redeem/clawback
 * only apply when their WHERE conditions hold), Stripe faked at the
 * package boundary.
 *
 * Covered: the gap rules — issuance is a liability (no fee, no seller
 * credit), codes stored hashed only, reserve can't over-hold under
 * racing checkouts, redeem is exactly-once, partial redemption keeps
 * the remainder, refund claws back ONLY the unspent balance, and the
 * ledger reconciles to the cent.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { createHash, randomUUID } from "node:crypto";

const BUYER_ID = "00000000-0000-4000-8000-0000000000b1";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const SELLER_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const dialect = new PgDialect();

/* ── In-memory store ─────────────────────────────────────────────── */
interface CardRow extends Record<string, unknown> {
  id: string; code_hash: string; code_last4: string; profile_id: string;
  product_id: string | null; buyer_user_id: string | null;
  recipient_email: string; recipient_name: string | null; message: string | null;
  initial_cents: number; balance_cents: number; reserved_cents: number;
  status: string; stripe_session_id: string | null; created_at: string;
}
interface ReservationRow extends Record<string, unknown> {
  id: string; gift_card_id: string; rail: string; ref: string;
  amount_cents: number; status: string; expires_at: string;
}

const h = vi.hoisted(() => ({
  cards: new Map<string, CardRow>(),
  reservations: new Map<string, ReservationRow>(),
  ledger: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to?: unknown; subject?: unknown; html?: unknown }>,
  stripe: {
    createParams: null as any,
    session: null as any,
    refunds: [] as any[],
  },
}));

function hash(code: string): string {
  const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = cleaned.startsWith("BDV") ? cleaned.slice(3) : cleaned;
  const normalized = body.length === 16
    ? `BDV-${[0, 4, 8, 12].map((i) => body.slice(i, i + 4)).join("-")}`
    : cleaned;
  return createHash("sha256").update(normalized).digest("hex");
}

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

  /* ── gift-cards lib + routes statements ── */
  if (t.includes("FROM gift_cards WHERE code_hash")) {
    const card = [...h.cards.values()].find((c) => c.code_hash === p[0]);
    return { rows: card ? [{ ...card }] : [] };
  }
  if (t.includes("FROM gift_cards WHERE id")) {
    const card = h.cards.get(String(p[0]));
    return { rows: card ? [{ ...card }] : [] };
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
    /* kind is a SQL literal in the lib's templates; params are
       (card_id, amount, balance_after, ref, idempotency_key). */
    const kind = t.includes("'issue'") ? "issue" : t.includes("'redeem'") ? "redeem" : "refund_clawback";
    const key = String(p[4]);
    if (!h.ledger.some((l) => l["idempotency_key"] === key)) {
      h.ledger.push({
        gift_card_id: p[0], kind, amount_cents: p[1],
        balance_after_cents: p[2], ref: p[3], idempotency_key: key,
      });
    }
    return { rows: [] };
  }
  if (t.includes("FROM gift_card_reservations") && t.includes("expires_at < now()")) {
    const now = Date.now();
    const stale = [...h.reservations.values()].filter(
      (r) => r.status === "reserved" && new Date(r.expires_at).getTime() < now,
    );
    return { rows: stale.map((r) => ({ id: r.id, gift_card_id: r.gift_card_id, amount_cents: r.amount_cents })) };
  }
  if (t.includes("FROM gift_card_reservations") && t.includes("WHERE rail")) {
    const r = [...h.reservations.values()].find((x) => x.rail === p[0] && x.ref === p[1]);
    return { rows: r ? [{ ...r }] : [] };
  }
  if (t.includes("FROM gift_card_reservations") && t.includes("WHERE id")) {
    const r = h.reservations.get(String(p[0]));
    return { rows: r ? [{ ...r }] : [] };
  }
  if (t.includes("UPDATE gift_cards") && t.includes("reserved_cents = reserved_cents +")) {
    const amount = Number(p[0]); const card = h.cards.get(String(p[1]));
    if (card && card.status === "active" && card.balance_cents - card.reserved_cents >= amount) {
      card.reserved_cents += amount;
      return { rows: [{ id: card.id }] };
    }
    return { rows: [] };
  }
  if (t.includes("INSERT INTO gift_card_reservations")) {
    if ([...h.reservations.values()].some((x) => x.rail === p[1] && x.ref === p[2])) return { rows: [] };
    const r: ReservationRow = {
      id: randomUUID(), gift_card_id: String(p[0]), rail: String(p[1]), ref: String(p[2]),
      amount_cents: Number(p[3]), status: "reserved", expires_at: String(p[4]),
    };
    h.reservations.set(r.id, r);
    return { rows: [{ ...r }] };
  }
  if (t.includes("UPDATE gift_card_reservations") && t.includes("status = 'released'")) {
    const r = h.reservations.get(String(p[0]));
    if (r && r.status === "reserved") {
      r.status = "released";
      return { rows: [{ gift_card_id: r.gift_card_id, amount_cents: r.amount_cents }] };
    }
    return { rows: [] };
  }
  if (t.includes("UPDATE gift_card_reservations") && t.includes("status = 'redeemed'")) {
    const r = h.reservations.get(String(p[0]));
    if (r && r.status === "reserved") r.status = "redeemed";
    return { rows: [] };
  }
  /* NOTE: the refund-clawback UPDATE (checked below, first) also
     mentions 'depleted' in its WHERE IN (…) — dispatch order matters. */
  if (t.includes("UPDATE gift_cards") && t.includes("status = 'refunded'")) {
    const amount = Number(p[0]); const card = h.cards.get(String(p[1]));
    if (card && (card.status === "active" || card.status === "depleted")
      && card.balance_cents - card.reserved_cents >= amount) {
      card.balance_cents -= amount;
      card.status = "refunded";
      return { rows: [{ balance_cents: card.balance_cents }] };
    }
    return { rows: [] };
  }
  if (t.includes("UPDATE gift_cards") && t.includes("balance_cents = balance_cents -") && t.includes("'depleted'")) {
    const amount = Number(p[0]); const card = h.cards.get(String(p[3]));
    if (card && card.balance_cents >= amount && card.reserved_cents >= amount) {
      card.balance_cents -= amount;
      card.reserved_cents -= amount;
      if (card.balance_cents === 0) card.status = "depleted";
      return { rows: [{ balance_cents: card.balance_cents }] };
    }
    return { rows: [] };
  }
  if (t.includes("UPDATE gift_cards") && t.includes("reserved_cents = reserved_cents -")) {
    const amount = Number(p[0]); const card = h.cards.get(String(p[1]));
    if (card && card.reserved_cents >= amount) card.reserved_cents -= amount;
    return { rows: [] };
  }
  if (t.includes("COUNT(*)") && t.includes("FROM gift_cards") && t.includes("buyer_user_id")) {
    const c = [...h.cards.values()].filter(
      (x) => x.buyer_user_id === p[0] && x.product_id === p[1]
        && x.initial_cents === Number(p[2]) && x.recipient_email.toLowerCase() === p[3],
    ).length;
    return { rows: [{ c }] };
  }
  if (t.includes("issued_cents")) {
    const cards = [...h.cards.values()].filter((x) => x.profile_id === p[0]);
    return { rows: [{
      issued_cents: cards.reduce((s, x) => s + x.initial_cents, 0),
      outstanding_cents: cards.filter((x) => x.status === "active").reduce((s, x) => s + x.balance_cents, 0),
      card_count: cards.length,
    }] };
  }
  if (t.includes("FROM gift_cards gc") && t.includes("buyer_user_id")) {
    return { rows: [...h.cards.values()].filter((x) => x.buyer_user_id === p[0]).map((x) => ({ ...x, store_name: "Queen Creator" })) };
  }
  if (t.includes("FROM gift_cards gc") && t.includes("recipient_email")) {
    return { rows: [...h.cards.values()].filter((x) => x.recipient_email.toLowerCase() === p[0] && x.buyer_user_id !== p[1]).map((x) => ({ ...x, store_name: "Queen Creator" })) };
  }
  if (t.includes("FROM gift_cards WHERE profile_id")) {
    return { rows: [...h.cards.values()].filter((x) => x.profile_id === p[0]).map((x) => ({ ...x })) };
  }

  /* ── routes/gift-cards.ts direct statements ── */
  if (t.includes("SELECT sp.*")) {
    return { rows: p[0] === PRODUCT_ID ? [{ ...productRow }] : [] };
  }
  if (t.includes("SELECT display_name, slug FROM creator_profiles")) {
    return { rows: [{ display_name: "Queen Creator", slug: "queen-creator" }] };
  }
  if (t.includes("SELECT id, display_name FROM creator_profiles")) {
    return { rows: p[0] === SELLER_ID ? [{ id: PROFILE_ID, display_name: "Queen Creator" }] : [] };
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
        create: async (params: any) => {
          h.stripe.createParams = params;
          return { id: "cs_test_gift_1", url: "https://checkout.example.com/cs_test_gift_1" };
        },
        retrieve: async () => h.stripe.session,
      },
    };
    refunds = {
      create: async (params: any, opts: any) => {
        h.stripe.refunds.push({ params, opts });
        return { id: "re_test_1", status: "succeeded" };
      },
    };
  }
  return { default: FakeStripe };
});

process.env["STRIPE_SECRET_KEY"] = "sk_test_fake_for_gift_card_tests";

import giftCardsRouter from "../gift-cards";
import * as lib from "../../lib/gift-cards";

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
    headers: { "Content-Type": "application/json", "x-test-user": user, "x-test-email": user === SELLER_ID ? "seller@example.com" : "buyer@example.com" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

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
  h.reservations.clear();
  h.ledger.length = 0;
  h.emails.length = 0;
  h.stripe.createParams = null;
  h.stripe.session = null;
  h.stripe.refunds = [];
});

describe("pure money math", () => {
  it("tender never exceeds due or available, never negative", () => {
    expect(lib.tenderFor(3000, 5000)).toBe(3000);
    expect(lib.tenderFor(9000, 5000)).toBe(5000);
    expect(lib.tenderFor(0, 5000)).toBe(0);
    expect(lib.tenderFor(-5, -5)).toBe(0);
  });
  it("refundable is balance minus reserved, floored at zero", () => {
    expect(lib.refundableCents(5000, 0)).toBe(5000);
    expect(lib.refundableCents(5000, 2000)).toBe(3000);
    expect(lib.refundableCents(1000, 2000)).toBe(0);
  });
  it("denominations validate: 1–8 distinct $5–$500 amounts", () => {
    expect(lib.validateDenominations([2500, 5000]).ok).toBe(true);
    expect(lib.validateDenominations([]).ok).toBe(false);
    expect(lib.validateDenominations([100]).ok).toBe(false);
    expect(lib.validateDenominations([60000]).ok).toBe(false);
    expect(lib.validateDenominations([2500, 2500]).denominations).toEqual([2500]);
  });
  it("codes normalize + hash consistently, last4 is display-only", () => {
    const code = lib.generateGiftCardCode();
    expect(code).toMatch(/^BDV(-[A-Z2-9]{4}){4}$/);
    expect(lib.hashGiftCardCode(code.toLowerCase())).toBe(lib.hashGiftCardCode(code));
    expect(lib.giftCardLast4(code)).toBe(code.slice(-4));
    expect(lib.isGiftCardCodeShape(code)).toBe(true);
    expect(lib.isGiftCardCodeShape("not-a-card")).toBe(false);
  });
});

describe("checkout: buyer-chosen amount, recipient delivery", () => {
  it("refuses an amount the seller didn't configure", async () => {
    const r = await call("POST", "/gift-cards/checkout", {
      productId: PRODUCT_ID, amountCents: 3000, recipientEmail: "friend@example.com",
    });
    expect(r.status).toBe(400);
    expect(r.data.error).toBe("AMOUNT_NOT_OFFERED");
    expect(h.stripe.createParams).toBeNull();
  });

  it("requires a recipient email — the buyer is never the delivery target", async () => {
    const r = await call("POST", "/gift-cards/checkout", { productId: PRODUCT_ID, amountCents: 5000 });
    expect(r.status).toBe(400);
    expect(h.stripe.createParams).toBeNull();
  });

  it("opens a session whose metadata records NO fee and NO seller credit at issuance", async () => {
    const r = await call("POST", "/gift-cards/checkout", {
      productId: PRODUCT_ID, amountCents: 5000, recipientEmail: "friend@example.com", recipientName: "Friend",
    });
    expect(r.status).toBe(200);
    expect(r.data.url).toContain("checkout.example.com");
    const meta = h.stripe.createParams.metadata;
    expect(meta.type).toBe("gift_card_purchase");
    expect(meta.recipient_email).toBe("friend@example.com");
    expect(meta.platform_fee_cents).toBe("0");
    expect(meta.creator_amount_cents).toBe("0");
    expect(h.stripe.createParams.line_items[0].price_data.unit_amount).toBe(5000);
  });
});

describe("verify: issuance is a liability, exactly once, code shown once", () => {
  it("issues the card at full balance with an issue ledger entry", async () => {
    h.stripe.session = paidSession();
    const r = await call("POST", "/gift-cards/verify", { sessionId: "cs_test_gift_1" });
    expect(r.status).toBe(200);
    expect(r.data.duplicate).toBe(false);
    expect(r.data.code).toMatch(/^BDV(-[A-Z2-9]{4}){4}$/);
    expect(r.data.card.balanceCents).toBe(5000);
    expect(r.data.card.initialCents).toBe(5000);
    /* Only the hash + last4 are stored — never the plaintext code. */
    const stored = [...h.cards.values()][0]!;
    expect(stored.code_hash).toBe(hash(r.data.code));
    expect(JSON.stringify(stored)).not.toContain(r.data.code);
    const issue = h.ledger.find((l) => l["kind"] === "issue");
    expect(issue?.["amount_cents"]).toBe(5000);
    expect(issue?.["balance_after_cents"]).toBe(5000);
  });

  it("the delivery email's store CTA is an ABSOLUTE url (a relative href cannot resolve in an inbox)", async () => {
    h.stripe.session = paidSession();
    const r = await call("POST", "/gift-cards/verify", { sessionId: "cs_test_gift_1" });
    expect(r.status).toBe(200);
    /* sendEmail is fire-and-forget in the route; the mock records the
       call synchronously, but flush a tick before asserting. */
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0]!.to).toBe("friend@example.com");
    const html = String(h.emails[0]!.html ?? "");
    /* baseUrlForEmail is stubbed to https://example.com above; the CTA
       (stubbed emailButton renders <a href="...">) must carry it. */
    expect(html).toContain('href="https://example.com/artist/queen-creator"');
    expect(html).not.toContain('href="/artist/');
    /* The buyer-facing JSON keeps its relative storeUrl — only the
       email needed the absolute form. */
    expect(r.data.links.storeUrl).toBe("/artist/queen-creator");
  });

  it("a duplicate verify returns the card WITHOUT the code and issues nothing twice", async () => {
    h.stripe.session = paidSession();
    const first = await call("POST", "/gift-cards/verify", { sessionId: "cs_test_gift_1" });
    const second = await call("POST", "/gift-cards/verify", { sessionId: "cs_test_gift_1" });
    expect(second.data.duplicate).toBe(true);
    expect(second.data.code).toBeNull();
    expect(h.cards.size).toBe(1);
    expect(h.ledger.filter((l) => l["kind"] === "issue")).toHaveLength(1);
    expect(first.data.card.id).toBe(second.data.card.id);
  });

  it("refuses another buyer's session", async () => {
    h.stripe.session = paidSession({ buyer_user_id: "someone-else" });
    const r = await call("POST", "/gift-cards/verify", { sessionId: "cs_test_gift_1" });
    expect(r.status).toBe(403);
    expect(h.cards.size).toBe(0);
  });
});

describe("reserve → redeem: partial spends, no double-spend", () => {
  async function issueCard(): Promise<{ id: string; code: string }> {
    h.stripe.session = paidSession();
    const r = await call("POST", "/gift-cards/verify", { sessionId: "cs_test_gift_1" });
    return { id: r.data.card.id, code: r.data.code };
  }

  it("balance lookup by code returns spendable (unreserved) value", async () => {
    const { code } = await issueCard();
    const r = await call("GET", `/gift-cards/balance?code=${encodeURIComponent(code)}`);
    expect(r.status).toBe(200);
    expect(r.data.card.balanceCents).toBe(5000);
    expect(r.data.card.availableCents).toBe(5000);
    expect(r.data.store.name).toBe("Queen Creator");
  });

  it("two racing checkouts cannot hold more than the balance", async () => {
    const { id } = await issueCard();
    const a = await lib.reserveGiftCard({ cardId: id, rail: "storefront", ref: "a", amountCents: 4000 });
    const b = await lib.reserveGiftCard({ cardId: id, rail: "storefront", ref: "b", amountCents: 4000 });
    expect(a).not.toBeNull();
    expect(b).toBeNull(); // 4000 held of 5000 — only 1000 left
    const card = h.cards.get(id)!;
    expect(card.reserved_cents).toBe(4000);
  });

  it("partial redemption keeps the rest; replaying the redemption debits nothing twice", async () => {
    const { id } = await issueCard();
    const hold = await lib.reserveGiftCard({ cardId: id, rail: "storefront", ref: "order-1", amountCents: 2000 });
    const first = await lib.redeemReservation({ reservationId: hold.id, ref: "order-1" });
    expect(first.redeemedCents).toBe(2000);
    expect(first.balanceAfterCents).toBe(3000);
    const replay = await lib.redeemReservation({ reservationId: hold.id, ref: "order-1" });
    expect(replay.redeemedCents).toBe(2000);
    expect(h.cards.get(id)!.balance_cents).toBe(3000);
    expect(h.ledger.filter((l) => l["kind"] === "redeem")).toHaveLength(1);
  });

  it("releasing a hold returns the cents to spendable", async () => {
    const { id } = await issueCard();
    const hold = await lib.reserveGiftCard({ cardId: id, rail: "shops", ref: "g1", amountCents: 5000 });
    await lib.releaseReservation(hold.id);
    const card = h.cards.get(id)!;
    expect(card.reserved_cents).toBe(0);
    expect(card.balance_cents).toBe(5000);
  });
});

describe("refund: claws back only the unspent balance, exactly once", () => {
  it("after a partial spend, refunds the remainder and closes the card", async () => {
    h.stripe.session = paidSession();
    const issued = await call("POST", "/gift-cards/verify", { sessionId: "cs_test_gift_1" });
    const cardId = issued.data.card.id;
    const hold = await lib.reserveGiftCard({ cardId, rail: "storefront", ref: "order-9", amountCents: 2000 });
    await lib.redeemReservation({ reservationId: hold.id, ref: "order-9" });

    const r = await call("POST", `/gift-cards/${cardId}/refund`, {});
    expect(r.status).toBe(200);
    expect(r.data.refundedCents).toBe(3000);
    expect(r.data.spentKeptCents).toBe(2000);
    /* Stripe was asked for exactly the unspent remainder, idempotently. */
    expect(h.stripe.refunds).toHaveLength(1);
    expect(h.stripe.refunds[0].params.amount).toBe(3000);
    expect(h.stripe.refunds[0].opts.idempotencyKey).toBe(`giftcard-refund:${cardId}`);
    const card = h.cards.get(cardId)!;
    expect(card.status).toBe("refunded");
    expect(card.balance_cents).toBe(0);
    /* Reconciliation to the cent: 5000 = 0 balance + 2000 redeemed + 3000 refunded. */
    expect(lib.reconciles({ initialCents: 5000, balanceCents: card.balance_cents, redeemedCents: 2000, refundedCents: 3000 })).toBe(true);

    const again = await call("POST", `/gift-cards/${cardId}/refund`, {});
    expect(again.data.duplicate).toBe(true);
    expect(h.stripe.refunds).toHaveLength(1);
  });

  it("a fully spent card has nothing to refund", async () => {
    h.stripe.session = paidSession();
    const issued = await call("POST", "/gift-cards/verify", { sessionId: "cs_test_gift_1" });
    const cardId = issued.data.card.id;
    const hold = await lib.reserveGiftCard({ cardId, rail: "storefront", ref: "order-10", amountCents: 5000 });
    await lib.redeemReservation({ reservationId: hold.id, ref: "order-10" });
    const r = await call("POST", `/gift-cards/${cardId}/refund`, {});
    expect(r.status).toBe(400);
    expect(r.data.error).toBe("NOTHING_TO_REFUND");
    expect(h.stripe.refunds).toHaveLength(0);
  });

  it("only the buyer can refund", async () => {
    h.stripe.session = paidSession();
    const issued = await call("POST", "/gift-cards/verify", { sessionId: "cs_test_gift_1" });
    const r = await call("POST", `/gift-cards/${issued.data.card.id}/refund`, {}, SELLER_ID);
    expect(r.status).toBe(403);
  });
});

describe("seller desk: liability, not revenue", () => {
  it("sold view reports issued + outstanding liability", async () => {
    h.stripe.session = paidSession();
    await call("POST", "/gift-cards/verify", { sessionId: "cs_test_gift_1" });
    const r = await call("GET", "/gift-cards/sold", undefined, SELLER_ID);
    expect(r.status).toBe(200);
    expect(r.data.liability.issuedCents).toBe(5000);
    expect(r.data.liability.outstandingCents).toBe(5000);
    expect(r.data.cards).toHaveLength(1);
    expect(r.data.cards[0].codeLast4).toHaveLength(4);
  });
});
