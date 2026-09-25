/**
 * Tests for the Analytics Dashboard v1 API.
 *
 * Covers: per-platform stat fetchers (with injectable fetch mocks — no live
 * provider calls), expired-token detection (reconnect prompt vs generic
 * error), graceful nulls for fields the provider doesn't return (never
 * fabricated), the AI prompt summarizer, the zod body schemas, and the
 * 1-credit AI pricing constants.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

import {
  ANALYTICS_INSIGHTS_CREDITS,
  ANALYTICS_SUGGESTIONS_CREDITS,
  AnalyticsProviderError,
  aiBodySchema,
  fetchFacebookStats,
  fetchInstagramStats,
  fetchTikTokStats,
  summarizeStatsForAI,
  type FetchImpl,
} from "../analytics";

function mockFetch(handler: (url: string) => { ok: boolean; status: number; body: any }): FetchImpl {
  return (async (url: string) => {
    const { ok, status, body } = handler(url);
    return {
      ok,
      status,
      json: async () => body,
    } as Response;
  }) as FetchImpl;
}

describe("AI pricing constants", () => {
  it("charges 1 credit for AI insights", () => {
    expect(ANALYTICS_INSIGHTS_CREDITS).toBe(1);
  });
  it("charges 1 credit for AI suggestions", () => {
    expect(ANALYTICS_SUGGESTIONS_CREDITS).toBe(1);
  });
});

describe("fetchInstagramStats", () => {
  it("returns followers, media count, and top content sorted by likes", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("/me/media")) {
        return {
          ok: true,
          status: 200,
          body: {
            data: [
              { id: "2", caption: "small", like_count: 10, comments_count: 1, timestamp: "2026-09-20T00:00:00Z", permalink: "https://ig/2" },
              { id: "1", caption: "big hit", like_count: 500, comments_count: 42, timestamp: "2026-09-24T00:00:00Z", permalink: "https://ig/1" },
            ],
          },
        };
      }
      return { ok: true, status: 200, body: { followers_count: 1234, media_count: 56 } };
    });
    const { stats, topContent } = await fetchInstagramStats("tok", fetchImpl);
    expect(stats.followers).toBe(1234);
    expect(stats.mediaCount).toBe(56);
    expect(topContent[0].id).toBe("1");
    expect(topContent[0].likes).toBe(500);
    expect(topContent).toHaveLength(2);
  });

  it("marks expired=true on a 401 so the UI shows a reconnect prompt", async () => {
    const fetchImpl = mockFetch(() => ({ ok: false, status: 401, body: { error: { code: 190, message: "Invalid OAuth access token." } } }));
    const err = await fetchInstagramStats("bad", fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(AnalyticsProviderError);
    expect((err as AnalyticsProviderError).expired).toBe(true);
  });

  it("marks expired=false on a generic 500", async () => {
    const fetchImpl = mockFetch(() => ({ ok: false, status: 500, body: {} }));
    const err = await fetchInstagramStats("tok", fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(AnalyticsProviderError);
    expect((err as AnalyticsProviderError).expired).toBe(false);
  });

  it("survives a top-media failure and still returns stats", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("/me/media")) throw new Error("network down");
      return { ok: true, status: 200, body: { followers_count: 9, media_count: 1 } };
    });
    const { stats, topContent } = await fetchInstagramStats("tok", fetchImpl);
    expect(stats.followers).toBe(9);
    expect(topContent).toEqual([]);
  });
});

describe("fetchTikTokStats", () => {
  it("returns nulls (not fakes) when the stats scope wasn't granted", async () => {
    const fetchImpl = mockFetch(() => ({
      ok: true,
      status: 200,
      body: { data: { user: { open_id: "abc", display_name: "creator" } } },
    }));
    const { stats, topContent } = await fetchTikTokStats("tok", fetchImpl);
    expect(stats.followers).toBeNull();
    expect(stats.mediaCount).toBeNull();
    expect(topContent).toEqual([]);
  });

  it("reads stats when the scope is granted", async () => {
    const fetchImpl = mockFetch(() => ({
      ok: true,
      status: 200,
      body: { data: { user: { open_id: "abc", follower_count: 777, video_count: 30, likes_count: 9000 } } },
    }));
    const { stats } = await fetchTikTokStats("tok", fetchImpl);
    expect(stats.followers).toBe(777);
    expect(stats.mediaCount).toBe(30);
    expect(stats.totalLikes).toBe(9000);
  });

  it("marks expired=true on a 401", async () => {
    const fetchImpl = mockFetch(() => ({ ok: false, status: 401, body: { error: { code: "invalid_access_token" } } }));
    const err = await fetchTikTokStats("bad", fetchImpl).catch((e) => e);
    expect((err as AnalyticsProviderError).expired).toBe(true);
  });
});

describe("fetchFacebookStats", () => {
  it("prefers followers_count and falls back to fan_count", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("/posts")) {
        return {
          ok: true,
          status: 200,
          body: { data: [{ id: "p1", message: "hello", created_time: "2026-09-24T00:00:00Z", likes: { summary: { total_count: 25 } }, comments: { summary: { total_count: 3 } }, permalink_url: "https://fb/p1" }] },
        };
      }
      return { ok: true, status: 200, body: { name: "My Page", fan_count: 321 } };
    });
    const { stats, topContent } = await fetchFacebookStats("page-tok", "123", fetchImpl);
    expect(stats.followers).toBe(321);
    expect(topContent[0].likes).toBe(25);
  });

  it("marks expired=true on Meta OAuth code 190", async () => {
    const fetchImpl = mockFetch(() => ({ ok: false, status: 400, body: { error: { code: 190, message: "Invalid OAuth access token." } } }));
    const err = await fetchFacebookStats("bad", "123", fetchImpl).catch((e) => e);
    expect((err as AnalyticsProviderError).expired).toBe(true);
  });
});

describe("summarizeStatsForAI", () => {
  it("renders unknown for missing fields and never invents numbers", () => {
    const summary = summarizeStatsForAI([
      {
        platform: "tiktok",
        username: "creator",
        stats: { followers: null, following: null, mediaCount: 12, totalLikes: null },
        topContent: [],
      },
    ]);
    expect(summary).toContain("followers: unknown");
    expect(summary).toContain("posts/videos: 12");
    expect(summary).not.toMatch(/followers: \d/);
  });

  it("includes top posts with engagement", () => {
    const summary = summarizeStatsForAI([
      {
        platform: "instagram",
        stats: { followers: 100, following: 50, mediaCount: 10, totalLikes: null },
        topContent: [{ caption: "viral hook", likes: 999, comments: 11 }],
      },
    ]);
    expect(summary).toContain("viral hook");
    expect(summary).toContain("999 likes");
  });
});

describe("aiBodySchema", () => {
  const valid = {
    platforms: [
      { platform: "instagram", stats: { followers: 10, following: 5, mediaCount: 3, totalLikes: null }, topContent: [] },
    ],
  };
  it("accepts a valid body", () => {
    expect(aiBodySchema.safeParse(valid).success).toBe(true);
  });
  it("rejects unknown platforms", () => {
    const bad = { platforms: [{ platform: "myspace", stats: null, topContent: [] }] };
    expect(aiBodySchema.safeParse(bad).success).toBe(false);
  });
  it("rejects empty platform lists", () => {
    expect(aiBodySchema.safeParse({ platforms: [] }).success).toBe(false);
  });
  it("caps topContent at 15 items (prompt-injection guard)", () => {
    const many = {
      platforms: [
        {
          platform: "tiktok",
          stats: null,
          topContent: Array.from({ length: 20 }, (_, i) => ({ caption: `x${i}`, likes: 1, comments: 0 })),
        },
      ],
    };
    expect(aiBodySchema.safeParse(many).success).toBe(false);
  });
});
