/**
 * Lane F1 (QC-200 G2) — growth proof for the distribution mock
 * adapter's jobs map.
 *
 * The map carries the FULL release payload of every submission and,
 * before this lane, was bounded only by the house 2h job-map TTL:
 * inside any 2h window the count was whatever the submission rate
 * made it. The contract proven here: a hard count cap backstops the
 * TTL, oldest submissions evict first, and jobs still inside the cap
 * keep reporting statuses (an in-flight delivery is never torn).
 */
import { describe, it, expect } from "vitest";
import {
  MockAggregatorAdapter,
  type AggregatorReleasePayload,
} from "../distribution-aggregator";

const MOCK_JOBS_MAX_ENTRIES = 1000;

function payload(clientReleaseId: string): AggregatorReleasePayload {
  return {
    clientReleaseId,
    title: `Release ${clientReleaseId}`,
    artistName: "Thy Cheat Code",
    releaseType: "single",
    releaseDate: "2026-10-30",
    explicit: false,
    tracks: [{ title: "Track", audioUrl: "https://example.com/a.mp3", explicit: false }],
    artworkUrl: "https://example.com/art.png",
    platforms: ["spotify"],
  };
}

describe("MockAggregatorAdapter jobs map (G2)", () => {
  it("a submission flood cannot grow the map past the cap; the oldest job evicts first", async () => {
    const adapter = new MockAggregatorAdapter();
    const total = MOCK_JOBS_MAX_ENTRIES + 25;
    let firstId = "";
    let lastId = "";
    for (let i = 0; i < total; i++) {
      const sub = await adapter.submitRelease(payload(`rel-${i}`));
      if (i === 0) firstId = sub.aggregatorReleaseId;
      lastId = sub.aggregatorReleaseId;
    }
    // Evicted: the adapter no longer knows the oldest submission.
    expect(await adapter.fetchPlatformStatuses(firstId)).toEqual([]);
    // Retained: the newest submission still reports its platforms.
    const newest = await adapter.fetchPlatformStatuses(lastId);
    expect(newest).toHaveLength(1);
    expect(newest[0]?.platform).toBe("spotify");
  });

  it("a job inside the cap keeps reporting while newer jobs arrive (in-flight survives)", async () => {
    const adapter = new MockAggregatorAdapter();
    const mine = await adapter.submitRelease(payload("rel-mine"));
    // Fill almost to the cap with other submissions.
    for (let i = 0; i < MOCK_JOBS_MAX_ENTRIES - 2; i++) {
      await adapter.submitRelease(payload(`rel-other-${i}`));
    }
    const statuses = await adapter.fetchPlatformStatuses(mine.aggregatorReleaseId);
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.status).toBe("queued");
  });
});
