/**
 * Gift membership (payfix lane 9) — pg-mem + fake Stripe at the
 * guarded-client seam.
 *
 * Pins:
 *  - grant exactly once: verify twice + a direct lib replay of the
 *    same session → one membership_gifts row, one recipient
 *    notification; the second answer is the duplicate receipt.
 *  - sender receipt + recipient notification naming the gifter;
 *    /mine shows sent for the sender and received for the recipient.
 *  - self-gift refused (400 SELF_GIFT), unknown recipient refused
 *    honestly (404 RECIPIENT_NOT_FOUND), nothing charged or granted.
 *  - glide-back: giftTierForProfile returns the tier inside the
 *    window and null after period_end (no cron, no writes).
 *  - collision: a second gift QUEUES behind the active gift (starts
 *    exactly when the first ends — no paid time lost, none doubled);
 *    checkout is embedded (ui_mode=embedded, mode=payment — never a
 *    subscription, never a hosted-page redirect).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import { sql } from "drizzle-orm";

const SENDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SENDER_PROFILE = "11111111-1111-4111-8111-111111111111";
const RECIPIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RECIPIENT_PROFILE = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  sessions: new Map<string, any>(),
  sessionSeq: 0,
  createdParams: [] as any[],
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../lib/stripe-client", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createGuardedStripeClient: () => ({
      checkout: {
        sessions: {
          create: async (params: any) => {
            h.sessionSeq += 1;
            const id = `cs_test_gift_${h.sessionSeq}`;
            const session = {
              id,
              client_secret: `${id}_secret`,
              payment_status: "paid",
              payment_intent: `pi_gift_${h.sessionSeq}`,
              amount_total: Number(params.metadata.amount_cents),
              currency: "usd",
              metadata: params.metadata,
            };
            h.sessions.set(id, session);
            h.createdParams.push(params);
            return session;
          },
          retrieve: async (id: string) => {
            const s = h.sessions.get(id);
            if (!s) throw new Error("No such session");
            return s;
          },
        },
      },
    }),
  };
});

import membershipGiftsRouter from "../membership-gifts";
import {
  addMonthsClamped,
  computeGiftWindow,
  fulfillGiftMembership,
  giftAmountCents,
  giftTierForProfile,
  highestGiftTierAt,
  resolveGiftRecipient,
} from "../../lib/membership-gifts";
import { createTestDb } from "../../lib/__tests__/test-db";

const DDL = `
CREATE TABLE profiles (
  id uuid PRIMARY KEY,
  email text,
  display_name text
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  slug text NOT NULL,
  display_name text NOT NULL
);
CREATE TABLE membership_gifts (
  id uuid PRIMARY KEY,
  sender_user_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  recipient_profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  tier text NOT NULL,
  months integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  stripe_session_id text NOT NULL,
  stripe_payment_intent_id text,
  amount_cents integer,
  currency text,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_gifts_tier_check CHECK (tier IN ('pro','elite')),
  CONSTRAINT membership_gifts_status_check CHECK (status IN ('active','refunded')),
  CONSTRAINT membership_gifts_months_check CHECK (months >= 1 AND months <= 12)
);
CREATE UNIQUE INDEX membership_gifts_stripe_session_uidx ON membership_gifts (stripe_session_id);
CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text NOT NULL DEFAULT '',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);`;

let server: ReturnType<typeof express.application.listen>;
let base = "";

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function count(table: string): Promise<number> {
  const r = await h.db.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM ${table}`));
  return Number(r.rows[0].c);
}

beforeAll(async () => {
  const { db, mem } = createTestDb();
  h.db = db;
  mem.public.none(DDL);
  const app = express();
  app.use(express.json());
  app.use("/api", membershipGiftsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${(server.address() as any).port}/api`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  await h.db.execute(sql.raw(`DELETE FROM membership_gifts`));
  await h.db.execute(sql.raw(`DELETE FROM notifications`));
  await h.db.execute(sql.raw(`DELETE FROM creator_profiles`));
  await h.db.execute(sql.raw(`DELETE FROM profiles`));
  h.sessions.clear();
  h.createdParams = [];
  h.sessionSeq = 0;
  h.userId = SENDER;
  await h.db.execute(sql`
    INSERT INTO profiles (id, email, display_name) VALUES
      (${SENDER}, 'sender@example.com', 'Gift Giver'),
      (${RECIPIENT}, 'recipient@example.com', 'Lucky Creator')
  `);
  await h.db.execute(sql`
    INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES
      (${SENDER_PROFILE}, ${SENDER}, 'gift-giver', 'Gift Giver'),
      (${RECIPIENT_PROFILE}, ${RECIPIENT}, 'lucky-creator', 'Lucky Creator')
  `);
});

describe("pure window math", () => {
  it("prices from the approved plans: Pro $12, Elite $29, per month", () => {
    expect(giftAmountCents("pro", 1)).toBe(1200);
    expect(giftAmountCents("elite", 1)).toBe(2900);
    expect(giftAmountCents("elite", 3)).toBe(8700);
  });

  it("addMonthsClamped clamps Jan 31 + 1 month to Feb 28", () => {
    const end = addMonthsClamped(new Date("2026-01-31T00:00:00Z"), 1);
    expect(end.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("computeGiftWindow queues behind the latest existing coverage", () => {
    const now = new Date("2026-10-26T00:00:00Z");
    const w = computeGiftWindow([new Date("2026-12-15T00:00:00Z")], now, 1);
    expect(w.periodStart.toISOString()).toBe("2026-12-15T00:00:00.000Z");
    expect(w.periodEnd.toISOString()).toBe("2027-01-15T00:00:00.000Z");
    const fresh = computeGiftWindow([], now, 2);
    expect(fresh.periodStart.toISOString()).toBe(now.toISOString());
  });

  it("highestGiftTierAt glides back: null before, tier inside, null after", () => {
    const rows = [{
      tier: "elite", status: "active",
      periodStart: "2026-10-26T00:00:00Z", periodEnd: "2026-11-26T00:00:00Z",
    }];
    expect(highestGiftTierAt(rows, new Date("2026-10-25T00:00:00Z"))).toBeNull();
    expect(highestGiftTierAt(rows, new Date("2026-11-01T00:00:00Z"))).toBe("elite");
    expect(highestGiftTierAt(rows, new Date("2026-11-26T00:00:00Z"))).toBeNull();
    expect(highestGiftTierAt([{ ...rows[0], status: "refunded" }], new Date("2026-11-01T00:00:00Z"))).toBeNull();
  });
});

describe("recipient resolution", () => {
  it("resolves by handle (with or without @) and by email, case-insensitive", async () => {
    expect((await resolveGiftRecipient("@Lucky-Creator"))?.userId).toBe(RECIPIENT);
    expect((await resolveGiftRecipient("lucky-creator"))?.profileId).toBe(RECIPIENT_PROFILE);
    expect((await resolveGiftRecipient("RECIPIENT@Example.com"))?.userId).toBe(RECIPIENT);
  });

  it("unknown handle and unknown email resolve to null", async () => {
    expect(await resolveGiftRecipient("no-such-person")).toBeNull();
    expect(await resolveGiftRecipient("ghost@example.com")).toBeNull();
  });
});

describe("checkout refusals", () => {
  it("self-gift is refused honestly, no session created", async () => {
    const r = await call("POST", "/membership-gifts/checkout", { recipient: "gift-giver", tier: "pro", months: 1 });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("SELF_GIFT");
    expect(h.createdParams.length).toBe(0);
  });

  it("unknown recipient is refused honestly, no session created", async () => {
    const r = await call("POST", "/membership-gifts/checkout", { recipient: "nobody-here", tier: "elite", months: 1 });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe("RECIPIENT_NOT_FOUND");
    expect(h.createdParams.length).toBe(0);
  });

  it("recipient preview names who you are gifting before you pay", async () => {
    const r = await call("GET", "/membership-gifts/recipient?lookup=@lucky-creator");
    expect(r.status).toBe(200);
    expect(r.json.recipient).toEqual({ displayName: "Lucky Creator", slug: "lucky-creator" });
  });
});

describe("checkout → verify: grant exactly once", () => {
  it("creates an EMBEDDED one-time payment session (never a subscription, never hosted redirect)", async () => {
    const r = await call("POST", "/membership-gifts/checkout", { recipient: "lucky-creator", tier: "pro", months: 1 });
    expect(r.status).toBe(200);
    expect(r.json.clientSecret).toContain("_secret");
    expect(r.json.amountCents).toBe(1200);
    expect(r.json.noRenewCopy).toContain("does not auto-renew");
    const params = h.createdParams[0];
    expect(params.mode).toBe("payment");
    expect(params.ui_mode).toBe("embedded");
    expect(params.line_items[0].price_data.unit_amount).toBe(1200);
    expect(params.metadata.kind).toBe("membership_gift");
    expect(params.metadata.recipient_user_id).toBe(RECIPIENT);
  });

  it("verify grants once: one row, one notification naming the gifter; replay returns the duplicate receipt", async () => {
    const co = await call("POST", "/membership-gifts/checkout", { recipient: "lucky-creator", tier: "elite", months: 1 });
    const sessionId = co.json.sessionId;

    const v1 = await call("POST", "/membership-gifts/verify", { sessionId });
    expect(v1.status).toBe(200);
    expect(v1.json.success).toBe(true);
    expect(v1.json.duplicate).toBe(false);
    expect(v1.json.receipt.tier).toBe("elite");
    expect(v1.json.receipt.displayStatus).toBe("active");
    expect(await count("membership_gifts")).toBe(1);
    expect(await count("notifications")).toBe(1);

    const notif = await h.db.execute(sql`SELECT * FROM notifications LIMIT 1`);
    expect(notif.rows[0].user_id).toBe(RECIPIENT);
    expect(notif.rows[0].kind).toBe("membership_gift");
    expect(String(notif.rows[0].body)).toContain("Gift Giver");
    expect(String(notif.rows[0].body)).toContain("does not auto-renew");
    expect(String(notif.rows[0].body)).toContain("glides back to Free");

    /* Replay through verify AND through the lib (the webhook door):
       still one row, still one notification. */
    const v2 = await call("POST", "/membership-gifts/verify", { sessionId });
    expect(v2.json.duplicate).toBe(true);
    expect(v2.json.receipt.id).toBe(v1.json.receipt.id);
    const replay = await fulfillGiftMembership({
      sessionId, paymentIntentId: "pi_gift_1", amountCents: 2900, currency: "usd",
      senderUserId: SENDER, recipientUserId: RECIPIENT, recipientProfileId: RECIPIENT_PROFILE,
      tier: "elite", months: 1,
    });
    expect(replay.duplicate).toBe(true);
    expect(await count("membership_gifts")).toBe(1);
    expect(await count("notifications")).toBe(1);
  });

  it("sender receipt + recipient view: /mine shows the gift on both sides", async () => {
    const co = await call("POST", "/membership-gifts/checkout", { recipient: "lucky-creator", tier: "pro", months: 2 });
    await call("POST", "/membership-gifts/verify", { sessionId: co.json.sessionId });

    const mineSender = await call("GET", "/membership-gifts/mine");
    expect(mineSender.json.sent.length).toBe(1);
    expect(mineSender.json.sent[0].counterpartyName).toBe("Lucky Creator");
    expect(mineSender.json.sent[0].amountCents).toBe(2400);
    expect(mineSender.json.received.length).toBe(0);

    h.userId = RECIPIENT;
    const mineRecipient = await call("GET", "/membership-gifts/mine");
    expect(mineRecipient.json.received.length).toBe(1);
    expect(mineRecipient.json.received[0].counterpartyName).toBe("Gift Giver");
    expect(mineRecipient.json.received[0].displayStatus).toBe("active");
  });

  it("verify refuses a session that is not the caller's gift", async () => {
    const co = await call("POST", "/membership-gifts/checkout", { recipient: "lucky-creator", tier: "pro", months: 1 });
    h.userId = RECIPIENT;
    const v = await call("POST", "/membership-gifts/verify", { sessionId: co.json.sessionId });
    expect(v.status).toBe(403);
    expect(await count("membership_gifts")).toBe(0);
  });
});

describe("collision + glide-back", () => {
  it("a second gift queues behind the active gift — starts exactly when the first ends", async () => {
    const first = await fulfillGiftMembership({
      sessionId: "cs_first", paymentIntentId: "pi_1", amountCents: 1200, currency: "usd",
      senderUserId: SENDER, recipientUserId: RECIPIENT, recipientProfileId: RECIPIENT_PROFILE,
      tier: "pro", months: 1, now: new Date("2026-10-26T12:00:00Z"),
    });
    const second = await fulfillGiftMembership({
      sessionId: "cs_second", paymentIntentId: "pi_2", amountCents: 2900, currency: "usd",
      senderUserId: SENDER, recipientUserId: RECIPIENT, recipientProfileId: RECIPIENT_PROFILE,
      tier: "elite", months: 1, now: new Date("2026-10-27T12:00:00Z"),
    });
    expect(second.duplicate).toBe(false);
    expect(new Date(second.gift.period_start).toISOString()).toBe(new Date(first.gift.period_end).toISOString());

    /* During gift 1: Pro. During gift 2 (queued Elite): Elite.
       After both windows: null — the glide back to Free. */
    expect(await giftTierForProfile(RECIPIENT_PROFILE, new Date("2026-11-01T00:00:00Z"))).toBe("pro");
    expect(await giftTierForProfile(RECIPIENT_PROFILE, new Date("2026-12-01T00:00:00Z"))).toBe("elite");
    expect(await giftTierForProfile(RECIPIENT_PROFILE, new Date("2027-01-01T00:00:00Z"))).toBeNull();
  });
});
