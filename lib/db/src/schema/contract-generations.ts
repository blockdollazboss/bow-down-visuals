import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * Contract-generation stored results (migration 0329, stack400
 * s400-contracts-replay — census C-02/C-33).
 *
 * One row per PAID generation intent, keyed by the charge's
 * idempotency key (UNIQUE) — the same key the credit ledger dedups
 * on. The contract rail writes the response it served (generation
 * title/draft/summary + the deal snapshot it answered) the moment a
 * generation succeeds; a replayed submit under the same key is then
 * answered from this row instead of calling the provider again, so
 * one paid intent always returns ONE draft — the draft the member
 * reviewed first — and never burns a second provider call.
 *
 * A refunded failure voids the ledger key, and the rail only writes
 * this row after a success, so a key present here always belongs to
 * a live, paid charge: a genuinely new ask (fresh key, or a key
 * whose failure was voided) still charges and generates fresh.
 */
export const contractGenerationsTable = pgTable(
  "contract_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    contractType: text("contract_type").notNull(),
    result: jsonb("result").notNull().$type<{
      generation: { title: string; draft: string; summary: string };
      contractType: string;
      creditsCharged: number;
      disclaimer: string;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("contract_generations_idempotency_key_ux").on(t.idempotencyKey),
    index("contract_generations_user_idx").on(t.userId),
  ],
);
