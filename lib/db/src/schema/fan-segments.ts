import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/* ─── Fan segments (Stack-100 #3, fan-graph phase 2) ──────────────────
   A creator's saved audience definition over the One Fan Graph
   (lib/fan-graph). The row stores ONLY the definition — name + the
   rule set as JSON text (the email_segments.criteria pattern) —
   never membership: membership is computed live from the graph on
   every read and every send, so a saved segment can never drift
   from the fan data it describes.

   Rules shape (validated in the route + lib/fan-segments):
   {
     follows: "yes" | "no" | "any"
     subscribed: "yes" | "no" | "any"
     buyer: "yes" | "no" | "any"
     member: "any" | "active" | "member" | "none"
     minSpentUsdCents: number   — spentUsdCents floor
     minSpentVb: number         — spentVb floor
     minPurchases: number       — purchaseCount floor
     hasEmail: boolean
     sourcesAny: string[]       — follow|subscriber|member|store|
                                  digital|shop|live|tips
     activeWithinDays: number   — last-activity window, 0 = none
   }
   Scoping: user_id is the OWNING creator. Every query in
   lib/fan-segment-store filters by it — a segment can only ever
   contain the owning creator's own fans, because evaluation runs
   over loadFanGraph(user_id) and nothing else. */

export const fanSegmentsTable = pgTable("fan_segments", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").notNull(),
  name:      text("name").notNull(),
  rules:     text("rules").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type FanSegment = typeof fanSegmentsTable.$inferSelect;
