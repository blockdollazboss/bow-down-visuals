/**
 * credits-void.test.ts — Lane V3 F1: voidChargeIdempotencyKey.
 *
 * After a refunded charge, the charge's ledger row must stop answering
 * to its idempotency key, or the retry is suppressed as a replay and
 * runs free. Driven against pg-mem through the real credits module
 * (only the balance/ledger side-stores are stubbed — the void itself
 * is pure Render-Postgres work).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

const testState = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});
vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(),
  addCreditsToProfile: vi.fn(async () => {}),
}));
vi.mock("../payment-record", () => ({
  recordCreditUsageStrict: vi.fn(async () => {}),
}));
vi.mock("../teams", () => ({
  getUserActiveTeam: vi.fn(async () => null),
  deductTeamCredits: vi.fn(async () => { throw new Error("unused"); }),
}));

import { voidChargeIdempotencyKey } from "../credits";
import { createTestDb } from "./test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE credit_usage (
  id uuid PRIMARY KEY,
  user_id uuid,
  action text,
  credits_used integer,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credit_usage_idem_uidx ON credit_usage (idempotency_key);
`;

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.none(DDL);
  testState.db = db;
});

async function insertCharge(key: string): Promise<string> {
  const id = randomUUID();
  await testState.db.execute(sql`
    INSERT INTO credit_usage (id, user_id, action, credits_used, idempotency_key)
    VALUES (${id}, ${randomUUID()}, ${"AI Background Plate"}, ${200}, ${key})`);
  return id;
}
async function keyOf(id: string): Promise<string | null> {
  const r = await testState.db.execute(sql`SELECT idempotency_key FROM credit_usage WHERE id = ${id}`);
  return (r.rows[0] as { idempotency_key: string | null }).idempotency_key;
}

describe("voidChargeIdempotencyKey (Lane V3 F1)", () => {
  it("nulls the key on the charge row — the row itself survives for audit", async () => {
    const id = await insertCharge("bg-generate:user-1:client:attempt-1");
    expect(await voidChargeIdempotencyKey("bg-generate:user-1:client:attempt-1")).toBe(true);
    expect(await keyOf(id)).toBeNull();
  });

  it("a voided key can be charged again under the same key (unique index admits the new row)", async () => {
    await insertCharge("bg-generate:user-1:client:attempt-2");
    await voidChargeIdempotencyKey("bg-generate:user-1:client:attempt-2");
    const second = await insertCharge("bg-generate:user-1:client:attempt-2");
    expect(await keyOf(second)).toBe("bg-generate:user-1:client:attempt-2");
  });

  it("voiding an unknown key reports false and touches nothing", async () => {
    const id = await insertCharge("bg-generate:user-1:client:attempt-3");
    expect(await voidChargeIdempotencyKey("bg-generate:user-1:client:other")).toBe(false);
    expect(await keyOf(id)).toBe("bg-generate:user-1:client:attempt-3");
    expect(await voidChargeIdempotencyKey("")).toBe(false);
  });
});
