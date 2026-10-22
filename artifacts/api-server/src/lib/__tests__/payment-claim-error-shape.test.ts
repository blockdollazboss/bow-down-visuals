/**
 * payment-claim-error-shape.test.ts — D6: insert-first claiming must
 * recognize a Postgres unique-violation in the shape production
 * actually produces.
 *
 * The bug (live, Oct 21 2026, payments Phase B): claimStripePayment
 * detected the stripe_payments.stripe_session_id conflict by checking
 * `err.code === "23505"` on the top-level error only. But @workspace/db
 * runs drizzle-orm/node-postgres, whose session wraps EVERY driver
 * error in a DrizzleQueryError ("Failed query: <sql>\nparams: …") —
 * the pg error carrying `.code` sits on `.cause`, and the wrapper has
 * no `.code`. Detection therefore never fired in production:
 *
 *   - webhook granted first → the dashboard's /checkout/verify insert
 *     collided, was rethrown, and the member saw the lying banner
 *     "Credits verified but could not be applied: Failed query: insert
 *     into stripe_payments …" for credits that HAD landed;
 *   - verify granted first → the webhook's claim rethrew the same way
 *     and Stripe recorded 500 "Credit grant failed" deliveries.
 *
 * The older webhook tests missed it because their fake DB throws the
 * PLAIN shape ({ code: "23505" } on the Error itself). This suite's
 * fake throws the WRAPPED production shape by default and pins every
 * interleaving against it:
 *
 *   - webhook-then-verify and verify-then-webhook: exactly one grant,
 *     the second fulfill reports "duplicate" (never throws);
 *   - duplicate verify: duplicate, still one grant;
 *   - fresh "processing" row: "inflight", no grant;
 *   - stale "processing" / "failed" rows: reclaimed, one grant;
 *   - grant failure marks the row failed and a retry grants once;
 *   - a NON-unique DB failure still fails closed (throws, no grant);
 *   - the legacy plain shape keeps working.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── Production-shaped errors ────────────────────────────────────────
   DrizzleQueryError (drizzle-orm 0.45.x, pg-core/session.js): message
   is `Failed query: ${query}\nparams: ${params}`, the pg error is on
   `.cause`, and there is NO `.code` on the wrapper. */
function pgError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function wrappedUniqueViolation(): Error {
  const wrapped = new Error(
    'Failed query: insert into "stripe_payments" ("stripe_session_id", "stripe_payment_intent_id", "user_id", "credit_pack", "credits_amount", "amount_total", "currency", "status") values ($1, $2, $3, $4, $5, $6, $7, $8)\nparams: cs_test_x,pi_x',
  ) as Error & { cause?: unknown };
  wrapped.cause = pgError(
    "23505",
    'duplicate key value violates unique constraint "stripe_payments_stripe_session_id_key"',
  );
  return wrapped;
}

function plainUniqueViolation(): Error {
  return pgError(
    "23505",
    'duplicate key value violates unique constraint "stripe_payments_stripe_session_id_key"',
  );
}

function wrappedConnectionFailure(): Error {
  const wrapped = new Error(
    'Failed query: insert into "stripe_payments" (...) values (...)\nparams: cs_test_x',
  ) as Error & { cause?: unknown };
  wrapped.cause = pgError("08006", "connection failure");
  return wrapped;
}

/* ── Hoisted fake @workspace/db (same kit as stripe-webhook-branding) */
const h = vi.hoisted(() => {
  interface PaymentRow {
    id: string;
    stripeSessionId: string;
    stripePaymentIntentId: string | null;
    userId: string;
    creditPack: string | null;
    creditsAmount: number;
    amountTotal: number | null;
    currency: string | null;
    status: string;
    createdAt: Date;
  }
  const state = {
    rows: new Map<string, PaymentRow>(),
    seq: 0,
    conflictShape: "wrapped" as "wrapped" | "plain",
    insertError: null as Error | null,
    grantCalls: 0,
    grantSuccesses: 0,
    grantFails: false,
    balance: 0,
  };

  function extractParams(node: unknown): { strings: string[]; dates: Date[] } {
    const out = { strings: [] as string[], dates: [] as Date[] };
    const seen = new Set<unknown>();
    const walk = (n: unknown): void => {
      if (!n || typeof n !== "object" || seen.has(n)) return;
      seen.add(n);
      if (n instanceof Date) {
        out.dates.push(n);
        return;
      }
      for (const v of Object.values(n as Record<string, unknown>)) {
        if (typeof v === "string") out.strings.push(v);
        else if (v instanceof Date) out.dates.push(v);
        else if (v && typeof v === "object") walk(v);
      }
    };
    walk(node);
    return out;
  }

  function sessionIdFrom(cond: unknown): string | undefined {
    const { strings } = extractParams(cond);
    return (
      strings.find((s) => state.rows.has(s)) ??
      strings.find((s) => s.startsWith("cs_") || s.startsWith("pi_"))
    );
  }

  function conflictError(): Error {
    // Referenced lazily — the builders live outside the hoisted block,
    // so the fake reads them off globalThis (set by the test module).
    const g = globalThis as unknown as {
      __bdvWrappedUniqueViolation: () => Error;
      __bdvPlainUniqueViolation: () => Error;
    };
    return state.conflictShape === "wrapped"
      ? g.__bdvWrappedUniqueViolation()
      : g.__bdvPlainUniqueViolation();
  }

  const db = {
    insert: (_table: unknown) => ({
      values: async (vals: Record<string, unknown>) => {
        if (state.insertError) throw state.insertError;
        const sid = vals["stripeSessionId"] as string;
        if (state.rows.has(sid)) throw conflictError();
        state.rows.set(sid, {
          id: `pay_${++state.seq}`,
          stripeSessionId: sid,
          stripePaymentIntentId: (vals["stripePaymentIntentId"] as string | null) ?? null,
          userId: vals["userId"] as string,
          creditPack: (vals["creditPack"] as string | null) ?? null,
          creditsAmount: vals["creditsAmount"] as number,
          amountTotal: (vals["amountTotal"] as number | null) ?? null,
          currency: (vals["currency"] as string | null) ?? null,
          status: vals["status"] as string,
          createdAt: new Date(),
        });
        return [];
      },
    }),
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (cond: unknown) => ({
          limit: async (_n: number) => {
            const sid = sessionIdFrom(cond);
            const row = sid ? state.rows.get(sid) : undefined;
            return row ? [row] : [];
          },
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (setValues: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const sid = sessionIdFrom(cond);
          const row = sid ? state.rows.get(sid) : undefined;
          let matched: PaymentRow | undefined;
          if (row) {
            const { strings, dates } = extractParams(cond);
            const isReclaim =
              strings.includes("failed") && strings.includes("processing") && dates.length > 0;
            const applies = isReclaim
              ? row.status === "failed" ||
                (row.status === "processing" && row.createdAt < dates[0]!)
              : true;
            if (applies) {
              Object.assign(row, setValues);
              matched = row;
            }
          }
          const p = Promise.resolve(matched ? [matched] : []) as Promise<PaymentRow[]> & {
            returning: (_f?: unknown) => Promise<Array<{ id: string }>>;
          };
          p.returning = async () => (matched ? [{ id: matched.id }] : []);
          return p;
        },
      }),
    }),
  };

  return { state, db };
});

(globalThis as unknown as Record<string, unknown>)["__bdvWrappedUniqueViolation"] =
  wrappedUniqueViolation;
(globalThis as unknown as Record<string, unknown>)["__bdvPlainUniqueViolation"] =
  plainUniqueViolation;

vi.mock("@workspace/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/db")>();
  return { ...real, db: h.db };
});

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
  addCreditsAtomic: vi.fn(async (_userId: string, amount: number) => {
    h.state.grantCalls++;
    if (h.state.grantFails) throw new Error("supabase down (fake)");
    h.state.grantSuccesses++;
    h.state.balance += amount;
    return { newCredits: h.state.balance };
  }),
}));

import {
  claimStripePayment,
  fulfillCreditPurchase,
  getStripePaymentStatus,
  isUniqueViolation,
} from "../payment-record";

const USER_ID = "1596b9a1-bbd0-4bda-8bf2-a22443e6ace8";
const SESSION_ID = "cs_test_d6_interleave";

function purchase(sessionId = SESSION_ID) {
  return {
    idempotencyKey: sessionId,
    stripePaymentIntentId: "pi_d6",
    userId: USER_ID,
    creditPack: "1,000 Visual Bucs",
    creditsAmount: 1000,
    amountTotal: 900,
    currency: "usd",
  };
}

function seedRow(status: string, createdAt: Date, sessionId = SESSION_ID) {
  h.state.rows.set(sessionId, {
    id: "pay_seed",
    stripeSessionId: sessionId,
    stripePaymentIntentId: "pi_d6",
    userId: USER_ID,
    creditPack: "1,000 Visual Bucs",
    creditsAmount: 1000,
    amountTotal: 900,
    currency: "usd",
    status,
    createdAt,
  });
}

beforeEach(() => {
  h.state.rows.clear();
  h.state.seq = 0;
  h.state.conflictShape = "wrapped";
  h.state.insertError = null;
  h.state.grantCalls = 0;
  h.state.grantSuccesses = 0;
  h.state.grantFails = false;
  h.state.balance = 0;
});

describe("isUniqueViolation — error-shape detection", () => {
  it("detects the plain shape (code on the error itself)", () => {
    expect(isUniqueViolation(plainUniqueViolation())).toBe(true);
  });

  it("detects the production shape (DrizzleQueryError wrapper, code on .cause)", () => {
    const err = wrappedUniqueViolation();
    expect((err as { code?: string }).code).toBeUndefined();
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("detects a double-wrapped violation", () => {
    const outer = new Error("outer") as Error & { cause?: unknown };
    outer.cause = wrappedUniqueViolation();
    expect(isUniqueViolation(outer)).toBe(true);
  });

  it("does not match other Postgres errors, wrapped or not", () => {
    expect(isUniqueViolation(wrappedConnectionFailure())).toBe(false);
    expect(isUniqueViolation(pgError("23503", "foreign key"))).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe("fulfillCreditPurchase interleavings (production wrapped error shape)", () => {
  it("webhook first, verify second: duplicate, exactly one grant, no throw", async () => {
    const first = await fulfillCreditPurchase(purchase());
    expect(first.outcome).toBe("granted");
    const second = await fulfillCreditPurchase(purchase());
    expect(second.outcome).toBe("duplicate");
    expect(h.state.grantSuccesses).toBe(1);
    expect(h.state.balance).toBe(1000);
  });

  it("verify first, webhook second: duplicate, exactly one grant, no throw", async () => {
    // Both production paths call this same funnel; the order labels are
    // the two arrival orders seen live. The second arrival must be a
    // duplicate — the webhook maps it to 200, verify to success.
    const first = await fulfillCreditPurchase(purchase());
    expect(first.outcome).toBe("granted");
    const second = await fulfillCreditPurchase(purchase());
    expect(second.outcome).toBe("duplicate");
    expect(h.state.grantSuccesses).toBe(1);
  });

  it("duplicate verify (member refreshes): granted once, then duplicate", async () => {
    await fulfillCreditPurchase(purchase());
    const again = await fulfillCreditPurchase(purchase());
    const andAgain = await fulfillCreditPurchase(purchase());
    expect(again.outcome).toBe("duplicate");
    expect(andAgain.outcome).toBe("duplicate");
    expect(h.state.grantSuccesses).toBe(1);
  });

  it("fresh processing claim (concurrent winner still granting): inflight, no grant", async () => {
    seedRow("processing", new Date());
    const result = await fulfillCreditPurchase(purchase());
    expect(result.outcome).toBe("inflight");
    expect(h.state.grantCalls).toBe(0);
  });

  it("stale processing claim (crashed winner): reclaimed, granted exactly once", async () => {
    seedRow("processing", new Date(Date.now() - 10 * 60 * 1000));
    const result = await fulfillCreditPurchase(purchase());
    expect(result.outcome).toBe("granted");
    expect(h.state.grantSuccesses).toBe(1);
    await expect(getStripePaymentStatus(SESSION_ID)).resolves.toBe("completed");
  });

  it("failed claim (earlier grant attempt died): reclaimed, granted exactly once", async () => {
    seedRow("failed", new Date());
    const result = await fulfillCreditPurchase(purchase());
    expect(result.outcome).toBe("granted");
    expect(h.state.grantSuccesses).toBe(1);
  });

  it("grant failure marks failed; Stripe-style retry reclaims and grants exactly once", async () => {
    h.state.grantFails = true;
    await expect(fulfillCreditPurchase(purchase())).rejects.toThrow("supabase down");
    await expect(getStripePaymentStatus(SESSION_ID)).resolves.toBe("failed");
    expect(h.state.grantSuccesses).toBe(0);

    h.state.grantFails = false;
    const retry = await fulfillCreditPurchase(purchase());
    expect(retry.outcome).toBe("granted");
    expect(h.state.grantSuccesses).toBe(1);
    expect(h.state.balance).toBe(1000);
  });

  it("non-unique insert failure fails closed: throws, no grant, no row", async () => {
    h.state.insertError = wrappedConnectionFailure();
    await expect(fulfillCreditPurchase(purchase())).rejects.toThrow("Failed query");
    expect(h.state.grantCalls).toBe(0);
    await expect(getStripePaymentStatus(SESSION_ID)).resolves.toBeNull();
  });

  it("legacy plain error shape still resolves duplicates", async () => {
    h.state.conflictShape = "plain";
    const first = await fulfillCreditPurchase(purchase());
    expect(first.outcome).toBe("granted");
    const second = await fulfillCreditPurchase(purchase());
    expect(second.outcome).toBe("duplicate");
    expect(h.state.grantSuccesses).toBe(1);
  });
});

describe("claimStripePayment / getStripePaymentStatus", () => {
  it("claim on an unknown session wins; status reads back through the lifecycle", async () => {
    await expect(getStripePaymentStatus(SESSION_ID)).resolves.toBeNull();
    const claim = await claimStripePayment({
      stripeSessionId: SESSION_ID,
      stripePaymentIntentId: "pi_d6",
      userId: USER_ID,
      creditPack: "1,000 Visual Bucs",
      creditsAmount: 1000,
      amountTotal: 900,
      currency: "usd",
    });
    expect(claim).toBe("claimed");
    await expect(getStripePaymentStatus(SESSION_ID)).resolves.toBe("processing");
  });
});
