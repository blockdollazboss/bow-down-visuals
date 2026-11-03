/**
 * shop-design-migration.test.ts — migration 0320 (shops layout/font)
 * shape + idempotency.
 *
 * Pins the house migration discipline on the actual shipped file:
 * both columns arrive via ADD COLUMN IF NOT EXISTS with the defaults
 * that reproduce today's storefront; no explicit transaction control
 * and no CONCURRENTLY (the boot migrator owns both); and the file can
 * run twice against a live-shaped shops table — the second run is a
 * no-op and existing rows pick up the defaults.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createTestDb } from "./test-db";

const MIGRATION_PATH = new URL(
  "../../../../../lib/db/migrations/0320_shop_layout_font.sql",
  import.meta.url,
);
const migrationSql = readFileSync(MIGRATION_PATH, "utf8");
/** The file's statements with header/comment lines stripped. */
const statementsOnly = migrationSql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("migration 0320 — shop layout/font", () => {
  it("adds both columns IF NOT EXISTS with today's-look defaults", () => {
    expect(statementsOnly).toContain(
      "ADD COLUMN IF NOT EXISTS layout_style TEXT NOT NULL DEFAULT 'showcase'",
    );
    expect(statementsOnly).toContain(
      "ADD COLUMN IF NOT EXISTS font_style TEXT NOT NULL DEFAULT 'house'",
    );
  });

  it("carries no transaction control and no CONCURRENTLY (the boot migrator owns both)", () => {
    expect(statementsOnly).not.toMatch(/\bBEGIN\b/);
    expect(statementsOnly).not.toMatch(/\bCOMMIT\b/);
    expect(statementsOnly).not.toMatch(/\bCONCURRENTLY\b/);
  });

  it("runs twice as a no-op and backfills existing rows with the defaults", async () => {
    const { db, mem } = createTestDb();
    mem.public.none(`
      CREATE TABLE shops (
        id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, handle text NOT NULL
      );
      INSERT INTO shops (id, user_id, name, handle)
      VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Old Shop', 'old-shop');
    `);
    /* First run adds the columns; the second must change nothing. */
    mem.public.none(migrationSql);
    mem.public.none(migrationSql);
    const row = await db.execute(
      sql`SELECT layout_style, font_style FROM shops WHERE handle = 'old-shop'`,
    );
    expect(row.rows[0]).toMatchObject({ layout_style: "showcase", font_style: "house" });
  });
});
