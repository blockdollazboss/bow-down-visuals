import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * Post Assist stored results (migration 0330, stack400
 * s400-post-assist — census C-03/C-36). The assist twin of
 * contract-generations (0329): same pattern, its own table, because
 * the stored body is the assist rail's own response shape.
 *
 * One row per PAID assist intent, keyed by the charge idempotency
 * key (UNIQUE) — the same (prompt, tone) hash key the credit ledger
 * and the AI-boost ledger both dedup on. The assist rail writes the
 * response it served (the draft + the boost snapshot it answered
 * with) the moment a generation succeeds; a duplicate submit under
 * the same key — mid-call or long after — is then answered from
 * this row instead of calling the provider again, so one paid
 * intent always returns ONE draft and never burns a second boost,
 * charge, or provider call.
 *
 * A refunded failure restores the funding and voids the ledger key,
 * and the rail only writes this row after a success, so a key
 * present here always belongs to a live, paid intent: a genuinely
 * new ask (fresh words, or a key whose failure was voided) still
 * funds and generates fresh.
 */
export const postAssistResultsTable = pgTable(
  "post_assist_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    result: jsonb("result").notNull().$type<{
      draft: string;
      boost: {
        applied: boolean;
        allowance: number;
        used: number;
        remaining: number;
      } | null;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("post_assist_results_idempotency_key_ux").on(t.idempotencyKey),
    index("post_assist_results_user_idx").on(t.userId),
  ],
);
