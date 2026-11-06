/**
 * GET /api/trend-radar + the C-30 outside-heat block — route behavior.
 *
 * The internal feed (buildTrendFeed) and the YouTube service
 * (getOutsideHeat) are mocked at their module seams; the REAL router
 * is mounted and answered over HTTP. Pins:
 *  - the outside family rides as its own additive `outsideHeat`
 *    block; the internal families pass through byte-identical;
 *  - dormancy: outsideHeat null (no key / Google down) → the rail
 *    answers exactly as it did before C-30;
 *  - a freak rejection from the outside service still cannot touch
 *    the rail (200, families intact, outsideHeat null);
 *  - an internal-feed failure still answers the honest 500 it
 *    always did — outside heat never masks an internal failure.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { Server } from "node:http";

const h = vi.hoisted(() => ({
  feed: null as null | Record<string, unknown>,
  feedThrows: false,
  heat: null as null | Record<string, unknown>,
  heatRejects: false,
}));

vi.mock("@workspace/db", () => ({
  db: {},
  postsTable: {},
  profileVideosTable: {},
  followsTable: {},
  creatorProfilesTable: {},
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.userId = "user-1";
    next();
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

vi.mock("../../lib/trend-radar", () => ({
  buildTrendFeed: async () => {
    if (h.feedThrows) throw new Error("db down");
    return h.feed;
  },
  buildRadarFeed: () => [],
  radarHeadline: () => "",
}));

vi.mock("../../lib/youtube-heat", () => ({
  getOutsideHeat: async () => {
    if (h.heatRejects) throw new Error("freak failure");
    return h.heat;
  },
}));

import trendRadarRouter from "../trend-radar";

const INTERNAL_FEED = {
  generatedAt: "2026-11-06T00:00:00.000Z",
  window: "last_24h_vs_prior_7d",
  sounds: [{ mediaId: "m1", title: "On-site Song", genre: "trap", slug: "testcreator", trend: { currentPlays: 60, baselineDaily: 10, velocity: 6, coldStart: false }, createLink: "/create?panel=video" }],
  topics: [],
  formats: [],
};

const HEAT = {
  source: "YouTube — most popular music videos right now",
  region: "US",
  fetchedAt: "2026-11-06T00:00:00.000Z",
  videos: [
    {
      videoId: "abc",
      title: "Outside Hit",
      channelTitle: "Outside Channel",
      viewCount: 9_000_001,
      likeCount: 12,
      thumbnailUrl: null,
      publishedAt: null,
      url: "https://www.youtube.com/watch?v=abc",
      source: "YouTube — most popular music videos right now",
    },
  ],
};

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use("/api", trendRadarRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.feed = INTERNAL_FEED;
  h.feedThrows = false;
  h.heat = null;
  h.heatRejects = false;
});

describe("GET /api/trend-radar — C-30 outside heat composition", () => {
  it("attaches the labeled outside family; internal families pass through unchanged", async () => {
    h.heat = HEAT;
    const res = await fetch(`${base}/api/trend-radar`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.sounds).toEqual(INTERNAL_FEED.sounds);
    expect(body.topics).toEqual([]);
    expect(body.window).toBe("last_24h_vs_prior_7d");
    expect(body.outsideHeat).toEqual(HEAT);
    /* Label honesty at the seam: YouTube's 9,000,001 views exist ONLY
       inside the outside block — never inside an on-site card. */
    expect(JSON.stringify(body.sounds)).not.toContain("9000001");
    expect(JSON.stringify(body.outsideHeat)).toContain("YouTube");
  });

  it("dormant (outsideHeat null) → the rail answers exactly as before C-30", async () => {
    const res = await fetch(`${base}/api/trend-radar`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.outsideHeat).toBeNull();
    expect(body.sounds).toEqual(INTERNAL_FEED.sounds);
  });

  it("a rejecting outside service cannot touch the rail", async () => {
    h.heatRejects = true;
    const res = await fetch(`${base}/api/trend-radar`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.outsideHeat).toBeNull();
    expect(body.sounds).toEqual(INTERNAL_FEED.sounds);
  });

  it("an internal failure still answers the honest 500 — outside heat never masks it", async () => {
    h.feedThrows = true;
    h.heat = HEAT;
    const res = await fetch(`${base}/api/trend-radar`);
    expect(res.status).toBe(500);
  });
});
