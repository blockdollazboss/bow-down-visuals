import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Spotlight Takeover — paid 7-day video-background slot on the sign-in /
   sign-up screens. v1 is lead-capture: an advertiser requests the spot,
   the owner follows up, approves, and schedules. Statuses stay honest:
   "new" → "contacted" → "approved" / "rejected". No charge at inquiry time. */

export const spotlightInquiriesTable = pgTable("spotlight_inquiries", {
  id:        uuid("id").primaryKey().defaultRandom(),
  name:      text("name").notNull(),
  email:     text("email").notNull(),
  videoUrl:  text("video_url").notNull(),
  targetUrl: text("target_url"),
  status:    text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertSpotlightInquirySchema = createInsertSchema(spotlightInquiriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSpotlightInquiry = z.infer<typeof insertSpotlightInquirySchema>;
export type SpotlightInquiry = typeof spotlightInquiriesTable.$inferSelect;

/* Public offer details — shared by the promo overlay and the inquiry modal. */
export const SPOTLIGHT_OFFER = {
  name: "Spotlight Takeover",
  priceDollars: 1000,
  durationDays: 7,
  surfaces: ["Sign-in screen", "Sign-up screen"],
  specs: [
    "Full-screen muted looping video background",
    "1080p MP4, up to 30 seconds",
    "Your link on the “Ad” badge click-through",
    "Runs on both the sign-in and sign-up screens",
  ],
} as const;
