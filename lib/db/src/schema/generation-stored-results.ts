import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * Generation stored results (migration 0333, stack400
 * s400-stored-results — the s400-ca-weak-keys lane's named follow-on).
 *
 * One row per PAID generation intent, keyed by the charge's
 * idempotency key (UNIQUE) — the same key the credit ledger dedups
 * on. Generalized from the contract rail's contract_generations
 * (0329) / post-assist's post_assist_results (0330) shape: the
 * `rail` column names the writing rail ("bg-generate",
 * "thumbnail-generator", "bio-generator") and is verified on read.
 *
 * Each rail writes the response payload it served the moment a
 * generation succeeds; a replayed ask under the same key — including
 * after a server restart, where the rails' in-process stores are
 * empty — is answered from this row instead of running the provider
 * again, so one paid intent always returns the result the member
 * got first, and a restart can never turn a replay into a free
 * regeneration.
 *
 * A refunded failure voids the ledger key, and the rails only write
 * this row after a success, so a key present here always belongs to
 * a live, paid charge: a genuinely new ask (fresh key, or a key
 * whose failure was voided) still charges and generates fresh.
 */
export const generationStoredResultsTable = pgTable(
  "generation_stored_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    rail: text("rail").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    result: jsonb("result").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("generation_stored_results_idempotency_key_ux").on(t.idempotencyKey),
    index("generation_stored_results_user_idx").on(t.userId),
  ],
);
