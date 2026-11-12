/**
 * join22-migrations.test.ts — migration 0339, shape + behavior +
 * idempotency, proven against pg-mem on the shipped file itself
 * (the join21-migrations pattern).
 *
 * 0339 lands the stories report lane's named trailing step:
 * migrations 0174/0267 left the content_reports target-type check
 * at ('post', 'comment', 'profile', 'fan_art'), but the stories
 * lane added a 'story' target type (resolver + StoryViewer dock)
 * against the drizzle schema's already-widened check. Before the
 * migration a story insert must fail at the constraint; after it,
 * it must land — the rest of the vocabulary must behave exactly
 * as before, unknown types must still fail, and a second run of
 * the file must be a no-op.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { contentReportsTable, CONTENT_REPORT_TARGET_TYPES } from "@workspace/db";
import { createTestDb } from "./test-db";

const MIGRATION_0339_PATH = new URL(
  "../../../../../lib/db/migrations/0339_content_reports_story_target.sql",
  import.meta.url,
);
const sql0339 = readFileSync(MIGRATION_0339_PATH, "utf8");

/** The file's statements with comment lines stripped. */
function statements(sqlText: string): string[] {
  return sqlText
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function run(sqlText: string, mem: { public: { none: (q: string) => unknown } }) {
  for (const stmt of statements(sqlText)) mem.public.none(stmt);
}

/** content_reports as migrations 0174 + 0267 + 0337 left it:
 *  reporter nullable (0337), target-type check WITHOUT 'story'. */
const CONTENT_REPORTS_PRE_0339_DDL = `
CREATE TABLE content_reports (
  id uuid PRIMARY KEY,
  reporter_user_id uuid,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_reports_target_type_check
    CHECK (target_type IN ('post', 'comment', 'profile', 'fan_art'))
);`;

const MEMBER = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const STORY_ROW = "33333333-3333-4333-8333-333333333333";
const POST_ROW = "44444444-4444-4444-8444-444444444444";

function insert(mem: { public: { none: (q: string) => unknown } }, id: string, type: string) {
  mem.public.none(
    `INSERT INTO content_reports (id, reporter_user_id, target_type, target_id, reason)
     VALUES ('${id}', '${MEMBER}', '${type}', '${TARGET}', 'spam')`,
  );
}

describe("join22 migration 0339 — house discipline", () => {
  it("carries no transaction control and no CONCURRENTLY (the boot migrator owns both)", () => {
    const body = statements(sql0339).join(";\n");
    expect(body).not.toMatch(/\bBEGIN\b/);
    expect(body).not.toMatch(/\bCOMMIT\b/);
    expect(body).not.toMatch(/\bCONCURRENTLY\b/);
  });

  it("is exactly the DROP + ADD pair widening the check to the five-type vocabulary", () => {
    const stmts = statements(sql0339);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toBe(
      "ALTER TABLE content_reports DROP CONSTRAINT IF EXISTS content_reports_target_type_check",
    );
    expect(stmts[1]).toContain(
      "ADD CONSTRAINT content_reports_target_type_check",
    );
    expect(stmts[1]).toContain(
      "CHECK (target_type IN ('post', 'comment', 'profile', 'fan_art', 'story'))",
    );
  });

  it("the drizzle schema and the migration describe the same vocabulary", () => {
    expect([...CONTENT_REPORT_TARGET_TYPES]).toEqual([
      "post",
      "comment",
      "profile",
      "fan_art",
      "story",
    ]);
    const cfg = getTableConfig(contentReportsTable);
    const check = cfg.checks.find(
      (c) => c.name === "content_reports_target_type_check",
    );
    expect(check).toBeDefined();
  });
});

describe("migration 0339 — story target type", () => {
  it("a story insert fails before, lands after; the old vocabulary is unchanged; a second run is a no-op", () => {
    const { mem } = createTestDb();
    mem.public.none(CONTENT_REPORTS_PRE_0339_DDL);

    // Before: the 0174/0267 constraint still refuses 'story'…
    expect(() => insert(mem, STORY_ROW, "story")).toThrow();
    // …while the standing vocabulary lands.
    insert(mem, POST_ROW, "post");

    run(sql0339, mem);

    // After: the story row lands; the old types still land; an
    // unknown type still fails at the widened check.
    insert(mem, STORY_ROW, "story");
    expect(() =>
      insert(mem, "55555555-5555-4555-8555-555555555555", "live_chat"),
    ).toThrow();
    const rows = mem.public.many(`SELECT id, target_type FROM content_reports`);
    expect(rows).toHaveLength(2);

    // Idempotent: DROP + ADD again changes nothing and cannot throw.
    run(sql0339, mem);
    const after = mem.public.many(`SELECT id FROM content_reports`);
    expect(after).toHaveLength(2);
    insert(mem, "66666666-6666-4666-8666-666666666666", "story");
    const final = mem.public.many(`SELECT id FROM content_reports`);
    expect(final).toHaveLength(3);
  });
});
