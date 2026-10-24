/**
 * viral-spike-watch.test.ts — Lane 11 (Stack-100 #3, Wave 3).
 *
 * The detector's contract, pinned:
 * - a spike fires ONCE per episode (episode row mutes re-alerts);
 * - no fire under the 5× multiple, under the 50-play floor, or on
 *   flat-but-high (baseline-relative, never absolute);
 * - cold start (zero baseline) needs 100 plays in 24h, not just "some";
 * - re-arm only after the metric falls back near baseline — a dip into
 *   the hysteresis band (below fire line, above re-arm line) stays
 *   muted and NOT re-armed;
 * - after re-arm, a fresh spike alerts again;
 * - the alert carries the REAL computed numbers (current, baseline
 *   total, per-day baseline, multiple) and links to the item's page;
 * - missing episode state fails CLOSED: no alerts at all.
 *
 * The fake db answers db.execute by aggregating a seeded play_events
 * log by event age over the windows the SQL names (24h current, prior
 * 7d baseline) — the same honesty pattern as discovery-charts-windows:
 * a detector that secretly read the cumulative counters would fail
 * here, because the seeds give counters no role at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_A = "11111111-1111-4111-8111-111111111111";
const PROFILE_B = "12121212-1212-4212-8212-121212121212";
const TRACK_SPIKE = "22222222-2222-4222-8222-222222222222";
const TRACK_FLAT = "23232323-2323-4232-8232-232323232323";
const TRACK_QUIET = "24242424-2424-4242-8242-242424242424";
const VIDEO_COLD = "33333333-3333-4333-8333-333333333333";
const VIDEO_SMALL = "34343434-3434-4343-8343-343434343434";

const dialect = new PgDialect();
function renderSql(q: unknown): string {
  return dialect.sqlToQuery(q as never).sql;
}
function renderParams(q: unknown): unknown[] {
  return dialect.sqlToQuery(q as never).params as unknown[];
}

const h = vi.hoisted(() => {
  const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const PA = "11111111-1111-4111-8111-111111111111";
  const PB = "12121212-1212-4212-8212-121212121212";
  return {
    state: {
      events: [] as Array<{ kind: string; mediaId: string; ageHours: number }>,
      episodes: [] as Array<Record<string, unknown>>,
      notifications: [] as Array<Record<string, unknown>>,
      failEpisodes: false,
    },
    TRACKS: {
      "22222222-2222-4222-8222-222222222222": { profileId: PA, title: "Midnight Run" },
      "23232323-2323-4232-8232-232323232323": { profileId: PA, title: "Steady Giant" },
      "24242424-2424-4242-8242-242424242424": { profileId: PB, title: "Quiet One" },
    } as Record<string, { profileId: string; title: string }>,
    VIDEOS: {
      "33333333-3333-4333-8333-333333333333": { profileId: PB, title: "First Upload" },
      "34343434-3434-4343-8343-343434343434": { profileId: PB, title: "Small Spark" },
    } as Record<string, { profileId: string; title: string }>,
    PROFILES: {
      [PA]: { slug: "steady-creator", userId: OWNER_ID },
      [PB]: { slug: "fresh-creator", userId: OWNER_ID },
    } as Record<string, { slug: string; userId: string }>,
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { notificationsTable, viralSpikeEpisodesTable } = actual;
  const state = h.state;
  const TRACKS = h.TRACKS;
  const VIDEOS = h.VIDEOS;
  const PROFILES = h.PROFILES;

  function aggregate(catalog: Record<string, { profileId: string; title: string }>, kind: string) {
    const rows: Array<Record<string, unknown>> = [];
    for (const [mediaId, meta] of Object.entries(catalog)) {
      const evs = state.events.filter((e) => e.kind === kind && e.mediaId === mediaId && e.ageHours < 192);
      if (evs.length === 0) continue; // GROUP BY: no events in span, no row
      const prof = PROFILES[meta.profileId]!;
      rows.push({
        media_id: mediaId,
        title: meta.title,
        profile_id: meta.profileId,
        slug: prof.slug,
        owner_user_id: prof.userId,
        current_plays: evs.filter((e) => e.ageHours < 24).length,
        baseline_plays: evs.filter((e) => e.ageHours >= 24).length,
      });
    }
    return rows;
  }

  function thenable(value: unknown): any {
    return { then: (res: any, rej: any) => Promise.resolve(value).then(res, rej) };
  }

  const fakeDb = {
    execute: async (q: unknown) => {
      const text = renderSql(q);
      if (text.includes("profile_tracks")) return { rows: aggregate(TRACKS, "track") };
      if (text.includes("profile_videos")) return { rows: aggregate(VIDEOS, "video") };
      throw new Error(`fake db: unexpected execute: ${text.slice(0, 80)}`);
    },
    select: (_fields?: unknown) => ({
      from: (table: unknown) => {
        if (table === viralSpikeEpisodesTable) {
          if (state.failEpisodes) {
            return {
              then: (_res: any, rej: any) =>
                Promise.reject(new Error('relation "viral_spike_episodes" does not exist')).then(_res, rej),
            };
          }
          return thenable(state.episodes.map((r) => ({ ...r })));
        }
        return thenable([]);
      },
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (table === notificationsTable) {
          state.notifications.push({ ...v });
          return thenable([]);
        }
        if (table === viralSpikeEpisodesTable) {
          return {
            onConflictDoUpdate: (cfg: { set: Record<string, unknown> }) => {
              const existing = state.episodes.find((r) => r["kind"] === v["kind"] && r["mediaId"] === v["mediaId"]);
              if (existing) Object.assign(existing, cfg.set);
              else state.episodes.push({ ...v });
              return thenable([]);
            },
            then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
          };
        }
        return thenable([]);
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          if (table === viralSpikeEpisodesTable) {
            const params = renderParams(cond).map(String);
            const ep = state.episodes.find((r) => params.includes(String(r["kind"])) && params.includes(String(r["mediaId"])));
            if (ep) Object.assign(ep, patch);
          }
          return thenable([]);
        },
      }),
    }),
  };

  return { ...actual, db: fakeDb };
});

import {
  evaluateSpike,
  hasFallenBack,
  spikeNotification,
  runViralSpikeWatch,
  __testHooks,
  SPIKE_WATCH,
} from "../viral-spike-watch";

/** Seed n events: current-window (age 1–20h) or baseline (age 25–184h). */
function seed(kind: string, mediaId: string, current: number, baseline: number) {
  for (let i = 0; i < current; i++) h.state.events.push({ kind, mediaId, ageHours: 1 + (i % 20) });
  for (let i = 0; i < baseline; i++) h.state.events.push({ kind, mediaId, ageHours: 25 + (i % 160) });
}
function clearItem(kind: string, mediaId: string) {
  h.state.events = h.state.events.filter((e) => !(e.kind === kind && e.mediaId === mediaId));
}

beforeEach(() => {
  h.state.events = [];
  h.state.episodes = [];
  h.state.notifications = [];
  h.state.failEpisodes = false;
  __testHooks.resetThrottle();
});

describe("evaluateSpike — the threshold definition", () => {
  it("fires at 5x the item's own baseline with floor + lift met", () => {
    // 100/day baseline (700 in 7d), 600 today.
    expect(evaluateSpike(600, 700)).toEqual({ spike: true, coldStart: false, baselineDaily: 100 });
  });

  it("does not fire under the multiple", () => {
    expect(evaluateSpike(300, 700).spike).toBe(false); // 3x
    expect(evaluateSpike(499, 700).spike).toBe(false); // just under 5x
  });

  it("does not fire under the absolute floor, even at a huge multiple", () => {
    expect(evaluateSpike(30, 7).spike).toBe(false); // 30x of 1/day, but only 30 plays
    expect(evaluateSpike(49, 0 + 7).spike).toBe(false);
  });

  it("does not fire on flat-but-high (baseline-relative, not absolute)", () => {
    expect(evaluateSpike(1000, 7000).spike).toBe(false); // 1,000/day, every day
    expect(evaluateSpike(1100, 7000).spike).toBe(false); // +10% wobble
  });

  it("cold start: zero baseline needs the cold-start minimum, not just plays", () => {
    expect(evaluateSpike(99, 0).spike).toBe(false);
    expect(evaluateSpike(100, 0)).toEqual({ spike: true, coldStart: true, baselineDaily: 0 });
    expect(evaluateSpike(500, 0).spike).toBe(true);
  });

  it("constants are the stated definition", () => {
    expect(SPIKE_WATCH.MULTIPLE).toBe(5);
    expect(SPIKE_WATCH.MIN_CURRENT_PLAYS).toBe(50);
    expect(SPIKE_WATCH.MIN_LIFT_PLAYS).toBe(25);
    expect(SPIKE_WATCH.COLD_START_MIN_PLAYS).toBe(100);
    expect(SPIKE_WATCH.BASELINE_DAYS).toBe(7);
    expect(SPIKE_WATCH.CURRENT_WINDOW_HOURS).toBe(24);
  });
});

describe("hasFallenBack — the re-arm line", () => {
  it("re-arms at or below 1.5x baseline", () => {
    expect(hasFallenBack(150, 100)).toBe(true);
    expect(hasFallenBack(151, 100)).toBe(false);
  });
  it("has a floor so a zero-baseline item must actually go quiet", () => {
    expect(hasFallenBack(10, 0)).toBe(true);
    expect(hasFallenBack(11, 0)).toBe(false);
    expect(hasFallenBack(0, 0)).toBe(true);
  });
});

describe("spikeNotification — real numbers in the alert", () => {
  it("names the item, the computed numbers, and links to the item's page", () => {
    const n = spikeNotification(
      { kind: "track", mediaId: TRACK_SPIKE, title: "Midnight Run", profileId: PROFILE_A, slug: "steady-creator", ownerUserId: OWNER, currentPlays: 120, baselinePlays: 70 },
      evaluateSpike(120, 70),
    );
    expect(n.kind).toBe("viral_spike");
    expect(n.title).toContain("Midnight Run");
    expect(n.body).toContain("120 plays in the last 24 hours");
    expect(n.body).toContain("12× its usual ~10 plays a day");
    expect(n.body).toContain("70 plays over the prior 7 days");
    expect(n.link).toBe("/artist/steady-creator");
  });

  it("cold-start copy says standing start, never a fake multiple", () => {
    const n = spikeNotification(
      { kind: "video", mediaId: VIDEO_COLD, title: "First Upload", profileId: PROFILE_B, slug: "fresh-creator", ownerUserId: OWNER, currentPlays: 150, baselinePlays: 0 },
      evaluateSpike(150, 0),
    );
    expect(n.body).toContain("150 plays in the last 24 hours");
    expect(n.body).toContain("standing start");
    expect(n.body).not.toContain("×");
  });
});

describe("runViralSpikeWatch — episodes end to end", () => {
  it("fires once per episode: a second pass over the same spike sends nothing new", async () => {
    seed("track", TRACK_SPIKE, 120, 70); // 10/day baseline, 120 today = 12x
    const first = await runViralSpikeWatch({ force: true });
    expect(first.error).toBe(false);
    expect(first.fired).toHaveLength(1);
    expect(first.fired[0]).toMatchObject({ mediaId: TRACK_SPIKE, currentPlays: 120, baselineDaily: 10 });
    expect(h.state.notifications).toHaveLength(1);
    expect(h.state.notifications[0]).toMatchObject({ userId: OWNER, kind: "viral_spike", link: "/artist/steady-creator" });
    expect(String(h.state.notifications[0]!["body"])).toContain("120 plays");
    const ep = h.state.episodes.find((r) => r["mediaId"] === TRACK_SPIKE);
    expect(ep).toMatchObject({ episodeState: "active", baselineDaily: 10, lastCurrentPlays: 120 });

    const second = await runViralSpikeWatch({ force: true });
    expect(second.fired).toHaveLength(0);
    expect(h.state.notifications).toHaveLength(1); // still exactly one alert
  });

  it("no fire under threshold, and no fire on flat-but-high, in the same pass", async () => {
    seed("track", TRACK_SPIKE, 300, 700); // 3x of 100/day — under multiple
    seed("video", VIDEO_SMALL, 1000, 7000); // 1,000/day flat — huge but flat
    const res = await runViralSpikeWatch({ force: true });
    expect(res.fired).toHaveLength(0);
    expect(h.state.notifications).toHaveLength(0);
    expect(h.state.episodes).toHaveLength(0);
  });

  it("cold start fires at 100+ with zero baseline, not at 80", async () => {
    seed("video", VIDEO_COLD, 150, 0);
    seed("video", VIDEO_SMALL, 80, 0);
    const res = await runViralSpikeWatch({ force: true });
    expect(res.fired).toHaveLength(1);
    expect(res.fired[0]!.mediaId).toBe(VIDEO_COLD);
    expect(String(h.state.notifications[0]!["body"])).toContain("standing start");
  });

  it("hysteresis: a dip below the fire line but above the re-arm line stays muted and armed", async () => {
    seed("track", TRACK_SPIKE, 120, 70);
    await runViralSpikeWatch({ force: true });
    expect(h.state.notifications).toHaveLength(1);

    clearItem("track", TRACK_SPIKE);
    seed("track", TRACK_SPIKE, 40, 70); // 40 today: below 50 floor, above re-arm line (15)
    const dip = await runViralSpikeWatch({ force: true });
    expect(dip.rearmed).toBe(0);
    expect(dip.fired).toHaveLength(0);
    expect(h.state.episodes.find((r) => r["mediaId"] === TRACK_SPIKE)).toMatchObject({ episodeState: "active" });

    // …and if it re-spikes from inside the same episode, still no second alert.
    clearItem("track", TRACK_SPIKE);
    seed("track", TRACK_SPIKE, 300, 70);
    const respike = await runViralSpikeWatch({ force: true });
    expect(respike.fired).toHaveLength(0);
    expect(h.state.notifications).toHaveLength(1);
  });

  it("re-arms after falling back near baseline, then a fresh spike alerts again", async () => {
    seed("track", TRACK_SPIKE, 120, 70);
    await runViralSpikeWatch({ force: true });

    clearItem("track", TRACK_SPIKE);
    seed("track", TRACK_SPIKE, 5, 70); // back to ~baseline quiet
    const back = await runViralSpikeWatch({ force: true });
    expect(back.rearmed).toBe(1);
    expect(h.state.episodes.find((r) => r["mediaId"] === TRACK_SPIKE)).toMatchObject({ episodeState: "rearmed" });
    expect(h.state.notifications).toHaveLength(1);

    clearItem("track", TRACK_SPIKE);
    seed("track", TRACK_SPIKE, 200, 70); // a NEW episode
    const again = await runViralSpikeWatch({ force: true });
    expect(again.fired).toHaveLength(1);
    expect(h.state.notifications).toHaveLength(2);
    expect(String(h.state.notifications[1]!["body"])).toContain("200 plays in the last 24 hours");
  });

  it("an active episode whose item went fully silent re-arms via the no-events sweep", async () => {
    h.state.episodes.push({
      kind: "track", mediaId: TRACK_QUIET, profileId: PROFILE_B, ownerUserId: OWNER,
      episodeState: "active", baselineDaily: 3, lastCurrentPlays: 400,
    });
    const res = await runViralSpikeWatch({ force: true });
    expect(res.rearmed).toBe(1);
    expect(h.state.episodes[0]).toMatchObject({ episodeState: "rearmed", lastCurrentPlays: 0 });
    expect(h.state.notifications).toHaveLength(0);
  });

  it("fails closed when episode state cannot be read: zero alerts", async () => {
    seed("track", TRACK_SPIKE, 500, 70); // an undeniable spike
    h.state.failEpisodes = true;
    const res = await runViralSpikeWatch({ force: true });
    expect(res.error).toBe(true);
    expect(res.fired).toHaveLength(0);
    expect(h.state.notifications).toHaveLength(0);
  });

  it("throttle: an unforced second pass inside the interval is skipped", async () => {
    seed("track", TRACK_SPIKE, 120, 70);
    const first = await runViralSpikeWatch();
    expect(first.skipped).toBe(false);
    const second = await runViralSpikeWatch();
    expect(second.skipped).toBe(true);
    expect(h.state.notifications).toHaveLength(1);
  });
});
