/**
 * baseline-tables.test.ts — Stack 400, item C-39 (baseline repair).
 *
 * THE DEFECT THIS PINS: lib/db/migrate-boot.mjs skips every
 * migration numbered <= BASELINE (55) on a database that carries
 * the credit_usage canary, ASSUMING those migrations were applied
 * manually pre-runner. Nothing verified the assumption: staging
 * carried the canary but not hourly_crate_claims (0055), so the
 * table errored on every access while its migration was skipped
 * on every boot. The runner now asserts the code-referenced
 * baseline tables exist at BOOT (BASELINE_TABLE_ASSERTIONS in
 * migrate-boot.mjs, boot fails loudly on a miss) and migration
 * 0328 re-issues 0055's CREATE TABLE verbatim above the baseline.
 *
 * This suite is the TEST-TIME half of that assertion:
 *  - it re-derives, from the migrations on disk, the exact set the
 *    runner asserts (tables the crate-claims family — bonus /
 *    retention / activity-feed — reads through the Drizzle schema
 *    whose CREATING migration is numbered <= 55) and pins that the
 *    runner's list equals it — the two can never quietly drift;
 *  - it pins migration 0328's repair shape: numbered above the
 *    baseline, and its CREATE TABLE statement is 0055's, verbatim
 *    (compared whitespace-normalized, so the check is about the
 *    statement, not formatting);
 *  - it pins that 0055 itself was never edited into a repair (the
 *    immutable-file rule): 0055 still carries its original CREATE.
 *
 * The code-referenced read set is the from(<table>) union of
 * lib/bonus.ts, lib/retention.ts and routes/activity-feed.ts — the
 * modules the C-39 census found reading hourly_crate_claims —
 * resolved to SQL names through the Drizzle schema files. Reads
 * through the Supabase admin client by string name (bonus.ts's
 * .from("profiles")) are deliberately NOT part of this set: the
 * assertion covers the Drizzle-schema reads the baseline skip puts
 * at risk, and profiles' Render-side existence is migration
 * 0000's own job.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.join(__dirname, "..", "..", "..", "..", "..");
const migrationsDir = path.join(repoRoot, "lib", "db", "migrations");
const schemaDir = path.join(repoRoot, "lib", "db", "src", "schema");
const apiSrc = path.join(repoRoot, "artifacts", "api-server", "src");

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

/** Strip block + line comments (house pin style: code, not prose). */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Table export const → SQL name, from every Drizzle schema file. */
function schemaTableNames(): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of fs.readdirSync(schemaDir).filter((x) => x.endsWith(".ts"))) {
    const src = read(path.join(schemaDir, f));
    for (const m of src.matchAll(/export const (\w+Table) = pgTable\(\s*"([^"]+)"/gs)) {
      map.set(m[1]!, m[2]!);
    }
  }
  return map;
}

/** SQL table name → the LOWEST-numbered migration file creating it. */
function creatingMigrations(): Map<string, { num: number; file: string }> {
  const map = new Map<string, { num: number; file: string }>();
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  for (const f of files) {
    const num = parseInt(f.slice(0, 4), 10);
    /* Prose names statements too (0000's header discusses "CREATE
       TABLE IF NOT EXISTS throughout"), so the scan runs on
       comment-stripped code only. */
    const sql = codeOnly(read(path.join(migrationsDir, f)));
    for (const m of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?([a-z0-9_]+)"?/gi)) {
      const name = m[1]!.toLowerCase();
      if (!map.has(name)) map.set(name, { num, file: f });
    }
  }
  return map;
}

/** The export consts the crate-claims module family reads via from(). */
function codeReferencedTables(): string[] {
  const names = schemaTableNames();
  const found = new Set<string>();
  for (const rel of ["lib/bonus.ts", "lib/retention.ts", "routes/activity-feed.ts"]) {
    const src = codeOnly(read(path.join(apiSrc, rel)));
    for (const m of src.matchAll(/\.from\((\w+Table)\)/g)) {
      const sqlName = names.get(m[1]!);
      if (sqlName) found.add(sqlName);
    }
  }
  return [...found].sort();
}

const BASELINE = 55;

function expectedAssertions(): string[] {
  const creating = creatingMigrations();
  return codeReferencedTables()
    .filter((t) => {
      const c = creating.get(t);
      return c !== undefined && c.num <= BASELINE;
    })
    .sort();
}

describe("C-39 baseline-table assertion — boot list and disk derivation agree", () => {
  it("the derivation finds the expected baseline set (sanity: the family and its baseline members)", () => {
    const referenced = codeReferencedTables();
    expect(referenced).toContain("hourly_crate_claims");
    expect(referenced.length).toBeGreaterThanOrEqual(15);
    expect(expectedAssertions()).toEqual([
      "contest_entries",
      "generations",
      "hourly_crate_claims",
      "social_publish_attempts",
    ]);
  });

  it("migrate-boot.mjs asserts exactly the derived set", () => {
    const boot = read(path.join(repoRoot, "lib", "db", "migrate-boot.mjs"));
    const block = boot.match(/const BASELINE_TABLE_ASSERTIONS = \[([\s\S]*?)\];/);
    expect(block).not.toBeNull();
    const listed = [...block![1]!.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]!).sort();
    expect(listed).toEqual(expectedAssertions());
    /* And the boot actually fails on a miss (the loud part). */
    expect(boot).toContain("baseline table assertion failed");
  });
});

describe("C-39 migration 0328 — the hourly_crate_claims baseline repair", () => {
  function createStatement(sql: string): string {
    const m = sql.match(/CREATE TABLE IF NOT EXISTS hourly_crate_claims \([\s\S]*?\);/);
    expect(m).not.toBeNull();
    return m![0].replace(/\s+/g, " ").trim();
  }

  it("0328 exists above the baseline and re-issues 0055's CREATE TABLE verbatim", () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.startsWith("0328_"));
    expect(files).toHaveLength(1);
    const repair = read(path.join(migrationsDir, files[0]!));
    const original = read(path.join(migrationsDir, "0055_hourly_crate_global.sql"));
    expect(createStatement(repair)).toBe(createStatement(original));
    /* Idempotent + runner-legal: IF NOT EXISTS (already in the
       statement), and no transaction/concurrency CONTROL STATEMENTS
       (checked on comment-stripped code — the file's prose may and
       does name the rules it follows). */
    const repairCode = codeOnly(repair);
    expect(repairCode).not.toMatch(/^\s*BEGIN\s*;/im);
    expect(repairCode).not.toMatch(/COMMIT\s*;/);
    expect(repairCode.toUpperCase()).not.toContain("CONCURRENTLY");
  });

  it("0055 itself is untouched — it still carries its original single CREATE", () => {
    const original = read(path.join(migrationsDir, "0055_hourly_crate_global.sql"));
    expect(original.match(/CREATE TABLE IF NOT EXISTS hourly_crate_claims/g)).toHaveLength(1);
  });
});
