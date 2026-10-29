/**
 * cover-fridays-data.test.ts — the Cover Fridays card's data contract.
 *
 * WHY THIS EXISTS (production crash, Oct 29 2026): the site's boundary
 * telemetry caught two trips on route "/", three seconds apart, both
 *   TypeError: Cannot read properties of undefined (reading 'toLocaleString')
 * The card cast the GET /api/challenges/cover-fridays JSON straight to a
 * camelCase interface it had invented — but the route serves snake_case
 * (`entry_count`, `week_key`, `past_crowns`) and nests the crowned cover
 * under `creator`/`video`. So `data.challenge.entryCount` was undefined
 * in every real payload with a live challenge row, and the render's
 * `entryCount.toLocaleString("en-US")` threw the exact telemetry error.
 *
 * The contract now lives in ONE place — normalizeCoverFridaysPayload,
 * the only door between the wire and the card — which translates the
 * served shape into the card's view model and coerces every count the
 * same way the server lib does (Number(x ?? 0)), so a count the render
 * formats is a real number by construction.
 *
 * The wire fixtures below are transcribed from the route itself
 * (api-server/src/routes/cover-fridays.ts res.json({...}) + the
 * crownedCovers() row mapping in api-server/src/lib/cover-fridays.ts).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatCount,
  normalizeCoverFridaysPayload,
} from "./cover-fridays-data";

/** The payload exactly as the route serializes it (snake_case scalars,
 *  crowned cover nested under creator/video). */
function wirePayload(overrides: Record<string, unknown> = {}) {
  return {
    week_key: "2026-W44",
    theme: {
      title: "Pop Royalty",
      hashtag: "coverfridaypop",
      description: "Cover a chart-topper and out-sing the original.",
    },
    friday_at: "2026-10-30T00:00:00.000Z",
    crown_by_at: "2026-11-02T00:00:00.000Z",
    challenge: {
      slug: "cover-fridays-2026-w44",
      status: "live",
      entry_count: 1234,
      starts_at: "2026-10-26T00:00:00.000Z",
      ends_at: "2026-11-01T23:59:59.000Z",
    },
    featured: {
      weekKey: "2026-W43",
      themeTitle: "Love Ballads",
      hashtag: "coverfridayballads",
      crownedAt: "2026-10-26T12:00:00.000Z",
      creator: { slug: "thy-cheat-code", displayName: "Thy Cheat Code", avatarUrl: null },
      video: { id: "vid-1", title: "My Ballad Cover", thumbnailUrl: null },
      viewCount: 4321,
    },
    past_crowns: [],
    ...overrides,
  };
}

describe("normalizeCoverFridaysPayload — the wire contract", () => {
  it("translates the served challenge shape: entry_count arrives as a real number", () => {
    const data = normalizeCoverFridaysPayload(wirePayload());
    expect(data).not.toBeNull();
    expect(data!.weekKey).toBe("2026-W44");
    expect(data!.challenge).toEqual({
      slug: "cover-fridays-2026-w44",
      status: "live",
      entryCount: 1234,
    });
    // The exact render expression that crashed in production:
    expect(formatCount(data!.challenge!.entryCount)).toBe("1,234");
  });

  it("REGRESSION (the Oct 29 crash): a live challenge whose count the payload omits formats as 0 instead of throwing", () => {
    const wire = wirePayload();
    delete (wire.challenge as Record<string, unknown>).entry_count;
    const data = normalizeCoverFridaysPayload(wire);
    expect(data!.challenge!.entryCount).toBe(0);
    expect(() => formatCount(data!.challenge!.entryCount)).not.toThrow();
    expect(formatCount(data!.challenge!.entryCount)).toBe("0");
  });

  it("flattens the crowned cover's creator/video nesting the render reads", () => {
    const data = normalizeCoverFridaysPayload(wirePayload());
    expect(data!.featured).toEqual({
      weekKey: "2026-W43",
      themeTitle: "Love Ballads",
      crownedAt: "2026-10-26T12:00:00.000Z",
      videoId: "vid-1",
      videoTitle: "My Ballad Cover",
      thumbnailUrl: null,
      displayName: "Thy Cheat Code",
      slug: "thy-cheat-code",
      viewCount: 4321,
    });
    expect(formatCount(data!.featured!.viewCount)).toBe("4,321");
  });

  it("maps past_crowns and keeps a null challenge null (pre-tick weeks stay crash-free)", () => {
    const wire = wirePayload({ challenge: null });
    wire.past_crowns = [wire.featured];
    const data = normalizeCoverFridaysPayload(wire);
    expect(data!.challenge).toBeNull();
    expect(data!.pastCrowns).toHaveLength(1);
    expect(data!.pastCrowns[0]!.videoTitle).toBe("My Ballad Cover");
  });

  it("a payload with no theme is not data — the card stays hidden, as before", () => {
    expect(normalizeCoverFridaysPayload({ week_key: "2026-W44" })).toBeNull();
    expect(normalizeCoverFridaysPayload(null)).toBeNull();
    expect(normalizeCoverFridaysPayload("nope")).toBeNull();
  });
});

describe("CoverFridaysCard wiring (source pin)", () => {
  const src = readFileSync(new URL("./CoverFridaysCard.tsx", import.meta.url), "utf8");

  it("routes the fetch through the normalizer — no blind cast of the raw JSON", () => {
    expect(src).toContain("normalizeCoverFridaysPayload(json)");
    expect(src).not.toMatch(/json:\s*CoverFridaysData/);
  });

  it("renders counts through the shared formatter", () => {
    expect(src).toContain("formatCount(data.challenge.entryCount)");
    expect(src).toContain("formatCount(featured.viewCount)");
  });
});
