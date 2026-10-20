import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * World locks (migration 0179, Cloud Operator Phase 2 — Lane F).
 *
 * The two locks the owner ruled Thy Cheat Code may work on an admin
 * account's command (Oct 20, 2026: "lock" = BOTH kinds):
 *
 * world_person_locks — a named member locked OUT of one room for a
 * time. The row is the durable truth: the World join path refuses
 * the member at that room's door until expires_at passes or an
 * admin lifts the row early. A rejoin, a reconnect, or a server
 * restart never sheds it — that is the entire point of persisting
 * it (the in-room mute, by contrast, is session state by design).
 * One live row per (room, member): re-locking replaces the row,
 * so the newest command is the standing one.
 *
 * world_door_locks — a room's door locked: the people inside stay,
 * nobody new joins. The only bypass is an admin account (standing
 * World law: the admin holds ALL controls always). One row per
 * room, keyed by the room id itself — a room is locked or it is
 * not; there is no duration, an admin unlocks it.
 *
 * Both tables are written ONLY through the operator's Tier-4 path
 * (the executor's fail-closed ADMIN_EMAILS gate stands in front of
 * every write) and read by the World's admission check through the
 * lock store's in-memory mirror (lib/world-locks in the api-server:
 * hydrated from these tables at boot, updated on every mutation).
 */

export const worldPersonLocksTable = pgTable("world_person_locks", {
  id:             uuid("id").primaryKey().defaultRandom(),
  roomId:         text("room_id").notNull(),
  userId:         uuid("user_id").notNull(),
  /** The member's display name when the lock landed — the admin
   *  readback ("who is locked out of the Music Hall") reads it
   *  without a second lookup, and the unlock command resolves the
   *  person by this name while they are (by definition) absent. */
  displayName:    text("display_name").notNull().default(""),
  lockedByUserId: uuid("locked_by_user_id").notNull(),
  lockedByEmail:  text("locked_by_email"),
  reason:         text("reason"),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt:      timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  index("world_person_locks_room_user_idx").on(t.roomId, t.userId),
  index("world_person_locks_expires_idx").on(t.expiresAt),
]);

export const worldDoorLocksTable = pgTable("world_door_locks", {
  roomId:         text("room_id").primaryKey(),
  lockedByUserId: uuid("locked_by_user_id").notNull(),
  lockedByEmail:  text("locked_by_email"),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertWorldPersonLockSchema = createInsertSchema(worldPersonLocksTable).omit({ id: true, createdAt: true });
export type InsertWorldPersonLock = z.infer<typeof insertWorldPersonLockSchema>;
export type WorldPersonLock = typeof worldPersonLocksTable.$inferSelect;

export const insertWorldDoorLockSchema = createInsertSchema(worldDoorLocksTable).omit({ createdAt: true });
export type InsertWorldDoorLock = z.infer<typeof insertWorldDoorLockSchema>;
export type WorldDoorLock = typeof worldDoorLocksTable.$inferSelect;
