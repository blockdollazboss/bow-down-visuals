/**
 * Counter consistency, round 2 (stack1100 lane X5) — migration 0305
 * proven against pg-mem.
 *
 * migration 0305 repairs historic drift for the two counters whose row truth
 * is unambiguous and whose doors define them by this exact recompute:
 * challenges.entry_count = COUNT(challenge_entries), and
 * profile_videos.sound_use_count = COUNT(videos sharing the sound).
 * The statements are read out of the shipped migration file itself
 * and run against drifted seeds: counters must land on row truth,
 * already-true counters must not move, and a second run must be a
 * no-op. Follower counts are deliberately NOT in the file (the
 * L4/M3 settlement — pre-row-era values are unreconcilable); the
 * last test pins that absence so the repair can't quietly grow.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTestDb } from "../../lib/__tests__/test-db";

const MIGRATION_PATH = resolve(
  __dirname,
  "../../../../../lib/db/migrations/0305_counter_recompute_repairs.sql",
);
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, "utf8");

function updateStatements(sqlText: string): string[] {
  return sqlText
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const DDL = `
CREATE TABLE challenges (id uuid PRIMARY KEY, entry_count integer NOT NULL DEFAULT 0);
CREATE TABLE challenge_entries (challenge_id uuid NOT NULL, video_id uuid NOT NULL, PRIMARY KEY (challenge_id, video_id));
CREATE TABLE profile_videos (id uuid PRIMARY KEY, sound_id text, sound_use_count integer NOT NULL DEFAULT 0);
`;

const CH_DRIFTED = "33333333-3333-4333-8333-333333333301";
const CH_TRUE = "33333333-3333-4333-8333-333333333302";
const CH_EMPTY = "33333333-3333-4333-8333-333333333303";
const V1 = "22222222-2222-4222-8222-222222222201";
const V2 = "22222222-2222-4222-8222-222222222202";
const V3 = "22222222-2222-4222-8222-222222222203";
const V4 = "22222222-2222-4222-8222-222222222204";

let mem: any;
beforeEach(() => {
  const t = createTestDb();
  mem = t.mem;
  mem.public.none(DDL);
  // Drifted the way production got drifted: a deleted entry's count
  // never came back (entry_count 5, two entries stand; entry_count 1
  // is already true and must not move). Sound carriers claim 7 uses
  // where three videos share the sound; a soundless video keeps 0.
  mem.public.none(`
    INSERT INTO challenges (id, entry_count) VALUES ('${CH_DRIFTED}', 5), ('${CH_TRUE}', 1), ('${CH_EMPTY}', 4);
    INSERT INTO challenge_entries (challenge_id, video_id) VALUES
      ('${CH_DRIFTED}', '${V1}'), ('${CH_DRIFTED}', '${V2}'), ('${CH_TRUE}', '${V3}');
    INSERT INTO profile_videos (id, sound_id, sound_use_count) VALUES
      ('${V1}', 'sound-x', 7), ('${V2}', 'sound-x', 7), ('${V3}', 'sound-x', 7),
      ('${V4}', NULL, 0);
  `);
});

function runMigration() {
  for (const stmt of updateStatements(MIGRATION_SQL)) mem.public.none(stmt);
}

describe("migration 0305 — recompute repairs (stack1100 X5)", () => {
  it("the shipped file carries exactly the three recompute legs", () => {
    const stmts = updateStatements(MIGRATION_SQL);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toContain("challenge_entries");
    expect(stmts[1]).toContain("NOT IN (SELECT challenge_id FROM challenge_entries)");
    expect(stmts[2]).toContain("sound_id");
  });

  it("entry_count lands on the standing entries; the true count doesn't move", () => {
    runMigration();
    const rows = mem.public.many(`SELECT id, entry_count FROM challenges ORDER BY id;`);
    expect(rows.find((r: any) => r.id === CH_DRIFTED).entry_count).toBe(2);
    expect(rows.find((r: any) => r.id === CH_TRUE).entry_count).toBe(1);
    // A challenge whose entries all vanished lands on 0, not its stale 4.
    expect(rows.find((r: any) => r.id === CH_EMPTY).entry_count).toBe(0);
  });

  it("sound_use_count lands on the standing carriers of the sound", () => {
    runMigration();
    const rows = mem.public.many(`SELECT id, sound_use_count FROM profile_videos ORDER BY id;`);
    for (const id of [V1, V2, V3]) {
      expect(rows.find((r: any) => r.id === id).sound_use_count).toBe(3);
    }
    expect(rows.find((r: any) => r.id === V4).sound_use_count).toBe(0);
  });

  it("a second run is a no-op (idempotent)", () => {
    runMigration();
    runMigration();
    const ch = mem.public.many(`SELECT entry_count FROM challenges WHERE id = '${CH_DRIFTED}';`);
    expect(ch[0].entry_count).toBe(2);
    const pv = mem.public.many(`SELECT sound_use_count FROM profile_videos WHERE id = '${V1}';`);
    expect(pv[0].sound_use_count).toBe(3);
  });

  it("follower counts are NOT touched — the L4/M3 settlement holds", () => {
    expect(MIGRATION_SQL).not.toMatch(/follower_count\s*=/);
    expect(MIGRATION_SQL).not.toContain("UPDATE creator_profiles");
    expect(MIGRATION_SQL).not.toContain("UPDATE playlists");
  });
});
