import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const contactMessagesTable = pgTable("contact_messages", {
  id:        uuid("id").primaryKey().defaultRandom(),
  name:      text("name").notNull(),
  email:     text("email").notNull(),
  message:   text("message").notNull(),
  read:      boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertContactMessageSchema = createInsertSchema(contactMessagesTable).omit({ id: true, createdAt: true });
export type InsertContactMessage = z.infer<typeof insertContactMessageSchema>;
export type ContactMessage = typeof contactMessagesTable.$inferSelect;
