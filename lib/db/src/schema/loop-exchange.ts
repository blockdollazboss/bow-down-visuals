import { pgTable, uuid, text, integer, numeric, timestamp, boolean, jsonb, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── Loop Exchange (Stack-200 Wave 2, idea #168 — TRULY NEW) ───────────
   Loops/hooks posted for other creators to build on. NOT the samples /
   pack marketplace and NOT Sound-Fit discovery: the loop itself is the
   seed, a downstream BUILD is the thing that sells, and the original
   poster is credited and paid on EVERY downstream sale of that build.

   SPLIT TERMS ARE AGREED UP FRONT, on the existing splits rail — this
   schema deliberately does NOT invent a second splits machine:
     - The poster states their terms on the loop itself
       (poster_share_pct — the share of the downstream net they take).
     - A builder proposes the build's full splits list
       [{ userId, sharePct }] summing to exactly 100, validated by the
       sale-splits machine (lib/sale-splits.ts validateProductSplits,
       the publishing sum-to-100 rules): the builder is the list owner,
       and the poster MUST appear at >= their posted share.
     - The poster accepts or declines. Only an 'agreed' build can
       record a downstream sale. The accepted list is snapshotted on
       the build row, so later edits to the loop's terms never rewrite
       an agreed deal.

   THE MONEY (TEST MODE, Visual Bucs only — never cash): a downstream
   sale is recorded against a build with a caller-supplied sale_ref.
   The flat 5% platform fee comes off the top first (platform-fees
   feeSplit, the sale-splits fee order), the net divides across the
   snapshotted splits by largest-remainder (sale-splits
   allocateSplitCents, applied to whole Visual Bucs), and each share
   lands as ONE loop_exchange_split_ledger row — unique on
   (sale_id, recipient_user_id) — plus one credit_usage ledger row
   keyed `loop-exchange:<saleId>:<userId>`. sale_ref is UNIQUE on the
   sales table, so re-recording the same downstream sale is an
   idempotent replay: existing rows come back, nobody is paid twice.

   *** MIGRATION PROVISIONAL *** Tables are created by
   lib/db/migrations/9999-loop-exchange.sql (provisional number; the
   integrator renumbers at join). Until it lands, write routes
   probe-first and answer 503, and reads degrade to empty — nothing
   is faked. */

export const LOOP_EXCHANGE_LOOP_STATUSES = ["open", "paused", "closed"] as const;
export type LoopExchangeLoopStatus = (typeof LOOP_EXCHANGE_LOOP_STATUSES)[number];

export const LOOP_EXCHANGE_BUILD_STATUSES = ["pending_terms", "agreed", "declined"] as const;
export type LoopExchangeBuildStatus = (typeof LOOP_EXCHANGE_BUILD_STATUSES)[number];

export const LOOP_EXCHANGE_ROLES = ["loop_poster", "builder", "collaborator"] as const;
export type LoopExchangeRole = (typeof LOOP_EXCHANGE_ROLES)[number];

export const loopExchangeLoopsTable = pgTable("loop_exchange_loops", {
  id:               uuid("id").primaryKey().defaultRandom(),
  posterUserId:     uuid("poster_user_id").notNull(),
  posterProfileId:  uuid("poster_profile_id"),
  title:            text("title").notNull(),
  description:      text("description").notNull().default(""),
  audioUrl:         text("audio_url").notNull(),
  bpm:              integer("bpm"),
  musicalKey:       text("musical_key"),
  durationSeconds:  integer("duration_seconds"),
  /* The poster's up-front terms: their share of every downstream
     sale's net, in percent. Set by the poster — never invented. */
  posterSharePct:   numeric("poster_share_pct", { precision: 5, scale: 2 }).notNull(),
  status:           text("status").notNull().default("open").$type<LoopExchangeLoopStatus>(),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("loop_exchange_loops_status_check", sql`${t.status} IN ('open', 'paused', 'closed')`),
  check("loop_exchange_loops_share_check", sql`${t.posterSharePct} > 0 AND ${t.posterSharePct} < 100`),
  index("loop_exchange_loops_poster_idx").on(t.posterUserId, t.status),
  index("loop_exchange_loops_status_idx").on(t.status, t.createdAt),
]);

export const loopExchangeBuildsTable = pgTable("loop_exchange_builds", {
  id:               uuid("id").primaryKey().defaultRandom(),
  loopId:           uuid("loop_id").notNull().references(() => loopExchangeLoopsTable.id, { onDelete: "cascade" }),
  builderUserId:    uuid("builder_user_id").notNull(),
  builderProfileId: uuid("builder_profile_id"),
  title:            text("title").notNull(),
  audioUrl:         text("audio_url"),
  /* Snapshotted splits list [{ userId, sharePct }] — validated by the
     sale-splits machine at proposal time; frozen once agreed. */
  splits:           jsonb("splits").notNull(),
  status:           text("status").notNull().default("pending_terms").$type<LoopExchangeBuildStatus>(),
  agreedAt:         timestamp("agreed_at", { withTimezone: true }),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("loop_exchange_builds_status_check", sql`${t.status} IN ('pending_terms', 'agreed', 'declined')`),
  index("loop_exchange_builds_loop_idx").on(t.loopId, t.status),
  index("loop_exchange_builds_builder_idx").on(t.builderUserId, t.status),
]);

export const loopExchangeSalesTable = pgTable("loop_exchange_sales", {
  id:               uuid("id").primaryKey().defaultRandom(),
  buildId:          uuid("build_id").notNull().references(() => loopExchangeBuildsTable.id, { onDelete: "cascade" }),
  loopId:           uuid("loop_id").notNull().references(() => loopExchangeLoopsTable.id, { onDelete: "cascade" }),
  /* The downstream sale's own reference (order/session id from the
     selling rail). UNIQUE — this is the exactly-once key: the same
     downstream sale can only ever be recorded once. */
  saleRef:          text("sale_ref").notNull(),
  buyerUserId:      uuid("buyer_user_id"),
  recordedByUserId: uuid("recorded_by_user_id").notNull(),
  grossVb:          integer("gross_vb").notNull(),
  feeVb:            integer("fee_vb").notNull().default(0),
  netVb:            integer("net_vb").notNull().default(0),
  testMode:         boolean("test_mode").notNull().default(true),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("loop_exchange_sales_gross_check", sql`${t.grossVb} > 0`),
  check("loop_exchange_sales_net_check", sql`${t.netVb} >= 0 AND ${t.feeVb} >= 0`),
  uniqueIndex("loop_exchange_sales_ref_ux").on(t.saleRef),
  index("loop_exchange_sales_build_idx").on(t.buildId, t.createdAt),
  index("loop_exchange_sales_loop_idx").on(t.loopId, t.createdAt),
]);

export const loopExchangeSplitLedgerTable = pgTable("loop_exchange_split_ledger", {
  id:               uuid("id").primaryKey().defaultRandom(),
  saleId:           uuid("sale_id").notNull().references(() => loopExchangeSalesTable.id, { onDelete: "cascade" }),
  buildId:          uuid("build_id").notNull(),
  loopId:           uuid("loop_id").notNull(),
  recipientUserId:  uuid("recipient_user_id").notNull(),
  role:             text("role").notNull().default("collaborator").$type<LoopExchangeRole>(),
  sharePct:         numeric("share_pct", { precision: 5, scale: 2 }).notNull(),
  amountVb:         integer("amount_vb").notNull().default(0),
  /* The credit_usage idempotency key this share's balance credit rode
     on (`loop-exchange:<saleId>:<userId>`) — the join key between the
     two ledgers. */
  creditKey:        text("credit_key").notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("loop_exchange_split_ledger_role_check", sql`${t.role} IN ('loop_poster', 'builder', 'collaborator')`),
  check("loop_exchange_split_ledger_amount_check", sql`${t.amountVb} >= 0`),
  uniqueIndex("loop_exchange_split_ledger_sale_recipient_ux").on(t.saleId, t.recipientUserId),
  index("loop_exchange_split_ledger_recipient_idx").on(t.recipientUserId, t.createdAt),
  index("loop_exchange_split_ledger_loop_idx").on(t.loopId, t.createdAt),
]);

export const insertLoopExchangeLoopSchema = createInsertSchema(loopExchangeLoopsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertLoopExchangeLoop = z.infer<typeof insertLoopExchangeLoopSchema>;
export type LoopExchangeLoop = typeof loopExchangeLoopsTable.$inferSelect;

export const insertLoopExchangeBuildSchema = createInsertSchema(loopExchangeBuildsTable).omit({
  id: true, createdAt: true, updatedAt: true, agreedAt: true,
});
export type InsertLoopExchangeBuild = z.infer<typeof insertLoopExchangeBuildSchema>;
export type LoopExchangeBuild = typeof loopExchangeBuildsTable.$inferSelect;

export const insertLoopExchangeSaleSchema = createInsertSchema(loopExchangeSalesTable).omit({
  id: true, createdAt: true,
});
export type InsertLoopExchangeSale = z.infer<typeof insertLoopExchangeSaleSchema>;
export type LoopExchangeSale = typeof loopExchangeSalesTable.$inferSelect;

export const insertLoopExchangeSplitLedgerSchema = createInsertSchema(loopExchangeSplitLedgerTable).omit({
  id: true, createdAt: true,
});
export type InsertLoopExchangeSplitLedger = z.infer<typeof insertLoopExchangeSplitLedgerSchema>;
export type LoopExchangeSplitLedger = typeof loopExchangeSplitLedgerTable.$inferSelect;
