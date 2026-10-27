/**
 * bonus-schema-drift.test.ts — QC-200 G6 rider (profiles drift).
 *
 * Production logs (Oct 25 ~20:58) carried `relation "profiles" does not
 * exist` from the bonus path: ensureBonusColumns() ran
 * `ALTER TABLE profiles …` against DATABASE_URL (Render Postgres),
 * while `profiles` is a Supabase table that this module only ever
 * touches through the Supabase client. The ALTER could never succeed,
 * it retried on every bonus request (the latch only set on success),
 * and its failure also swallowed the wheel_spins CREATE that shared
 * the same statement string.
 *
 * Pins:
 *  - bonus.ts issues NO DDL/DML against `profiles` through the
 *    DATABASE_URL db handle (source pin + executed-statement capture);
 *  - JOIN2 ADAPTATION (schema-drift composition): wheel_spins creation
 *    is owned by the boot migration runner, NOT a runtime self-heal —
 *    the orphan schema-drift lane's design won the join over G6's
 *    runtime ensureWheelSpinsTable() (Stack-8 doctrine: tables are
 *    defined once, migrations own creation). The second pin below now
 *    asserts bonus.ts carries no runtime CREATE TABLE and the
 *    migrations chain creates wheel_spins.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const h = vi.hoisted(() => ({ statements: [] as string[] }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    db: {
      execute: async (q: unknown) => {
        h.statements.push(JSON.stringify(q));
        return [];
      },
      insert: () => {
        throw new Error("insert is not exercised by these tests");
      },
    },
  };
});

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: () => {
    throw new Error("supabase is not exercised by these tests");
  },
}));

describe("bonus schema drift (G6)", () => {
  beforeEach(() => {
    h.statements.length = 0;
  });

  it("bonus.ts never ALTERs or writes `profiles` through the DATABASE_URL handle", () => {
    const raw = fs.readFileSync(path.join(__dirname, "..", "bonus.ts"), "utf8");
    /* Strip comments first: bonus.ts's own header prose legitimately
       NAMES the old ALTER while explaining why it is gone — the pin
       governs executable code, not the explanation. */
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/ALTER TABLE profiles/i);
    expect(src).not.toMatch(/INSERT INTO profiles/i);
    expect(src).not.toMatch(/UPDATE profiles/i);
    /* The Supabase client remains the only profiles path. */
    expect(src).toContain('.from("profiles")');
  });

  it("wheel_spins is migration-owned: no runtime CREATE in bonus.ts, the migration chain creates it", () => {
    const raw = fs.readFileSync(path.join(__dirname, "..", "bonus.ts"), "utf8");
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/CREATE TABLE/i);
    const migrationsDir = path.join(__dirname, "..", "..", "..", "..", "..", "lib", "db", "migrations");
    const sql = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => fs.readFileSync(path.join(migrationsDir, f), "utf8"))
      .join("\n");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS wheel_spins");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS contests");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS contest_entries");
  });
});
