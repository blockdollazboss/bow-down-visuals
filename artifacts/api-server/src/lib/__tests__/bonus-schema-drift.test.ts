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
 *  - ensureWheelSpinsTable() creates ONLY wheel_spins (+ its index)
 *    through that handle, and latches after the first success.
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

import { ensureWheelSpinsTable } from "../bonus";

describe("bonus schema drift (G6)", () => {
  beforeEach(() => {
    h.statements.length = 0;
  });

  it("bonus.ts never ALTERs or writes `profiles` through the DATABASE_URL handle", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "bonus.ts"), "utf8");
    expect(src).not.toMatch(/ALTER TABLE profiles/i);
    expect(src).not.toMatch(/INSERT INTO profiles/i);
    expect(src).not.toMatch(/UPDATE profiles/i);
    /* The Supabase client remains the only profiles path. */
    expect(src).toContain('.from("profiles")');
  });

  it("ensureWheelSpinsTable creates only wheel_spins and latches", async () => {
    await ensureWheelSpinsTable();
    await ensureWheelSpinsTable();
    const joined = h.statements.join("\n");
    expect(joined).toContain("wheel_spins");
    expect(joined).not.toMatch(/profiles/i);
    /* Two statements (table + index), exactly once despite two calls. */
    expect(h.statements).toHaveLength(2);
  });
});
