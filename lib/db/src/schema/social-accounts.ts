import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Connected third-party social accounts for auto-posting (Instagram MVP,
   TikTok drafts tier, Facebook Pages). OAuth tokens are stored AES-256-GCM encrypted (see
   social-crypto.ts) — never plaintext, never logged. user_id references the
   Supabase auth user (no DB-level FK: auth lives in Supabase, this table in
   Render Postgres).
   provider_user_id is the platform-agnostic account id (IG user id for
   Instagram, open_id for TikTok); ig_user_id is kept for the Instagram flow.
   Indexes mirror migrations/0002_social_accounts.sql so boot-time
   `drizzle-kit push` on a fresh DB creates exactly what the migration does —
   the unique index is what the connect upsert's ON CONFLICT arbiter needs. */
export const socialAccountsTable = pgTable(
  "social_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    platform: text("platform").notNull().default("instagram"),
    ig_user_id: text("ig_user_id"),
    provider_user_id: text("provider_user_id"),
    username: text("username"),
    page_id: text("page_id"),
    page_name: text("page_name"),
    access_token_encrypted: text("access_token_encrypted"),
    refresh_token_encrypted: text("refresh_token_encrypted"),
    token_expires_at: timestamp("token_expires_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("social_accounts_user_id_idx").on(t.user_id),
    uniqueIndex("social_accounts_user_platform_ig_idx").on(t.user_id, t.platform, t.ig_user_id),
    /* Cross-platform one-row-per-account guard: TikTok rows key on
       provider_user_id (open_id), Instagram rows on ig_user_id. Declared
       here so boot-time drizzle-kit push creates it on fresh DBs — mirrors
       migrations/0007_social_accounts_provider_id.sql. */
    uniqueIndex("social_accounts_user_platform_provider_idx").on(t.user_id, t.platform, t.provider_user_id),
  ],
);

export const insertSocialAccountSchema = createInsertSchema(socialAccountsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertSocialAccount = z.infer<typeof insertSocialAccountSchema>;
export type SocialAccount = typeof socialAccountsTable.$inferSelect;
