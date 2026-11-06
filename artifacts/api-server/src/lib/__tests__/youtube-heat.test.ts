/**
 * youtube-heat — Trend Radar's OUTSIDE-HEAT family (C-30).
 *
 * Mocked fetch ONLY (no live calls, ever). Pins:
 *  - ship-dark dormancy: no YOUTUBE_API_KEY → null, and fetch is
 *    never even attempted;
 *  - the chart request shape (videos.list, chart=mostPopular,
 *    Music category, region) at exactly ONE attempt per window;
 *  - shaping honesty: rows are dropped, never estimated, when a
 *    real view count is missing; every row carries the YouTube
 *    source label and a youtube.com click-through;
 *  - the key never appears in the returned payload;
 *  - the 20-minute success cache, the 5-minute failure cache, and
 *    single-flight under concurrency (the quota-safety contract);
 *  - fail-closed dormancy on every error class (HTTP error, quota
 *    403, transport throw, non-JSON, shapeless body, empty chart).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getOutsideHeat,
  getYoutubeApiKey,
  isYoutubeHeatConfigured,
  youtubeHeatRegion,
  resetYoutubeHeatCache,
  YOUTUBE_HEAT_SOURCE,
  YOUTUBE_HEAT_CACHE_TTL_MS,
  YOUTUBE_HEAT_FAILURE_TTL_MS,
} from "../youtube-heat";

const KEY = "test-key-SECRET-123";
const ENV = { YOUTUBE_API_KEY: KEY } as NodeJS.ProcessEnv;

function chartBody(items: unknown[]) {
  return { items };
}

function videoItem(id: string, viewCount: string | number = "1234567") {
  return {
    id,
    snippet: {
      title: `Video ${id}`,
      channelTitle: `Channel ${id}`,
      publishedAt: "2026-11-01T00:00:00Z",
      thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } },
    },
    statistics: { viewCount: String(viewCount), likeCount: "42" },
  };
}

function okFetch(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  resetYoutubeHeatCache();
});

describe("env home (YOUTUBE_API_KEY, server-side only)", () => {
  it("no key configured → dormant; blank and whitespace keys count as absent", () => {
    expect(getYoutubeApiKey({} as NodeJS.ProcessEnv)).toBeNull();
    expect(getYoutubeApiKey({ YOUTUBE_API_KEY: "" } as NodeJS.ProcessEnv)).toBeNull();
    expect(getYoutubeApiKey({ YOUTUBE_API_KEY: "   " } as NodeJS.ProcessEnv)).toBeNull();
    expect(isYoutubeHeatConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(getYoutubeApiKey(ENV)).toBe(KEY);
    expect(isYoutubeHeatConfigured(ENV)).toBe(true);
  });

  it("region defaults to US; a valid alpha-2 override wins; junk falls back", () => {
    expect(youtubeHeatRegion({} as NodeJS.ProcessEnv)).toBe("US");
    expect(youtubeHeatRegion({ YOUTUBE_HEAT_REGION: "gb" } as NodeJS.ProcessEnv)).toBe("GB");
    expect(youtubeHeatRegion({ YOUTUBE_HEAT_REGION: "USA" } as NodeJS.ProcessEnv)).toBe("US");
    expect(youtubeHeatRegion({ YOUTUBE_HEAT_REGION: "1!" } as NodeJS.ProcessEnv)).toBe("US");
  });

  it("dormancy never touches the network: no key → null with zero fetch calls", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(getOutsideHeat({ env: {} as NodeJS.ProcessEnv, fetchImpl })).resolves.toBeNull();
    await expect(
      getOutsideHeat({ env: { YOUTUBE_API_KEY: "  " } as NodeJS.ProcessEnv, fetchImpl }),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("chart fetch + shaping", () => {
  it("requests the mostPopular MUSIC chart for the region, once", async () => {
    const fetchImpl = okFetch(chartBody([videoItem("abc")]));
    const heat = await getOutsideHeat({ env: ENV, fetchImpl });
    expect(heat).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain("https://www.googleapis.com/youtube/v3/videos?");
    expect(url).toContain("chart=mostPopular");
    expect(url).toContain("videoCategoryId=10");
    expect(url).toContain("regionCode=US");
    expect(url).toContain("part=snippet%2Cstatistics");
  });

  it("shapes rows honestly: YouTube's name on the family AND every row, watch-URL click-through, numeric views", async () => {
    const fetchImpl = okFetch(chartBody([videoItem("abc", "9001"), videoItem("def", 55)]));
    const heat = await getOutsideHeat({ env: ENV, fetchImpl });
    expect(heat?.source).toBe(YOUTUBE_HEAT_SOURCE);
    expect(heat?.source).toContain("YouTube");
    expect(heat?.region).toBe("US");
    expect(heat?.videos).toHaveLength(2);
    const v = heat!.videos[0]!;
    expect(v.videoId).toBe("abc");
    expect(v.viewCount).toBe(9001);
    expect(v.likeCount).toBe(42);
    expect(v.url).toBe("https://www.youtube.com/watch?v=abc");
    expect(v.source).toContain("YouTube");
    /* A snapshot, not velocity math: no growth/score fields exist. */
    expect(v).not.toHaveProperty("growth");
    expect(v).not.toHaveProperty("score");
    expect(v).not.toHaveProperty("trend");
  });

  it("drops rows without a real view count or title — never estimates", async () => {
    const fetchImpl = okFetch(
      chartBody([
        videoItem("good"),
        { id: "nocount", snippet: { title: "No stats" }, statistics: {} },
        { id: "notitle", snippet: { title: "  " }, statistics: { viewCount: "10" } },
        { snippet: { title: "No id" }, statistics: { viewCount: "10" } },
      ]),
    );
    const heat = await getOutsideHeat({ env: ENV, fetchImpl });
    expect(heat?.videos.map((v) => v.videoId)).toEqual(["good"]);
  });

  it("the API key never appears in the returned payload", async () => {
    const fetchImpl = okFetch(chartBody([videoItem("abc")]));
    const heat = await getOutsideHeat({ env: ENV, fetchImpl });
    expect(JSON.stringify(heat)).not.toContain(KEY);
  });
});

describe("cache + single-flight (quota safety)", () => {
  it("serves the success cache inside the TTL — one fetch for many reads", async () => {
    let now = 1_000_000;
    const fetchImpl = okFetch(chartBody([videoItem("abc")]));
    const deps = { env: ENV, fetchImpl, now: () => now };
    const a = await getOutsideHeat(deps);
    now += YOUTUBE_HEAT_CACHE_TTL_MS - 1;
    const b = await getOutsideHeat(deps);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });

  it("refetches after the success TTL expires", async () => {
    let now = 1_000_000;
    const fetchImpl = okFetch(chartBody([videoItem("abc")]));
    const deps = { env: ENV, fetchImpl, now: () => now };
    await getOutsideHeat(deps);
    now += YOUTUBE_HEAT_CACHE_TTL_MS + 1;
    await getOutsideHeat(deps);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("concurrent reads share ONE in-flight fetch", async () => {
    let release!: (v: unknown) => void;
    const gate = new Promise((r) => (release = r));
    const fetchImpl = vi.fn(async () => {
      await gate;
      return { ok: true, status: 200, json: async () => chartBody([videoItem("abc")]) };
    }) as unknown as typeof fetch;
    const deps = { env: ENV, fetchImpl };
    const pending = Array.from({ length: 5 }, () => getOutsideHeat(deps));
    release(null);
    const results = await Promise.all(pending);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toBe(results[0]);
    expect(results[0]?.videos).toHaveLength(1);
  });

  it("a failure is negative-cached for the failure window — no retry storm — then retried", async () => {
    let now = 5_000_000;
    const failing = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const deps = { env: ENV, fetchImpl: failing, now: () => now };
    await expect(getOutsideHeat(deps)).resolves.toBeNull();
    await expect(getOutsideHeat(deps)).resolves.toBeNull();
    expect(failing).toHaveBeenCalledTimes(1);
    now += YOUTUBE_HEAT_FAILURE_TTL_MS + 1;
    await expect(getOutsideHeat(deps)).resolves.toBeNull();
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe("fail-closed dormancy (every error class → null, rail unaffected)", () => {
  it("quota 403 → null", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { errors: [{ reason: "quotaExceeded" }] } }),
    })) as unknown as typeof fetch;
    await expect(getOutsideHeat({ env: ENV, fetchImpl })).resolves.toBeNull();
  });

  it("transport throw → null", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("socket hangup");
    }) as unknown as typeof fetch;
    await expect(getOutsideHeat({ env: ENV, fetchImpl })).resolves.toBeNull();
  });

  it("non-JSON body → null; shapeless body → null; empty chart → null", async () => {
    const badJson = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof fetch;
    await expect(getOutsideHeat({ env: ENV, fetchImpl: badJson })).resolves.toBeNull();
    resetYoutubeHeatCache();
    await expect(
      getOutsideHeat({ env: ENV, fetchImpl: okFetch({ nope: true }) }),
    ).resolves.toBeNull();
    resetYoutubeHeatCache();
    await expect(
      getOutsideHeat({ env: ENV, fetchImpl: okFetch(chartBody([])) }),
    ).resolves.toBeNull();
  });
});
