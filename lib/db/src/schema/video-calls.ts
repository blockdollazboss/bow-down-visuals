import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { conversationsTable } from "./community";

/**
 * Video calls Phase 1 (Stack-200) — 1:1 calls INSIDE Messages.
 *
 * One row per call attempt, born `ringing` when the caller starts it
 * and settled exactly once into a terminal status:
 *   accepted is NOT terminal — an accepted call is live until it ends
 *   (status stays `accepted` while live; `ended` is the settled row).
 *   declined  — the callee said no
 *   missed    — the ring timed out (45s) or the caller hung up pre-answer
 *               is `cancelled` from the caller's side; `missed` is the
 *               callee-facing settlement of an unanswered ring. The
 *               server settles: caller-cancel before answer => missed
 *               for the callee's history (they missed it), with
 *               end_reason='caller_cancelled'.
 *   busy      — the callee was already in a live/ringing call
 *   blocked   — a block landed mid-call / mid-ring and severed it
 *   failed    — signaling/transport failure before answer
 *
 * The row IS the in-thread call history: GET /dm/:id/calls reads these
 * rows and the Messages page interleaves them with the thread's
 * messages by created_at. No message row is fabricated for a call —
 * a call entry is a call entry, rendered honestly as one.
 *
 * Privacy: a row can only be created for a conversation whose status
 * is `inbox` (DM privacy inherited exactly — see lib/video-calls.ts
 * canCallConversation). Guests have no account and no conversation,
 * so they can never appear here.
 */
export const VIDEO_CALL_STATUSES = [
  "ringing",
  "accepted",
  "declined",
  "missed",
  "cancelled",
  "busy",
  "blocked",
  "failed",
  "ended",
] as const;
export type VideoCallStatus = (typeof VIDEO_CALL_STATUSES)[number];

export const videoCallsTable = pgTable("video_calls", {
  id:             uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  callerUserId:   uuid("caller_user_id").notNull(),
  calleeUserId:   uuid("callee_user_id").notNull(),
  status:         text("status").notNull().default("ringing"),
  /** Why a settled call settled: 'hangup' | 'caller_cancelled' |
   *  'ring_timeout' | 'declined' | 'blocked' | 'busy' | 'disconnect' |
   *  'failed'. Null while ringing/live. */
  endReason:      text("end_reason"),
  answeredAt:     timestamp("answered_at", { withTimezone: true }),
  endedAt:        timestamp("ended_at", { withTimezone: true }),
  /** Talk time in whole seconds (answered -> ended); null unless the
   *  call was answered and has ended. */
  durationSeconds: integer("duration_seconds"),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("video_calls_conversation_idx").on(t.conversationId, t.createdAt),
  index("video_calls_caller_idx").on(t.callerUserId, t.createdAt),
  index("video_calls_callee_idx").on(t.calleeUserId, t.createdAt),
  index("video_calls_status_idx").on(t.status, t.createdAt),
]);

export const insertVideoCallSchema = createInsertSchema(videoCallsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVideoCall = z.infer<typeof insertVideoCallSchema>;
export type VideoCall = typeof videoCallsTable.$inferSelect;
