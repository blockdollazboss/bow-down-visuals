import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Tour Planner (v1).
   Tour dates are lightweight records owned by the user: city, venue, date,
   plus freeform notes (load-in time, promoter contact, ticket link, etc.)
   and a status that tracks the show lifecycle.

   AI routing + budget estimation are stateless completions — the optimized
   order and budget breakdown are returned in the response, not persisted.
   Date management (CRUD) is free; only the AI plan costs credits. */

export const tourDatesTable = pgTable(
  "tour_dates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    city: text("city").notNull(),
    venue: text("venue").notNull(),
    show_date: timestamp("show_date", { withTimezone: true }).notNull(),
    notes: text("notes"),
    /* upcoming | confirmed | completed | cancelled */
    status: text("status").notNull().default("upcoming"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tour_dates_user_id_idx").on(t.user_id)],
);

export const insertTourDateSchema = createInsertSchema(tourDatesTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertTourDate = z.infer<typeof insertTourDateSchema>;
export type TourDate = typeof tourDatesTable.$inferSelect;

/* Status values for tour dates — keep in sync with the frontend. */
export const TOUR_STATUSES = ["upcoming", "confirmed", "completed", "cancelled"] as const;
export type TourStatus = (typeof TOUR_STATUSES)[number];
