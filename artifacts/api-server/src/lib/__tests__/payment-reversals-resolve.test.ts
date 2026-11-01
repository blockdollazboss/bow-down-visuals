/**
 * payment-reversals-resolve.test.ts — the human's verb on a parked
 * reversal row (stack1100 Lane Y2) against real Postgres semantics
 * (pg-mem), in the engine suite's own idiom.
 *
 * Pinned contract:
 *  - 'complete' runs the engine's own completion legs for the parked
 *    row (sponsor escrow unfunds, booking escrow refunds) and lands
 *    the row at 'completed' with the legs' flags — exactly once;
 *  - 'dismiss' lands the row at 'dismissed' and moves NO money and
 *    runs NO leg;
 *  - every resolution writes exactly ONE audit row
 *    (payment_reversal_resolutions) naming who, when, which way, and
 *    the note — the row the /admin bench renders;
 *  - the audit row is the claim: a double-resolve race lands one
 *    decision and conflicts the other; a retry of the SAME decision
 *    reads the recorded outcome back (already_resolved) and never
 *    re-executes; a different decision after resolution conflicts;
 *  - a stale audit row whose flip never landed (crashed resolve) is
 *    reclaimed by the next resolver, while a FRESH one reads as
 *    another admin mid-resolve (conflict);
 *  - a dismissed row is reopened by the engine when a later event
 *    identifies NEW auto-reversible work (the dismissal answered the
 *    facts as they stood) — and the dismissal stays on the audit
 *    trail;
 *  - non-parked rows conflict, a missing row is not_found, and a
 *    parked row carrying granted credits is refused loudly (the VB
 *    claw leg is the engine's, never the verb's).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── Fake db handle (pg-mem), swapped per test ─────────────────────── */
const testState = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return testState.db;
    },
  };
});

/* The resolve path (and the sponsor/booking engine legs) must never
   touch Supabase: parked rails carry no VB grant to claw. A throw
   here fails any test that lets the verb reach for it. */
vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: () => {
    throw new Error("supabase must not be touched by the resolve verb");
  },
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createTestDb } from "./test-db";
import {
  processChargeReversal,
  resolvePaymentReversal,
  listPaymentReversals,
  getPaymentReversal,
  type ReversalCharge,
} from "../payment-reversals";
import { sql } from "drizzle-orm";
import { DataType } from "pg-mem";
import { randomUUID } from "crypto";

const DDL = `
CREATE TABLE stripe_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id text UNIQUE NOT NULL,
  stripe_payment_intent_id text,
  user_id uuid NOT NULL,
  credit_pack text,
  credits_amount integer NOT NULL,
  amount_total integer,
  currency text,
  status text DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text,
  stripe_charge_id text NOT NULL,
  stripe_payment_intent_id text,
  trigger text NOT NULL,
  rail text NOT NULL,
  user_id uuid,
  session_id text,
  granted_credits integer NOT NULL DEFAULT 0,
  credits_clawed integer NOT NULL DEFAULT 0,
  referral_credits_clawed integer NOT NULL DEFAULT 0,
  refunded_cents_seen integer NOT NULL DEFAULT 0,
  charge_amount_cents integer,
  dispute_lost boolean NOT NULL DEFAULT false,
  entitlement_revoked boolean NOT NULL DEFAULT false,
  seller_reversed boolean NOT NULL DEFAULT false,
  shortfall_credits integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_reversals_charge_ux ON payment_reversals (stripe_charge_id);
-- The production table FKs reversal_id to payment_reversals(id) ON
-- DELETE CASCADE (migration 0304 + the drizzle schema). pg-mem
-- cannot match an ON CONFLICT target on an FK column (verified
-- against pg-mem 3.0.14), so the harness drops the REFERENCES --
-- the verb's exactly-once semantics ride the UNIQUE index below,
-- which is what these tests pin.
CREATE TABLE payment_reversal_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reversal_id uuid NOT NULL,
  stripe_charge_id text NOT NULL,
  decision text NOT NULL,
  admin_user_id uuid,
  admin_email text,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_reversal_resolutions_reversal_ux ON payment_reversal_resolutions (reversal_id);
CREATE TABLE sponsor_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_status text NOT NULL DEFAULT 'unfunded',
  status text NOT NULL DEFAULT 'draft',
  stripe_session_id text,
  stripe_payment_intent_id text
);
CREATE TABLE sponsor_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'released',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE performance_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_status text NOT NULL DEFAULT 'unfunded',
  status text NOT NULL DEFAULT 'draft',
  artist_payout_cents integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const ADMIN_EMAIL = "king@example.test";
const BUYER = "11111111-1111-4111-8111-111111111111";
const DEAL = "44444444-4444-4444-8444-444444444444";
const BOOKING = "55555555-5555-4555-8555-555555555555";

/* Fake Stripe: checkout-session lookup by payment intent. */
const sessionsByPi = new Map<string, Array<Record<string, unknown>>>();
const stripeFake = {
  checkout: {
    sessions: {
      list: async ({ payment_intent }: { payment_intent: string }) => ({
        data: sessionsByPi.get(payment_intent) ?? [],
      }),
    },
  },
} as never;

async function q(query: ReturnType<typeof sql>) {
  const r = await testState.db.execute(query);
  return r.rows as Array<Record<string, unknown>>;
}

let chargeSeq = 0;

/** Seed a parked row exactly the way recordManualReview writes it. */
async function seedParked(over: {
  rail: string;
  details?: Record<string, unknown>;
  sessionId?: string | null;
  userId?: string | null;
  grantedCredits?: number;
  status?: string;
}): Promise<{ id: string; chargeId: string }> {
  chargeSeq += 1;
  const chargeId = `ch_parked_${chargeSeq}`;
  const details = {
    ...(over.details ?? {}),
    manualReason: "parked for the test",
  };
  const rows = await q(sql`
    INSERT INTO payment_reversals (
      stripe_event_id, stripe_charge_id, stripe_payment_intent_id, trigger,
      rail, user_id, session_id, granted_credits, charge_amount_cents,
      refunded_cents_seen, status, details
    ) VALUES (
      'evt_park', ${chargeId}, 'pi_park', 'charge.refunded',
      ${over.rail}, ${over.userId ?? null}, ${over.sessionId ?? null},
      ${over.grantedCredits ?? 0}, 5000, 5000,
      ${over.status ?? "needs_manual_review"}, ${JSON.stringify(details)}::jsonb
    )
    RETURNING id
  `);
  return { id: String(rows[0]!["id"]), chargeId };
}

async function seedSponsorEscrowFunded(payout: boolean) {
  await q(sql`
    INSERT INTO sponsor_deals (id, escrow_status, status, stripe_session_id)
    VALUES (${DEAL}, 'funded', 'active', 'cs_deal_1')
  `);
  if (payout) {
    await q(sql`INSERT INTO sponsor_payouts (deal_id, status) VALUES (${DEAL}, 'released')`);
  }
}

async function resolutionsFor(reversalId: string) {
  return q(sql`SELECT * FROM payment_reversal_resolutions WHERE reversal_id = ${reversalId}`);
}

async function rowOf(id: string) {
  const rows = await q(sql`SELECT * FROM payment_reversals WHERE id = ${id}`);
  return rows[0]!;
}

beforeEach(() => {
  const t = createTestDb();
  t.mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  t.mem.public.none(DDL);
  testState.db = t.db;
  sessionsByPi.clear();
  chargeSeq = 0;
});

describe("resolvePaymentReversal — complete runs the engine's own legs", () => {
  it("sponsor escrow: completion unfunds the deal and lands 'completed' with flags + audit", async () => {
    await seedSponsorEscrowFunded(true);
    const { id } = await seedParked({
      rail: "sponsor_deal",
      sessionId: "cs_deal_1",
      details: { dealId: DEAL, escrowStatus: "funded", payoutId: "po_1", payoutStatus: "released" },
    });

    const out = await resolvePaymentReversal({
      reversalId: id, decision: "complete",
      adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "Reconciled with the creator.",
    });

    expect(out.outcome).toBe("resolved");
    const row = await rowOf(id);
    expect(row["status"]).toBe("completed");
    expect(row["entitlement_revoked"]).toBe(true);
    expect(row["seller_reversed"]).toBe(true);
    const deal = await q(sql`SELECT escrow_status FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(deal[0]!["escrow_status"]).toBe("unfunded");

    const audit = await resolutionsFor(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      decision: "complete",
      admin_user_id: ADMIN_ID,
      admin_email: ADMIN_EMAIL,
      note: "Reconciled with the creator.",
    });
    const details = row["details"] as Record<string, any>;
    expect(details["resolution"]).toMatchObject({ decision: "complete", adminEmail: ADMIN_EMAIL });
  });

  it("performance booking: completion flips the escrow to the rail's refunded state", async () => {
    await q(sql`
      INSERT INTO performance_bookings (id, escrow_status, status, artist_payout_cents)
      VALUES (${BOOKING}, 'funded', 'paid', 5000)
    `);
    const { id } = await seedParked({
      rail: "performance_booking",
      sessionId: "cs_book_1",
      details: { bookingId: BOOKING, escrowStatus: "funded", bookingStatus: "paid" },
    });

    const out = await resolvePaymentReversal({
      reversalId: id, decision: "complete",
      adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "",
    });

    expect(out.outcome).toBe("resolved");
    const booking = await q(sql`SELECT escrow_status FROM performance_bookings WHERE id = ${BOOKING}`);
    expect(booking[0]!["escrow_status"]).toBe("refunded");
    expect((await rowOf(id))["status"]).toBe("completed");
  });

  it("branding order: completion is record-only (the goods side was the human's call)", async () => {
    const { id } = await seedParked({
      rail: "branding_order",
      userId: BUYER,
      sessionId: "cs_brand_1",
      details: { brandingOrderId: "ord_1" },
    });

    const out = await resolvePaymentReversal({
      reversalId: id, decision: "complete",
      adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "Order never printed; goods side clear.",
    });

    expect(out.outcome).toBe("resolved");
    const row = await rowOf(id);
    expect(row["status"]).toBe("completed");
    expect(row["entitlement_revoked"]).toBe(false);
    expect(await resolutionsFor(id)).toHaveLength(1);
  });

  it("unidentified charge: completion records the human's external reconciliation", async () => {
    const { id } = await seedParked({ rail: "unidentified" });

    const out = await resolvePaymentReversal({
      reversalId: id, decision: "complete",
      adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "Found in Stripe; refunded by hand.",
    });

    expect(out.outcome).toBe("resolved");
    expect((await rowOf(id))["status"]).toBe("completed");
    expect(await resolutionsFor(id)).toHaveLength(1);
  });
});

describe("resolvePaymentReversal — dismiss moves no money", () => {
  it("lands 'dismissed', leaves the escrow funded, writes the audit row", async () => {
    await seedSponsorEscrowFunded(true);
    const { id } = await seedParked({
      rail: "sponsor_deal",
      sessionId: "cs_deal_1",
      details: { dealId: DEAL, escrowStatus: "funded", payoutId: "po_1", payoutStatus: "released" },
    });

    const out = await resolvePaymentReversal({
      reversalId: id, decision: "dismiss",
      adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "Refund was issued in error; charge re-ran.",
    });

    expect(out.outcome).toBe("resolved");
    const row = await rowOf(id);
    expect(row["status"]).toBe("dismissed");
    expect(row["entitlement_revoked"]).toBe(false);
    expect(row["seller_reversed"]).toBe(false);
    const deal = await q(sql`SELECT escrow_status FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(deal[0]!["escrow_status"]).toBe("funded");
    const audit = await resolutionsFor(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ decision: "dismiss", note: "Refund was issued in error; charge re-ran." });
  });
});

describe("resolvePaymentReversal — exactly-once", () => {
  it("double-resolve race: one decision lands, the other conflicts, legs run once", async () => {
    await seedSponsorEscrowFunded(true);
    const { id } = await seedParked({
      rail: "sponsor_deal",
      sessionId: "cs_deal_1",
      details: { dealId: DEAL, escrowStatus: "funded", payoutId: "po_1", payoutStatus: "released" },
    });

    const [a, b] = await Promise.all([
      resolvePaymentReversal({ reversalId: id, decision: "complete", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "go" }),
      resolvePaymentReversal({ reversalId: id, decision: "dismiss", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "no" }),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["conflict", "resolved"]);
    expect(await resolutionsFor(id)).toHaveLength(1);
    const row = await rowOf(id);
    const audit = await resolutionsFor(id);
    /* The row's landed status agrees with the ONE recorded decision. */
    expect(row["status"]).toBe(audit[0]!["decision"] === "complete" ? "completed" : "dismissed");
  });

  it("retry of the same decision reads the recorded outcome back and never re-executes", async () => {
    await seedSponsorEscrowFunded(true);
    const { id } = await seedParked({
      rail: "sponsor_deal",
      sessionId: "cs_deal_1",
      details: { dealId: DEAL, escrowStatus: "funded", payoutId: "po_1", payoutStatus: "released" },
    });

    const first = await resolvePaymentReversal({
      reversalId: id, decision: "complete", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "go",
    });
    expect(first.outcome).toBe("resolved");

    const retry = await resolvePaymentReversal({
      reversalId: id, decision: "complete", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "go",
    });
    expect(retry.outcome).toBe("already_resolved");
    if (retry.outcome === "already_resolved") {
      expect(retry.resolution.id).toBe(
        first.outcome === "resolved" ? first.resolution.id : "",
      );
    }
    expect(await resolutionsFor(id)).toHaveLength(1);

    const other = await resolvePaymentReversal({
      reversalId: id, decision: "dismiss", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "changed my mind",
    });
    expect(other.outcome).toBe("conflict");
    expect(await resolutionsFor(id)).toHaveLength(1);
  });

  it("a dismissed row: same-decision retry is already_resolved, the opposite decision conflicts", async () => {
    const { id } = await seedParked({ rail: "unidentified" });
    await resolvePaymentReversal({
      reversalId: id, decision: "dismiss", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "reviewed",
    });
    const retry = await resolvePaymentReversal({
      reversalId: id, decision: "dismiss", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "reviewed",
    });
    expect(retry.outcome).toBe("already_resolved");
    const flip = await resolvePaymentReversal({
      reversalId: id, decision: "complete", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "actually reverse it",
    });
    expect(flip.outcome).toBe("conflict");
    expect((await rowOf(id))["status"]).toBe("dismissed");
  });

  it("non-parked rows conflict and a missing row is not_found — nothing is written", async () => {
    const processing = await seedParked({ rail: "unidentified", status: "processing" });
    const out1 = await resolvePaymentReversal({
      reversalId: processing.id, decision: "complete", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "x",
    });
    expect(out1.outcome).toBe("conflict");
    expect(await resolutionsFor(processing.id)).toHaveLength(0);

    const missing = await resolvePaymentReversal({
      reversalId: randomUUID(), decision: "dismiss", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "x",
    });
    expect(missing.outcome).toBe("not_found");
  });

  it("a stale audit row from a crashed resolve is reclaimed; a fresh one conflicts", async () => {
    const { id, chargeId } = await seedParked({ rail: "unidentified" });
    const staleAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await q(sql`
      INSERT INTO payment_reversal_resolutions (reversal_id, stripe_charge_id, decision, admin_email, note, created_at)
      VALUES (${id}, ${chargeId}, 'complete', ${ADMIN_EMAIL}, 'crashed attempt', ${staleAt})
    `);
    const out = await resolvePaymentReversal({
      reversalId: id, decision: "dismiss", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "real decision",
    });
    expect(out.outcome).toBe("resolved");
    const audit = await resolutionsFor(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ decision: "dismiss", note: "real decision" });

    const second = await seedParked({ rail: "unidentified" });
    await q(sql`
      INSERT INTO payment_reversal_resolutions (reversal_id, stripe_charge_id, decision, admin_email, note)
      VALUES (${second.id}, ${second.chargeId}, 'complete', ${ADMIN_EMAIL}, 'in flight')
    `);
    const blocked = await resolvePaymentReversal({
      reversalId: second.id, decision: "dismiss", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "mine",
    });
    expect(blocked.outcome).toBe("conflict");
    expect((await rowOf(second.id))["status"]).toBe("needs_manual_review");
  });

  it("a parked row carrying granted credits is refused — the claw leg is the engine's", async () => {
    const { id } = await seedParked({ rail: "credit_pack", grantedCredits: 5000, userId: BUYER });
    const out = await resolvePaymentReversal({
      reversalId: id, decision: "complete", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "x",
    });
    expect(out.outcome).toBe("conflict");
    expect((await rowOf(id))["status"]).toBe("needs_manual_review");
    expect(await resolutionsFor(id)).toHaveLength(0);
  });
});

describe("resolvePaymentReversal — the engine reopens a dismissal on new facts", () => {
  it("dismissed sponsor row + payout record gone + replayed event → the engine completes it", async () => {
    await seedSponsorEscrowFunded(true);
    const { id, chargeId } = await seedParked({
      rail: "sponsor_deal",
      sessionId: "cs_deal_1",
      details: { dealId: DEAL, escrowStatus: "funded", payoutId: "po_1", payoutStatus: "released" },
    });
    const dismissed = await resolvePaymentReversal({
      reversalId: id, decision: "dismiss", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL,
      note: "Payout row made this look settled.",
    });
    expect(dismissed.outcome).toBe("resolved");

    /* The facts change: the payout record is corrected away, and the
       refund event replays — identification now succeeds as
       auto-reversible, so the engine reclaims the dismissed row. */
    await q(sql`DELETE FROM sponsor_payouts WHERE deal_id = ${DEAL}`);
    sessionsByPi.set("pi_park", [{ id: "cs_deal_1", metadata: { sponsor_deal_id: DEAL } }]);
    const charge: ReversalCharge = {
      id: chargeId, paymentIntentId: "pi_park", amountCents: 5000, refundedCents: 5000, currency: "usd",
    };
    const out = await processChargeReversal({
      stripe: stripeFake, eventId: "evt_replay", trigger: "charge.refunded", charge,
    });

    expect(out.outcome).toBe("reversed");
    const row = await rowOf(id);
    expect(row["status"]).toBe("completed");
    expect(row["entitlement_revoked"]).toBe(true);
    const deal = await q(sql`SELECT escrow_status FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(deal[0]!["escrow_status"]).toBe("unfunded");
    /* The dismissal is still on the audit trail — history is kept. */
    const audit = await resolutionsFor(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!["decision"]).toBe("dismiss");
  });
});

describe("admin readback — resolutions ride the bench rows", () => {
  it("list + single read carry the recorded decision; unresolved rows carry none", async () => {
    const parked = await seedParked({ rail: "unidentified" });
    const done = await seedParked({ rail: "unidentified" });
    await resolvePaymentReversal({
      reversalId: done.id, decision: "complete", adminUserId: ADMIN_ID, adminEmail: ADMIN_EMAIL, note: "handled",
    });

    const list = await listPaymentReversals(10);
    const doneRow = list.find((r) => r["id"] === done.id)!;
    expect(doneRow["resolution_decision"]).toBe("complete");
    expect(doneRow["resolution_admin_email"]).toBe(ADMIN_EMAIL);
    expect(doneRow["resolution_note"]).toBe("handled");
    const parkedRow = list.find((r) => r["id"] === parked.id)!;
    expect(parkedRow["resolution_id"]).toBeNull();

    const single = await getPaymentReversal(done.id);
    expect(single?.["resolution_decision"]).toBe("complete");
    expect(await getPaymentReversal(randomUUID())).toBeNull();
  });
});
