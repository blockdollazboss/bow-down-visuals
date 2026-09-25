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
export * from "./generated-clips";
export * from "./project-drafts";
export * from "./generation-history";
export * from "./contact-messages";
export * from "./export-jobs";
export * from "./lip-sync-jobs";
export * from "./job-notifications";
export * from "./songs";
export * from "./social-accounts";
export * from "./social-publish-attempts";
export * from "./locations";
export * from "./artist-outfits";
export * from "./discord";
export * from "./sponsor-deals";
export * from "./distribution-releases";
export * from "./branding-orders";
export * from "./customer-shops";
export * from "./beats";
export * from "./fan-memberships";
export * from "./press-kits";
export * from "./live-shopping";
export * from "./scheduled-posts";
export * from "./merch";
export * from "./playlist-pitch";
export * from "./contests";
export * from "./fan-shoutouts";
export * from "./collab";
export * from "./email-lists";
export * from "./royalties";
export * from "./cheat-code-events";
export * from "./tour";
export * from "./preproduction-packs";
