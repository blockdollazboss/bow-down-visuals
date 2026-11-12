import { pgTable, text, integer, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Email theme rotation (migration 0338, join21).
 *
 * The durable home for the automatic-email theme rotation —
 * company law (owner, Nov 8, 2026): the site's automatic emails
 * alternate theme BY CUSTOMER in a strict rotation (dark, light,
 * dark, light), and a theme is only "spent" when a send is
 * VERIFIED SENT, so a failed send or a retry keeps its assigned
 * theme.
 *
 * One row per customer, keyed by the normalized recipient address
 * (the rotation module's key — trim + lowercase):
 *
 *   nextTheme  the theme the customer's NEXT verified send carries
 *   sentCount  verified sends recorded for the customer so far
 *   updatedAt  the last recorded flip
 *
 * The api-server reads/writes this table only through the
 * EmailThemeRotationStore seam (lib/email-theme-rotation.ts); the
 * DB-backed implementation lives in lib/email-theme-rotation-db.ts
 * and is plugged in at boot via setEmailThemeRotationStore().
 * Bookkeeping is fail-open: a missing table (migration not yet
 * applied) reads as "no state" and writes no-op, so a lagging
 * database degrades to the in-memory default and can never break
 * or block an email send.
 */

export const EMAIL_THEMES = ["dark", "light"] as const;
export type EmailThemeName = (typeof EMAIL_THEMES)[number];

export const emailThemeRotationTable = pgTable("email_theme_rotation", {
  recipientEmail: text("recipient_email").primaryKey(),
  nextTheme:      text("next_theme").notNull().default("dark"),
  sentCount:      integer("sent_count").notNull().default(0),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("email_theme_rotation_next_theme_check", sql`${t.nextTheme} IN ('dark', 'light')`),
]);

export const insertEmailThemeRotationSchema = createInsertSchema(emailThemeRotationTable);
export type InsertEmailThemeRotation = z.infer<typeof insertEmailThemeRotationSchema>;
export type EmailThemeRotation = typeof emailThemeRotationTable.$inferSelect;
