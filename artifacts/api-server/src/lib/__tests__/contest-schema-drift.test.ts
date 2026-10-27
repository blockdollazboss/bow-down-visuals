/**
 * contest-schema-drift.test.ts — QC-200 G6 rider (contest_entries drift).
 *
 * Production logs (Oct 25 ~20:58) carried `relation "contest_entries"
 * does not exist` at request level (routes/generate/contests.ts,
 * routes/activity-feed.ts). Root cause: contests + contest_entries
 * are created ONLY by migration 0024_fan_contests.sql, and 0024 sits
 * at/below the migrate-boot BASELINE (55) — the boot runner skips
 * pre-baseline files on existing databases on the assumption they
 * were applied manually pre-runner. That assumption was false, and
 * no post-baseline migration ever re-guarded the CREATEs, so the
 * tables could never appear.
 *
 * Pins:
 *  - the canonical Drizzle tables are named contests / contest_entries
 *    (the fix must create THESE tables — never rename a live table);
 *  - the provisional 9999 G6 repair migration re-guards both CREATEs
 *    with every canonical column, idempotently, with no BEGIN/COMMIT;
 *  - the baseline-skip root cause stays documented in the runner:
 *    BASELINE >= 24, so 0024 alone can never repair an existing DB.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getTableName, getTableColumns } from "drizzle-orm";
import { contestsTable, contestEntriesTable } from "@workspace/db";

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "..", "..", "lib", "db", "migrations");
const RUNNER = path.join(__dirname, "..", "..", "..", "..", "..", "lib", "db", "migrate-boot.mjs");

function repairSql(): string {
  /* The G6 repair file is identified by BOTH of its signatures: the
     contest_entries re-guard AND the email_campaigns queued_at ALTER
     (0277 after the Join #2 renumber). The CREATE alone also matches
     0024 itself and the orphan drift file — neither is the G6 repair. */
  const file = fs
    .readdirSync(MIGRATIONS_DIR)
    .find((f) => {
      if (!/^\d{4}_.*\.sql$/.test(f)) return false;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      return sql.includes("CREATE TABLE IF NOT EXISTS contest_entries") && /ALTER TABLE email_campaigns\s+ADD COLUMN IF NOT EXISTS queued_at/i.test(sql);
    });
  expect(file, "a numbered migration must carry the G6 contest repair (0277 after the Join #2 renumber)").toBeTruthy();
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file!), "utf8");
}

/** The CREATE TABLE body for `name` in a SQL file, lower-cased. */
function createBody(sql: string, name: string): string {
  const m = sql.match(new RegExp(`create table if not exists ${name} \\(([\\s\\S]*?)\\n\\);`, "i"));
  expect(m, `repair migration must CREATE TABLE IF NOT EXISTS ${name}`).toBeTruthy();
  return m![1]!.toLowerCase();
}

describe("contest schema drift (G6)", () => {
  it("canonical schema tables keep their live names", () => {
    expect(getTableName(contestsTable)).toBe("contests");
    expect(getTableName(contestEntriesTable)).toBe("contest_entries");
  });

  it("root cause pin: 0024 is at/below the migrate-boot BASELINE and gets skipped", () => {
    const runner = fs.readFileSync(RUNNER, "utf8");
    const m = runner.match(/const BASELINE = (\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(24);
    expect(runner).toContain("num <= BASELINE");
  });

  it("the 9999 repair migration recreates both tables with every canonical column", () => {
    const sql = repairSql();
    for (const [table, name] of [
      [contestsTable, "contests"],
      [contestEntriesTable, "contest_entries"],
    ] as const) {
      const body = createBody(sql, name);
      for (const col of Object.values(getTableColumns(table))) {
        expect(body, `${name} repair must define column ${col.name}`).toContain(col.name.toLowerCase());
      }
    }
  });

  it("the repair migration is idempotent and transaction-clean", () => {
    /* Strip -- comments first: the header prose legitimately NAMES the
       banned constructs ("No BEGIN/COMMIT, no CONCURRENTLY"). */
    const sql = repairSql()
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(sql).not.toMatch(/^\s*BEGIN\b/im);
    expect(sql).not.toMatch(/^\s*COMMIT\b/im);
    expect(sql).not.toMatch(/CONCURRENTLY/i);
    expect(sql).not.toMatch(/RENAME TO/i);
    /* queued_at — the stale-queue gate's column — rides the same file. */
    expect(sql).toMatch(/ALTER TABLE email_campaigns\s+ADD COLUMN IF NOT EXISTS queued_at/i);
  });

  it("no migration renames the live contest tables", () => {
    for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      expect(sql, f).not.toMatch(/ALTER TABLE\s+(contests|contest_entries)\s+RENAME/i);
      expect(sql, f).not.toMatch(/RENAME TO\s+(contests|contest_entries)\b/i);
    }
  });
});
