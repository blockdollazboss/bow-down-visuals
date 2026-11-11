/**
 * credits-guaranteed-refund.test.ts — the charge-on-failure lane's
 * primitives (Nov 11 $0 probe fallout).
 *
 * The probe caught a Background Removal charge whose refund was
 * wrapped in .catch(() => {}): the refund failed, nobody knew, the
 * charge stood. refundCreditsGuaranteed is the non-swallowing form:
 * retry exactly once, void the charge's key ONLY when the refund
 * landed, and report honestly (boolean) when it could not land.
 * findChargeAmountByKey lets a composed flow (photo-backdrop)
 * reverse a prep charge by the amount the ledger actually recorded.
 *
 * Driven against pg-mem through the real credits module; only the
 * side-stores are stubbed (the profile restore is the controllable
 * failure point — the ledger lookups and the void run for real).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

const testState = vi.hoisted(() => ({
  db: null as any,
  restoreAttempts: 0,
  restoreFailuresRemaining: 0,
  restored: [] as number[],
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});
vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(),
  addCreditsToProfile: vi.fn(async (_userId: string, amount: number) => {
    testState.restoreAttempts++;
    if (testState.restoreFailuresRemaining > 0) {
      testState.restoreFailuresRemaining--;
      throw new Error("simulated profile restore failure");
    }
    testState.restored.push(amount);
  }),
}));
vi.mock("../payment-record", () => ({
  recordCreditUsageStrict: vi.fn(async () => {}),
}));
vi.mock("../teams", () => ({
  getUserActiveTeam: vi.fn(async () => null),
  deductTeamCredits: vi.fn(async () => { throw new Error("unused"); }),
}));

import { refundCreditsGuaranteed, findChargeAmountByKey } from "../credits";
import { createTestDb } from "./test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE credit_usage (
  id uuid PRIMARY KEY,
  user_id uuid,
  action text,
  credits_used integer,
  bonus_credits_used integer,
  bonus_expires_at timestamptz,
  team_id uuid,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credit_usage_idem_uidx ON credit_usage (idempotency_key);
`;

const USER = randomUUID();
const PREP_KEY = `background-removal:${USER}:client:prep-1`;

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.none(DDL);
  testState.db = db;
  testState.restoreAttempts = 0;
  testState.restoreFailuresRemaining = 0;
  testState.restored = [];
});

async function insertCharge(key: string, amount = 200, action = "Background Removal"): Promise<void> {
  await testState.db.execute(sql`
    INSERT INTO credit_usage (id, user_id, action, credits_used, idempotency_key)
    VALUES (${randomUUID()}, ${USER}, ${action}, ${amount}, ${key})`);
}
async function keyStillLanded(key: string): Promise<boolean> {
  const r = await testState.db.execute(sql`SELECT id FROM credit_usage WHERE idempotency_key = ${key}`);
  return r.rows.length > 0;
}

describe("refundCreditsGuaranteed", () => {
  it("lands the refund and voids the key — zero net charge", async () => {
    await insertCharge("photo-backdrop:user:client:attempt-1", 100, "Photo AI Backdrop");
    const ok = await refundCreditsGuaranteed(USER, 100, { action: "Photo AI Backdrop — Refund" }, { idempotencyKey: "photo-backdrop:user:client:attempt-1" });
    expect(ok).toBe(true);
    expect(testState.restored).toEqual([100]);
    expect(testState.restoreAttempts).toBe(1);
    expect(await keyStillLanded("photo-backdrop:user:client:attempt-1")).toBe(false);
  });

  it("a refund that fails once still zeroes the charge via the single retry", async () => {
    await insertCharge(PREP_KEY);
    testState.restoreFailuresRemaining = 1;
    const ok = await refundCreditsGuaranteed(USER, 200, { action: "Background Removal — Refund" }, { idempotencyKey: PREP_KEY });
    expect(ok).toBe(true);
    expect(testState.restoreAttempts).toBe(2); // retried exactly once
    expect(testState.restored).toEqual([200]); // restored exactly once
    expect(await keyStillLanded(PREP_KEY)).toBe(false);
  });

  it("a refund that cannot land reports false and does NOT void the key", async () => {
    await insertCharge(PREP_KEY);
    testState.restoreFailuresRemaining = 99;
    const ok = await refundCreditsGuaranteed(USER, 200, { action: "Background Removal — Refund" }, { idempotencyKey: PREP_KEY });
    expect(ok).toBe(false);
    expect(testState.restoreAttempts).toBe(2); // one attempt + exactly one retry, no more
    expect(testState.restored).toEqual([]);
    /* The key stays landed: the member's retry re-runs against the
       standing charge instead of double-charging or running free. */
    expect(await keyStillLanded(PREP_KEY)).toBe(true);
  });

  it("works without a key (beats-style call sites): refund lands, nothing to void", async () => {
    const ok = await refundCreditsGuaranteed(USER, 300, { action: "Beat — Refund" });
    expect(ok).toBe(true);
    expect(testState.restored).toEqual([300]);
  });
});

describe("findChargeAmountByKey + the prep unwind composition", () => {
  it("reads the landed charge's real amount; unknown keys read null", async () => {
    await insertCharge(PREP_KEY, 200);
    expect(await findChargeAmountByKey(PREP_KEY)).toEqual({ creditsUsed: 200, teamId: null });
    expect(await findChargeAmountByKey("background-removal:nobody:client:nope")).toBeNull();
    expect(await findChargeAmountByKey("")).toBeNull();
  });

  it("the unwind is exactly-once: after it lands, the key reads null and a repeat unwind is skipped", async () => {
    await insertCharge(PREP_KEY, 200);
    const first = await findChargeAmountByKey(PREP_KEY);
    expect(first?.creditsUsed).toBe(200);
    const unwound = await refundCreditsGuaranteed(USER, first!.creditsUsed, { action: "Background Removal — Refund" }, { idempotencyKey: PREP_KEY });
    expect(unwound).toBe(true);
    expect(testState.restored).toEqual([200]);
    /* A second failure carrying the same prep key finds nothing landed. */
    expect(await findChargeAmountByKey(PREP_KEY)).toBeNull();
  });
});
