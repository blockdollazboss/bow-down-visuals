import { describe, expect, it } from "vitest";
import {
  AUDIENCE_ROOM_PATH,
  COLLAB_MATCH_PATH,
  FAN_LINKS_FOR_ME_PATH,
  FAN_LINKS_MINE_PATH,
  FAN_LINKS_MINT_PATH,
  collabMatchMarkPath,
  fanLinkContentLabel,
  fanLinkShareUrl,
  fanLinkStatsLine,
  hourAxisLabel,
  hourBarPct,
  playSourceLabel,
  suggestionAction,
  suggestionScoreLabel,
} from "../upg-fans";

describe("upg-fans paths", () => {
  it("points at the mounted API routes", () => {
    expect(COLLAB_MATCH_PATH).toBe("/api/collab-match");
    expect(FAN_LINKS_MINE_PATH).toBe("/api/fan-links/mine");
    expect(FAN_LINKS_FOR_ME_PATH).toBe("/api/fan-links/for-me");
    expect(FAN_LINKS_MINT_PATH).toBe("/api/fan-links");
    expect(AUDIENCE_ROOM_PATH).toBe("/api/audience-room");
    expect(collabMatchMarkPath("abc 123")).toBe("/api/collab-match/abc%20123/mark");
  });
});

describe("suggestionAction — contact only through the broker", () => {
  it("an unanswered open suggestion can be answered", () => {
    expect(suggestionAction({ status: "open", myStatus: "pending" })).toBe("answer");
  });
  it("after I answer, the pair waits on the other side", () => {
    expect(suggestionAction({ status: "open", myStatus: "interested" })).toBe("waiting");
    expect(suggestionAction({ status: "open", myStatus: "passed" })).toBe("waiting");
  });
  it("a connected pair is done — the intro lives in the inbox", () => {
    expect(suggestionAction({ status: "connected", myStatus: "interested" })).toBe("connected");
  });
  it("a closed pair offers nothing", () => {
    expect(suggestionAction({ status: "closed", myStatus: "passed" })).toBe("none");
  });
});

describe("suggestionScoreLabel", () => {
  it("bands the score", () => {
    expect(suggestionScoreLabel(95)).toBe("Strong match");
    expect(suggestionScoreLabel(60)).toBe("Good match");
    expect(suggestionScoreLabel(40)).toBe("Possible match");
    expect(suggestionScoreLabel(10)).toBe("Long-shot match");
  });
});

describe("fan link view helpers", () => {
  it("builds the shareable URL on the public redirect path", () => {
    expect(fanLinkShareUrl("https://bowdownvisuals.com/", "/api/f/abc23456")).toBe(
      "https://bowdownvisuals.com/api/f/abc23456",
    );
    expect(fanLinkShareUrl("https://bowdownvisuals.com", "api/f/abc23456")).toBe(
      "https://bowdownvisuals.com/api/f/abc23456",
    );
  });
  it("states proven counts, with the rate only when one exists", () => {
    expect(
      fanLinkStatsLine({ linkId: "l1", clicks: 3, arrivals: 2, signups: 1, arrivalRate: 2 / 3 }),
    ).toBe("3 clicks · 2 arrivals · 1 signup · 67% arrived");
    expect(
      fanLinkStatsLine({ linkId: "l1", clicks: 0, arrivals: 0, signups: 0, arrivalRate: null }),
    ).toBe("0 clicks · 0 arrivals · 0 signups");
    expect(
      fanLinkStatsLine({ linkId: "l1", clicks: 1, arrivals: 1, signups: 0, arrivalRate: 1 }),
    ).toBe("1 click · 1 arrival · 0 signups · 100% arrived");
  });
  it("labels content plainly", () => {
    expect(fanLinkContentLabel("review_link", null)).toBe("review link");
    expect(fanLinkContentLabel("song", "track-9")).toBe("song · track-9");
  });
});

describe("audience room view helpers", () => {
  it("scales bars against the busiest hour, flat when silent", () => {
    expect(hourBarPct(10, [0, 10, 5])).toBe(100);
    expect(hourBarPct(5, [0, 10, 5])).toBe(50);
    expect(hourBarPct(0, [0, 0, 0])).toBe(0);
    expect(hourBarPct(3, [])).toBe(0);
  });
  it("labels the UTC hour axis", () => {
    expect(hourAxisLabel(0)).toBe("00:00");
    expect(hourAxisLabel(9)).toBe("09:00");
    expect(hourAxisLabel(23)).toBe("23:00");
  });
  it("names declared sources, collapsing unknown ones honestly", () => {
    expect(playSourceLabel("fan_link")).toBe("Fan links");
    expect(playSourceLabel("world")).toBe("The World");
    expect(playSourceLabel("something-new")).toBe("Other declared sources");
  });
});
