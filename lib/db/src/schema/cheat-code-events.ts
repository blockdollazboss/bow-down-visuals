import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/* Cheat Code Jackpot: a 6-month promotional event. One secret directional
   sequence per cycle; the first player to enter it wins prize_credits.
   The secret is NEVER stored in plaintext (the repo is public) — only a
   SHA-256 hash of the canonical encoding ("bowdown-cheatcode-v1:" +
   JSON of the direction array). All validation is server-side.
   See migrations/0025_cheat_code_events.sql — the schema here must stay in
   sync with it so boot-time `drizzle-kit push` matches the migration. */

export const cheatCodeEventsTable = pgTable(
  "cheat_code_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /* SHA-256 hex of the canonical sequence encoding. */
    codeHash: text("code_hash").notNull(),
    /* Number of moves in the sequence (public — shown as a game hint). */
    codeLength: integer("code_length").notNull(),
    prizeCredits: integer("prize_credits").notNull().default(100),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    isActive: boolean("is_active").notNull().default(false),
    winnerUserId: uuid("winner_user_id"),
    winnerDisplayName: text("winner_display_name"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("cheat_code_events_name_ux").on(t.name),
    index("cheat_code_events_active_idx").on(
      t.isActive,
      t.startsAt,
      t.endsAt,
    ),
  ],
);

export type CheatCodeEvent = typeof cheatCodeEventsTable.$inferSelect;

/* Audit + rate-limit log for jackpot attempts. */
export const cheatCodeAttemptsTable = pgTable(
  "cheat_code_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => cheatCodeEventsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    ip: text("ip"),
    success: boolean("success").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cheat_code_attempts_event_idx").on(t.eventId, t.createdAt),
    index("cheat_code_attempts_user_idx").on(t.userId, t.createdAt),
    index("cheat_code_attempts_ip_idx").on(t.ip, t.createdAt),
  ],
);

export type CheatCodeAttempt = typeof cheatCodeAttemptsTable.$inferSelect;

/** Valid D-pad directions for a jackpot sequence. */
export const CHEAT_CODE_DIRECTIONS = ["up", "down", "left", "right"] as const;
export type CheatCodeDirection = (typeof CHEAT_CODE_DIRECTIONS)[number];
