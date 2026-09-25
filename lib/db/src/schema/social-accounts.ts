import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Connected third-party social accounts for auto-posting (Instagram MVP).
   OAuth tokens are stored AES-256-GCM encrypted (see social-crypto.ts) —
   never plaintext, never logged. user_id references the Supabase auth user
   (no DB-level FK: auth lives in Supabase, this table in Render Postgres). */
export const socialAccountsTable = pgTable("social_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  platform: text("platform").notNull().default("instagram"),
  ig_user_id: text("ig_user_id"),
  username: text("username"),
  page_id: text("page_id"),
  access_token_encrypted: text("access_token_encrypted"),
  token_expires_at: timestamp("token_expires_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSocialAccountSchema = createInsertSchema(socialAccountsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertSocialAccount = z.infer<typeof insertSocialAccountSchema>;
export type SocialAccount = typeof socialAccountsTable.$inferSelect;
