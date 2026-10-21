import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Loading Screen Takeover — paid 7-day brand placement across the site's
   loading screens (WittyLoader). v1 is lead-capture: an advertiser requests
   the spot, the owner follows up, approves, and schedules. Statuses stay
   honest: "new" → "contacted" → "approved" / "rejected". No charge at
   inquiry time. Mirrors the Spotlight Takeover model (spotlight.ts). */

export const loadingScreenInquiriesTable = pgTable("loading_screen_inquiries", {
  id:        uuid("id").primaryKey().defaultRandom(),
  name:      text("name").notNull(),
  email:     text("email").notNull(),
  videoUrl:  text("video_url").notNull(),
  targetUrl: text("target_url"),
  status:    text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertLoadingScreenInquirySchema = createInsertSchema(loadingScreenInquiriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertLoadingScreenInquiry = z.infer<typeof insertLoadingScreenInquirySchema>;
export type LoadingScreenInquiry = typeof loadingScreenInquiriesTable.$inferSelect;

/* Public offer details — shared by the loader promo and the inquiry modal. */
export const LOADING_SCREEN_OFFER = {
  name: "Loading Screen Takeover",
  priceDollars: 2500,
  durationDays: 7,
  surfaces: ["Loading screens"],
  specs: [
    "Your brand across every loading screen site-wide",
    "1080p image or muted looping video",
    "Your link on the placement click-through",
    "Runs for 7 full days",
  ],
} as const;
