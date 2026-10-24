import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ─── Public Creator API keys (Stack-100 #3, feature #9) ─────────────────
   PENDING MIGRATION: this table is drafted ahead of its migration. The
   exact SQL lives in the lane's .lane/MIGRATION-NEEDED.md; the migration
   number is assigned at join (0205 is held by other lanes). Until the
   migration lands, every api_keys query fails and the key-auth middleware
   FAILS CLOSED (401) — no key can authenticate against a missing table.

   Security shape:
   - Only a SHA-256 hash of the key is stored (key_hash, unique). The
     plaintext is shown to the creator exactly once at creation and is
     never stored, never logged, never returned again.
   - key_prefix is the non-secret display fragment (e.g. "bdv_live_ab12")
     so the owner can recognise a key in the Developer door.
   - scopes is a comma-joined list from the small v1 scope set enforced
     in artifacts/api-server/src/lib/api-keys.ts (API_KEY_SCOPES).
   - revoked_at set = dead immediately; auth checks it on every request. */
export const apiKeysTable = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    scopes: text("scopes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_keys_user_idx").on(t.userId), index("api_keys_hash_idx").on(t.keyHash)],
);

export const insertApiKeySchema = createInsertSchema(apiKeysTable).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
});
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeysTable.$inferSelect;
