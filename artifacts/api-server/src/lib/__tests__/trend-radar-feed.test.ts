/**
 * buildTrendFeed — the Trend Radar daily feed's DB half (lib/trend-radar).
 *
 * The pure scoring half is pinned in trend-radar.test.ts; this file pins
 * the three window collectors' SQL against a fake db that obeys the
 * name-resolution rule real Postgres enforces: inside a derived table
 * `( ... ) plays`, the outer query can only reference `plays.<column>` —
 * an outer FILTER still pointing at the inner alias `e.played_at` dies
 * 42P01 ("missing FROM-clause entry for table \"e\"") before any row is
 * read. That is exactly what shipped: collectTopicWindows and
 * collectFormatWindows reused the sound collector's `e.`-scoped window
 * fragments in their outer queries, so GET /api/trend-radar 500'd on
 * every load and the Trends page's Retry could never succeed
 * (QC-200 sitting finding). All data here is on-site play_events —
 * there is no external source in this rail.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({ quiet: false }));

vi.mock("@workspace/db", () => {
  const dialect = new PgDialect();
  const fakeDb = {
    execute: async (q: unknown) => {
      const { sql: text } = dialect.sqlToQuery(q as never) as {
        sql: string;
        params: unknown[];
      };
      const derivedAt = text.lastIndexOf(") plays");
      if (derivedAt >= 0 && /FILTER \(WHERE \(e\.played_at/.test(text.slice(derivedAt))) {
        throw Object.assign(new Error('missing FROM-clause entry for table "e"'), { code: "42P01" });
      }
      if (h.quiet) return { rows: [] };
      if (text.includes("AS media_id")) {
        return {
          rows: [{
            media_id: "31313131-3131-4131-8131-313131313131", title: "Song One",
            genre: "trap", slug: "testcreator", current_plays: 60, baseline_plays: 70,
          }],
        };
      }
      if (text.includes("UNION ALL")) {
        return { rows: [{ genre: "trap", current_plays: 60, baseline_plays: 70 }] };
      }
      if (text.includes("AS format")) {
        return { rows: [{ format: "short", current_plays: 60, baseline_plays: 70 }] };
      }
      return { rows: [] };
    },
  };
  return { db: fakeDb };
});

vi.mock("../logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

import { buildTrendFeed } from "../trend-radar";

describe("buildTrendFeed (Trend Radar daily feed)", () => {
  beforeEach(() => {
    h.quiet = false;
  });

  it("builds all three families from real window rows", async () => {
    const feed = await buildTrendFeed({});
    expect(feed.window).toBe("last_24h_vs_prior_7d");
    expect(feed.sounds).toHaveLength(1);
    expect(feed.topics).toHaveLength(1);
    expect(feed.formats).toHaveLength(1);
    /* 60 plays in 24h against a 70/7 = 10-per-day baseline pace = 6x lift. */
    expect(feed.sounds[0]?.trend.velocity).toBeCloseTo(6);
    expect(feed.topics[0]?.genre).toBe("trap");
    expect(feed.formats[0]?.format).toBe("short");
  });

  it("a quiet site answers with empty families — never a throw, never a padded row", async () => {
    h.quiet = true;
    const feed = await buildTrendFeed({});
    expect(feed.sounds).toEqual([]);
    expect(feed.topics).toEqual([]);
    expect(feed.formats).toEqual([]);
  });
});
