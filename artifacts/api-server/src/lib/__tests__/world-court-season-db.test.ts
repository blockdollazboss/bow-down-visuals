/**
 * Court seasons — the DB store against real Postgres semantics
 * (pg-mem): the windowed standings read and the settlement row.
 *
 * Pinned contract:
 * - seasonStandings reads the ladder's own sources with the
 *   ladder's own conditions (lib/creator-rank countRankSources),
 *   windowed to [start, end) on each source's event timestamp:
 *   created_at for work/follows/streams/orders/shop sales,
 *   COALESCE(paid_at, created_at) for jar tips, creator_credited_at
 *   for stream tips, joined_at for memberships. The window is
 *   start-inclusive and end-exclusive, so adjacent seasons tile
 *   with no double-count and no gap.
 * - The King's official profile never stands in its own court.
 * - markSettled is the idempotency anchor: the season_key primary
 *   key admits exactly one row; a second settle returns false and
 *   the frozen standings stand untouched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

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

import { createTestDb } from "./test-db";
import { dbCourtSeasonStore, seasonSpan, settleCourtSeason } from "../world-court-season";

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL UNIQUE, slug text NOT NULL,
  display_name text NOT NULL, is_official boolean NOT NULL DEFAULT false
);
CREATE TABLE profile_tracks (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE export_jobs (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, state text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE follows (
  follower_user_id uuid NOT NULL, profile_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE live_streams (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tip_jar_tips (
  id uuid PRIMARY KEY, page_user_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending_payment',
  created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz
);
CREATE TABLE live_stream_tips (
  id uuid PRIMARY KEY, creator_user_id uuid NOT NULL, creator_credited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE world_stage_tips (
  id uuid PRIMARY KEY, from_user_id text NOT NULL, to_user_id text NOT NULL,
  amount_vb integer NOT NULL, room_id text NOT NULL, idempotency_key text NOT NULL,
  creator_credited_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fan_members (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, stripe_session_id text,
  status text NOT NULL DEFAULT 'active', joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE court_season_settlements (
  season_key text PRIMARY KEY, ordinal integer NOT NULL, name text NOT NULL,
  subtitle text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now(), standings jsonb NOT NULL DEFAULT '[]'::jsonb,
  herald_text text NOT NULL DEFAULT ''
);`;

const u = () => randomUUID();
const UA = randomUUID();
const UB = randomUUID();
const UC = randomUUID();
const UKING = randomUUID();
const PA = randomUUID();
const PB = randomUUID();
const PC = randomUUID();
const PKING = randomUUID();

let db: any;

async function ins(query: string) {
  await db.execute(sql.raw(query));
}

beforeEach(async () => {
  const t = createTestDb();
  t.mem.public.none(DDL);
  testState.db = t.db;
  db = t.db;

  await ins(`INSERT INTO creator_profiles (id, user_id, slug, display_name, is_official) VALUES
    ('${PA}', '${UA}', 'ada', 'Ada', false),
    ('${PB}', '${UB}', 'bo', 'Bo', false),
    ('${PC}', '${UC}', 'cy', 'Cy', false),
    ('${PKING}', '${UKING}', 'thy-cheat-code', 'Thy Cheat Code', true)`);

  /* Ada's Season I: one of everything, plus a decoy beside each
   * source that the window or the condition must exclude. */
  await ins(`INSERT INTO profile_tracks (id, profile_id, is_published, created_at) VALUES
    ('${u()}', '${PA}', true,  '2026-10-15T12:00:00Z'),
    ('${u()}', '${PA}', true,  '2026-09-30T23:59:59Z'),
    ('${u()}', '${PA}', true,  '2026-11-01T00:00:00Z'),
    ('${u()}', '${PA}', false, '2026-10-10T12:00:00Z')`);
  await ins(`INSERT INTO profile_videos (id, profile_id, is_published, created_at) VALUES
    ('${u()}', '${PA}', true, '2026-10-31T23:59:59Z')`);
  await ins(`INSERT INTO export_jobs (id, user_id, state, created_at) VALUES
    ('${u()}', '${UA}', 'done',   '2026-10-05T12:00:00Z'),
    ('${u()}', '${UA}', 'failed', '2026-10-06T12:00:00Z'),
    ('${u()}', '${UA}', 'done',   '2026-09-01T12:00:00Z')`);
  await ins(`INSERT INTO follows (follower_user_id, profile_id, created_at) VALUES
    ('${u()}', '${PA}', '2026-10-20T12:00:00Z'),
    ('${u()}', '${PA}', '2026-11-02T12:00:00Z')`);
  await ins(`INSERT INTO live_streams (id, user_id, created_at) VALUES
    ('${u()}', '${UA}', '2026-10-20T12:00:00Z')`);
  await ins(`INSERT INTO tip_jar_tips (id, page_user_id, status, created_at, paid_at) VALUES
    ('${u()}', '${UA}', 'paid',            '2026-09-20T12:00:00Z', '2026-10-03T12:00:00Z'),
    ('${u()}', '${UA}', 'pending_payment', '2026-10-04T12:00:00Z', NULL),
    ('${u()}', '${UA}', 'paid',            '2026-09-20T12:00:00Z', '2026-09-21T12:00:00Z')`);
  await ins(`INSERT INTO live_stream_tips (id, creator_user_id, creator_credited_at, created_at) VALUES
    ('${u()}', '${UA}', '2026-10-08T12:00:00Z', '2026-10-08T12:00:00Z'),
    ('${u()}', '${UA}', NULL,                   '2026-10-09T12:00:00Z')`);
  await ins(`INSERT INTO world_stage_tips (id, from_user_id, to_user_id, amount_vb, room_id, idempotency_key, creator_credited_at, created_at) VALUES
    ('${u()}', '${UB}', '${UA}', 500, 'world:throne-hall', 'k-ada-in',  '2026-10-09T12:00:00Z', '2026-10-09T12:00:00Z'),
    ('${u()}', '${UB}', '${UA}', 500, 'world:throne-hall', 'k-ada-null', NULL,                   '2026-10-10T12:00:00Z'),
    ('${u()}', '${UB}', '${UA}', 500, 'world:throne-hall', 'k-ada-sept', '2026-09-15T12:00:00Z', '2026-09-15T12:00:00Z')`);
  await ins(`INSERT INTO store_orders (id, profile_id, status, created_at) VALUES
    ('${u()}', '${PA}', 'completed', '2026-10-11T12:00:00Z'),
    ('${u()}', '${PA}', 'refunded',  '2026-10-11T13:00:00Z')`);
  await ins(`INSERT INTO shop_events (id, user_id, event_type, created_at) VALUES
    ('${u()}', '${UA}', 'sale', '2026-10-12T12:00:00Z'),
    ('${u()}', '${UA}', 'view', '2026-10-12T13:00:00Z')`);
  await ins(`INSERT INTO fan_members (id, user_id, stripe_session_id, status, joined_at) VALUES
    ('${u()}', '${UA}', 'sess_1', 'active',   '2026-10-13T12:00:00Z'),
    ('${u()}', '${UA}', NULL,     'active',   '2026-10-14T12:00:00Z'),
    ('${u()}', '${UA}', 'sess_2', 'canceled', '2026-10-15T12:00:00Z')`);

  /* Bo: a single in-window track. The King: plenty of in-window
   * work that must never place him in his own court. */
  await ins(`INSERT INTO profile_tracks (id, profile_id, is_published, created_at) VALUES
    ('${u()}', '${PB}', true, '2026-10-02T12:00:00Z'),
    ('${u()}', '${PKING}', true, '2026-10-02T12:00:00Z'),
    ('${u()}', '${PKING}', true, '2026-10-03T12:00:00Z')`);
});

const S1 = seasonSpan(1);

describe("seasonStandings — the ladder's sources, windowed", () => {
  it("counts exactly the in-window, qualifying events per source", async () => {
    const inputs = await dbCourtSeasonStore.seasonStandings(S1.startsAt, S1.endsAt);
    const ada = inputs.find((i) => i.userId === UA)!;
    expect(ada.displayName).toBe("Ada");
    expect(ada.counts).toEqual({
      publishedTracks: 1,
      publishedVideos: 1,
      exports: 1,
      followers: 1,
      streamsHosted: 1,
      tipsReceived: 3,
      sales: 2,
      membershipsSold: 1,
    });
    const bo = inputs.find((i) => i.userId === UB)!;
    expect(bo.counts.publishedTracks).toBe(1);
    expect(bo.counts.publishedVideos).toBe(0);
    const cy = inputs.find((i) => i.userId === UC)!;
    expect(cy.counts).toEqual({
      publishedTracks: 0,
      publishedVideos: 0,
      exports: 0,
      followers: 0,
      streamsHosted: 0,
      tipsReceived: 0,
      sales: 0,
      membershipsSold: 0,
    });
  });

  it("the official profile never stands in its own court", async () => {
    const inputs = await dbCourtSeasonStore.seasonStandings(S1.startsAt, S1.endsAt);
    expect(inputs.map((i) => i.userId)).not.toContain(UKING);
  });

  it("adjacent seasons tile: Season II sees only its own month", async () => {
    const s2 = seasonSpan(2);
    const inputs = await dbCourtSeasonStore.seasonStandings(s2.startsAt, s2.endsAt);
    const ada = inputs.find((i) => i.userId === UA)!;
    // The Nov-1 track and the Nov-2 follow land here — nothing else.
    expect(ada.counts.publishedTracks).toBe(1);
    expect(ada.counts.followers).toBe(1);
    expect(ada.counts.publishedVideos).toBe(0);
    expect(ada.counts.tipsReceived).toBe(0);
  });
});

describe("the settlement row — freeze + idempotency on the real table", () => {
  it("settles once: the frozen standings survive a re-run untouched", async () => {
    const first = await settleCourtSeason(dbCourtSeasonStore, S1, new Date("2026-11-01T00:01:00Z"));
    expect(first.inserted).toBe(true);
    expect(first.standings.map((s) => [s.place, s.displayName, s.points])).toEqual([
      [1, "Ada", 121], // 10+15+5+1+10+ (3 tips ×5) + (2 sales ×20) + 25
      [2, "Bo", 10],
    ]);
    // Ada's lifetime rank at the turn: the same sources unwindowed
    // (3 published tracks incl. the September + November ones,
    // 2 done exports, 2 follows, 3 paid jar tips…) — ★ computed by
    // the ladder itself; here we pin only that it froze with her.
    expect(first.standings[0]!.stars).toBeGreaterThanOrEqual(1);
    expect(first.standings[0]!.title.length).toBeGreaterThan(0);

    const row = await dbCourtSeasonStore.getSettlement("2026-10");
    expect(row).not.toBeNull();
    expect(row!.ordinal).toBe(1);
    expect(row!.standings).toEqual(first.standings);
    expect(row!.heraldText).toContain("First of the court: Ada, Bo.");

    const second = await settleCourtSeason(dbCourtSeasonStore, S1, new Date("2026-11-05T00:00:00Z"));
    expect(second.inserted).toBe(false);
    const after = await dbCourtSeasonStore.getSettlement("2026-10");
    expect(after!.standings).toEqual(first.standings);
    expect(after!.settledAt).toEqual(row!.settledAt);

    const list = await dbCourtSeasonStore.listSettlements();
    expect(list.map((r) => r.seasonKey)).toEqual(["2026-10"]);
  });
});
