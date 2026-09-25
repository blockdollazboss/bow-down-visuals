import { pgTable, uuid, text, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/* Publish idempotency ledger for social auto-posting (Instagram MVP).
   The client generates one idempotency key per publish intent and sends it
   with POST /social/instagram/publish. The server claims a row for the key
   BEFORE charging credits or calling Meta:

   - new key            → row inserted as `processing`; this request owns the attempt
   - replayed key, row `succeeded` → return the stored result; no re-post, no re-charge
   - replayed key, row `processing` (fresh) → 409 publish_in_progress; the
     first attempt is still running, so the client waits instead of duplicating
   - replayed key, row `failed` → atomically reclaim and retry (credits were
     refunded when it failed, so charging again is correct)
   - replayed key, row `processing` but stale (>30 min, i.e. the process died
     mid-publish) → atomically reclaim and retry. `credits_deducted` tells the
     retry whether the original attempt already charged, so a crash between
     "deduct" and "Meta call" doesn't double-charge.

   user_id references the Supabase auth user (no DB-level FK: auth lives in
   Supabase, this table in Render Postgres). See
   migrations/0003_social_publish_attempts.sql — the schema here must stay in
   sync with it so boot-time `drizzle-kit push` matches the migration. */

export type PublishAttemptStatus = "processing" | "succeeded" | "failed";

/** Stored on success so a replayed key returns the identical response. */
export interface PublishAttemptResult {
  mediaId: string;
  permalink: string | null;
  creditsUsed: number;
  creditsRemaining: number;
}

export const socialPublishAttemptsTable = pgTable(
  "social_publish_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    platform: text("platform").notNull().default("instagram"),
    idempotency_key: text("idempotency_key").notNull(),
    account_id: uuid("account_id"),
    status: text("status").notNull().default("processing").$type<PublishAttemptStatus>(),
    /* True once this attempt's credits were deducted. Lets a reclaimed
       stale-processing attempt skip the deduction instead of charging twice. */
    credits_deducted: boolean("credits_deducted").notNull().default(false),
    result: jsonb("result").$type<PublishAttemptResult | null>(),
    error: text("error"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("social_publish_attempts_user_key_ux").on(t.user_id, t.idempotency_key),
    index("social_publish_attempts_user_id_idx").on(t.user_id),
  ],
);

export type SocialPublishAttempt = typeof socialPublishAttemptsTable.$inferSelect;
