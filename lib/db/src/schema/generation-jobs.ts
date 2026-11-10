import { pgTable, text, integer, boolean, jsonb, timestamp, index, primaryKey } from "drizzle-orm/pg-core";

/**
 * Generation durable jobs (migration 0335, lane
 * stack1600/durable-jobs — the generalization of the
 * avatar-presenter durable layer, 0334).
 *
 * One row per in-flight generation job, keyed by (rail, id):
 * `rail` names the writing route module ("audio-cleanup",
 * "media-importer", …) and `id` is that rail's own job id, so the
 * table serves every job-Map rail from one shape. Before 0335,
 * only avatar-presenter had durable job storage; the other
 * long-running generation rails kept their job records ONLY in
 * in-process Maps (2h TTL) — a server restart between submit and
 * completion lost the job entirely: the ledger charge stood
 * (protected by its idempotency key) with no job record left to
 * complete the generation or to refund from.
 *
 * The row mirrors the rail's in-memory job record: the extracted
 * columns (member, status, reserved amount, charge key, the
 * exactly-once refund claim, creation time) carry the queries
 * (lookup by id, TTL sweep by created_at, refund-claim checks),
 * and `payload` carries the rail's full job record as jsonb —
 * everything the rail needs to answer a poll from the record, to
 * resume its worker, or to settle (fail + refund exactly once)
 * after a restart.
 *
 * The refund claim (credits_refunded) is claimed in the row
 * synchronously with the in-memory flag, BEFORE the refund moves
 * — the avatar-presenter rule (0334) — so a replayed or resumed
 * completion can never double-refund.
 *
 * Rails treat this table fail-open, exactly like the
 * stored-result tables (0329 / 0330 / 0333) and avatar's 0334:
 * a missing table or a failed write degrades to the pre-0335
 * in-process behavior and can never error a rail or
 * double-charge.
 */
export const generationJobsTable = pgTable(
  "generation_jobs",
  {
    rail: text("rail").notNull(),
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    status: text("status").notNull(),
    creditsCharged: integer("credits_charged").notNull(),
    chargeKey: text("charge_key"),
    creditsRefunded: boolean("credits_refunded").notNull().default(false),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.rail, t.id] }),
    index("generation_jobs_user_idx").on(t.userId),
    index("generation_jobs_created_idx").on(t.createdAt),
  ],
);
