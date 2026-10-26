/**
 * Song credits (Stack-200 N1) — DB layer batch read.
 * The library list attaches credits via loadCanonicalCreditsForSongs;
 * this pins that the batch path (a) merges writers + entries per song,
 * (b) inherits from a parent song in the same batch, (c) serves an
 * honest empty for a legacy song, and (d) never throws when the
 * credits tables aren't migrated yet (entries degrade, writers from
 * the existing registry still flow).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

const testState = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return testState.db;
    },
  };
});

import { loadCanonicalCreditsForSongs } from "../song-credits-db";
import { createTestDb } from "./test-db";
import { sql } from "drizzle-orm";

const OWNER = randomUUID();
const CO = randomUUID();
const OWNER_PROFILE = randomUUID();
const CO_PROFILE = randomUUID();

const DDL = `
CREATE TABLE songs (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, parent_song_id uuid);
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text, display_name text);
CREATE TABLE publishing_split_registrations (
  id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, song_kind text NOT NULL DEFAULT 'song',
  song_id uuid NOT NULL, song_title text NOT NULL DEFAULT '', has_dispute boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE publishing_split_writers (
  id uuid PRIMARY KEY, registration_id uuid NOT NULL, writer_name text NOT NULL,
  writer_user_id uuid, writer_profile_id uuid, share_pct numeric(5,2) NOT NULL,
  confirmation_status text NOT NULL DEFAULT 'pending', dispute_note text,
  confirmed_at timestamptz, disputed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());`;

const ENTRIES_DDL = `
CREATE TABLE song_credit_entries (
  id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, song_kind text NOT NULL DEFAULT 'song',
  song_id uuid NOT NULL, role text NOT NULL, display_name text NOT NULL,
  credit_user_id uuid, credit_profile_id uuid, detail text, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE song_credit_revisions (
  id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, song_kind text NOT NULL DEFAULT 'song',
  song_id uuid NOT NULL, version integer NOT NULL, snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());`;

let parentId: string;
let childId: string;
let legacyId: string;

async function seed(withEntries: boolean) {
  const { db, mem } = createTestDb();
  mem.public.none(DDL);
  if (withEntries) mem.public.none(ENTRIES_DDL);
  testState.db = db;
  parentId = randomUUID();
  childId = randomUUID();
  legacyId = randomUUID();
  await db.execute(sql`
    INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES
      (${OWNER_PROFILE}, ${OWNER}, 'thy-cheat-code', 'Thy Cheat Code'),
      (${CO_PROFILE}, ${CO}, 'co-writer', 'Co Writer')`);
  const regId = randomUUID();
  await db.execute(sql`
    INSERT INTO publishing_split_registrations (id, owner_user_id, song_kind, song_id, song_title)
    VALUES (${regId}, ${OWNER}, 'song', ${parentId}, 'Midnight Tide')`);
  await db.execute(sql`
    INSERT INTO publishing_split_writers (id, registration_id, writer_name, writer_user_id, writer_profile_id, share_pct, confirmation_status) VALUES
      (${randomUUID()}, ${regId}, 'Thy Cheat Code', ${OWNER}, ${OWNER_PROFILE}, 60, 'confirmed'),
      (${randomUUID()}, ${regId}, 'Co Writer', ${CO}, ${CO_PROFILE}, 40, 'pending')`);
  if (withEntries) {
    await db.execute(sql`
      INSERT INTO song_credit_entries (id, owner_user_id, song_kind, song_id, role, display_name, credit_user_id, credit_profile_id, sort_order)
      VALUES (${randomUUID()}, ${OWNER}, 'song', ${parentId}, 'producer', 'Co Writer', ${CO}, ${CO_PROFILE}, 0)`);
  }
  return [
    { id: parentId, title: "Midnight Tide", user_id: OWNER, parent_song_id: null },
    { id: childId, title: "Midnight Tide (Remix)", user_id: OWNER, parent_song_id: parentId },
    { id: legacyId, title: "Old Upload", user_id: OWNER, parent_song_id: null },
  ];
}

describe("loadCanonicalCreditsForSongs", () => {
  beforeEach(() => {
    testState.db = null;
  });

  it("merges writers + entries per song, inherits into the remix, honest empty for legacy", async () => {
    const songs = await seed(true);
    const map = await loadCanonicalCreditsForSongs(songs);
    const parent = map.get(parentId)!;
    const co = parent.credits.find((c) => c.name === "Co Writer")!;
    expect(co.roles).toContain("writer");
    expect(co.roles).toContain("producer");
    expect(co.profileSlug).toBe("co-writer");
    expect(parent.writerSplitsValid).toBe(true);

    const child = map.get(childId)!;
    const childCo = child.credits.find((c) => c.name === "Co Writer")!;
    expect(childCo.inheritedFrom).toEqual({ kind: "song", id: parentId });
    expect(child.inheritedFromAnchors).toEqual([{ kind: "song", id: parentId }]);

    const legacy = map.get(legacyId)!;
    /* The owner-as-artist credit is the only one a legacy song can
       honestly show — it comes from the owner's real profile record. */
    expect(legacy.credits.every((c) => c.sources.includes("owner"))).toBe(true);
    expect(legacy.writerSplitsValid).toBeNull();
  });

  it("degrades without the credits tables: writers still flow, nothing throws", async () => {
    const songs = await seed(false);
    const map = await loadCanonicalCreditsForSongs(songs);
    const parent = map.get(parentId)!;
    const co = parent.credits.find((c) => c.name === "Co Writer")!;
    expect(co.roles).toContain("writer");
    expect(co.roles).not.toContain("producer");
  });
});
