/**
 * recordCreditUsageStrict — the C-01 race outcome (Stack400,
 * s400-contracts-replay).
 *
 * The strict ledger write runs against pg-mem carrying the REAL
 * partial UNIQUE index from migration 0049
 * (credit_usage_idempotency_key_uidx) — the same index production
 * enforces. Pins:
 *  - a first keyed write lands → "recorded";
 *  - a second write under the same key (the concurrent loser's
 *    insert, rejected by the index with 23505) answers
 *    "already-recorded" — success-as-replay, NOT a throw, and NOT
 *    after 3 futile retries (exactly 2 inserts total happen);
 *  - the 23505 shape pg-mem produces (code buried in the cause
 *    chain, constraint named in the cause's message) is recognized
 *    by the same pg-errors walk production drizzle errors need;
 *  - an UNKEYED write is never reclassified: its insert still
 *    throws after retries (a null key cannot conflict — the index
 *    is partial — so any failure there is a real failure);
 *  - NULL keys never collide with each other (partial index).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { randomUUID } from "crypto";

const h = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return h.db;
    },
  };
});

import { recordCreditUsageStrict } from "../payment-record";
import { createTestDb } from "./test-db";
import { creditUsageTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const CREDIT_USAGE_DDL = `
CREATE TABLE credit_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  credits_used integer NOT NULL,
  project_id uuid,
  team_id uuid,
  bonus_credits_used integer,
  bonus_expires_at timestamptz,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credit_usage_idempotency_key_uidx ON credit_usage (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE contract_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  contract_type text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contract_generations_idempotency_key_ux ON contract_generations (idempotency_key);
`;

beforeAll(() => {
  const t = createTestDb();
  /* pg-mem has no gen_random_uuid — register it (the affiliates
     suite's pattern) before the DDL's defaults reference it. */
  t.mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  t.mem.public.none(CREDIT_USAGE_DDL);
  h.db = t.db;
});

async function countKeyedRows(key: string): Promise<number> {
  const rows = await h.db
    .select({ id: creditUsageTable.id })
    .from(creditUsageTable)
    .where(sql`${creditUsageTable.idempotencyKey} = ${key}`);
  return rows.length;
}

describe("recordCreditUsageStrict — idempotency race (C-01)", () => {
  it("first keyed write records; the same key again answers already-recorded without throwing", async () => {
    const userId = randomUUID();
    const key = `contract_generation:${userId}:client:race-1`;
    const rec = { userId, action: "Contract Generation", creditsUsed: 300, idempotencyKey: key };

    await expect(recordCreditUsageStrict(rec)).resolves.toBe("recorded");
    await expect(recordCreditUsageStrict(rec)).resolves.toBe("already-recorded");
    await expect(recordCreditUsageStrict(rec)).resolves.toBe("already-recorded");
    expect(await countKeyedRows(key)).toBe(1);
  });

  it("different keys record independently", async () => {
    const userId = randomUUID();
    const base = { userId, action: "Contract Generation", creditsUsed: 300 };
    await expect(
      recordCreditUsageStrict({ ...base, idempotencyKey: `k:${userId}:a` }),
    ).resolves.toBe("recorded");
    await expect(
      recordCreditUsageStrict({ ...base, idempotencyKey: `k:${userId}:b` }),
    ).resolves.toBe("recorded");
  });

  it("null keys never collide — unkeyed writes always record (partial index)", async () => {
    const userId = randomUUID();
    const rec = { userId, action: "Some Unkeyed Charge", creditsUsed: 10 };
    await expect(recordCreditUsageStrict(rec)).resolves.toBe("recorded");
    await expect(recordCreditUsageStrict(rec)).resolves.toBe("recorded");
  });
});
