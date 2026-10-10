// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

export * from "./stripe-payments";
export * from "./social-stat-snapshots";
export * from "./credit-usage";
export * from "./artist-vaults";
export * from "./artist-character-links";
export * from "./generated-clips";
export * from "./project-drafts";
export * from "./generation-history";
export * from "./generations";
export * from "./hub-projects";
export * from "./contact-messages";
export * from "./export-jobs";
export * from "./lip-sync-jobs";
export * from "./job-notifications";
export * from "./songs";
export * from "./albums";
export * from "./social-accounts";
export * from "./social-publish-attempts";
export * from "./locations";
export * from "./artist-outfits";
export * from "./discord";
export * from "./sponsor-deals";
export * from "./distribution-releases";
export * from "./distribution-v2";
export * from "./branding-orders";
export * from "./nfc-cards";
export * from "./bio-pages";
export * from "./jewelry";
export * from "./spotlight";
export * from "./customer-shops";
export * from "./beats";
export * from "./invoices";
export * from "./fan-memberships";
export * from "./press-kits";
export * from "./live-shopping";
export * from "./scheduled-posts";
export * from "./merch";
export * from "./playlist-pitch";
export * from "./label-pitch";
export * from "./sync-pitch";
export * from "./contests";
export * from "./fan-shoutouts";
export * from "./collab";
export * from "./email-lists";
export * from "./royalties";
export * from "./cheat-code-events";
export * from "./tour";
export * from "./preproduction-packs";
export * from "./bow-challenge";
export * from "./teams";
export * from "./hourly-crate-claims";
export * from "./showcase-items";
export * from "./content-plans";
export * from "./voice-personas";
export * from "./voice-clones";
export * from "./review-links";
export * from "./hum-recordings";
export * from "./inspo-vibe-presets";
export * from "./user-luts";
export * from "./money-entries";
export * from "./content-id";
export * from "./team-seats";
export * from "./milestones";
export * from "./presave";
export * from "./creator-platform";
export * from "./creator-subscriptions";
export * from "./creator-payouts";
export * from "./custom-domains";
export * from "./creator-social";
export * from "./creator-stories-posts";
export * from "./creator-shorts";
export * from "./community";
export * from "./digital-sales";
export * from "./storefront";
export * from "./referral-contest";
export * from "./wave8";
export * from "./wave9";
export * from "./wave9a";
export * from "./retention";
export * from "./thy-books";
