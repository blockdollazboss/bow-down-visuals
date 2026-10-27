/**
 * Fan Links pins (lib/fan-links.ts, N17).
 *
 * Every number a creator sees must be a counted row. These pins hold:
 * codes are unambiguous and well-formed; an arrival is recorded ONLY
 * for a proven play of the linked content by someone who isn't the
 * fan; a signup can never be self-attributed; rollups count rows and
 * rank fans by proven signups, then arrivals, then clicks.
 */
import { describe, it, expect } from "vitest";
import {
  mintFanLinkCode,
  isFanLinkCode,
  fanLinkLandingPath,
  playKindForContentType,
  shouldRecordArrival,
  shouldRecordSignup,
  statsForLink,
  rollupForCreator,
  FAN_LINK_CODE_ALPHABET,
  type FanLinkRow,
  type FanLinkEventRow,
} from "../fan-links";

describe("codes", () => {
  it("mints 8-char codes from the unambiguous alphabet only", () => {
    let seed = 0;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 200; i++) {
      const code = mintFanLinkCode(rand);
      expect(code).toHaveLength(8);
      expect(isFanLinkCode(code)).toBe(true);
      expect([...code].every((c) => FAN_LINK_CODE_ALPHABET.includes(c))).toBe(true);
      expect(code).not.toMatch(/[0oO1lI]/);
    }
  });

  it("rejects malformed codes", () => {
    expect(isFanLinkCode("abc")).toBe(false);
    expect(isFanLinkCode("abcd0fgh")).toBe(false); // contains 0
    expect(isFanLinkCode(42)).toBe(false);
  });
});

describe("landing path", () => {
  it("carries the code and the content anchor to the creator page", () => {
    expect(
      fanLinkLandingPath({ creatorSlug: "nova", contentType: "song", contentId: "m1", code: "abcd2345" }),
    ).toBe("/artist/nova?fan=abcd2345#song-m1");
    expect(
      fanLinkLandingPath({ creatorSlug: "nova", contentType: "song", contentId: null, code: "abcd2345" }),
    ).toBe("/artist/nova?fan=abcd2345");
  });
});

describe("arrival decisions", () => {
  const link = { fanUserId: "fan1", contentType: "song", contentId: "m1" };

  it("song links arrive as track plays of the same media", () => {
    expect(playKindForContentType("song")).toBe("track");
    expect(playKindForContentType("video")).toBe("video");
    expect(playKindForContentType("image")).toBeNull();
    expect(shouldRecordArrival({ link, play: { kind: "track", mediaId: "m1", userId: "someone" } })).toBe(true);
    expect(shouldRecordArrival({ link, play: { kind: "video", mediaId: "m1", userId: "someone" } })).toBe(false);
    expect(shouldRecordArrival({ link, play: { kind: "track", mediaId: "OTHER", userId: "someone" } })).toBe(false);
  });

  it("the fan's own plays never count; signed-out plays do", () => {
    expect(shouldRecordArrival({ link, play: { kind: "track", mediaId: "m1", userId: "fan1" } })).toBe(false);
    expect(shouldRecordArrival({ link, play: { kind: "track", mediaId: "m1", userId: null } })).toBe(true);
  });

  it("a creator-level link (no content id) accepts any matching-kind play", () => {
    const open = { fanUserId: "fan1", contentType: "song", contentId: null };
    expect(shouldRecordArrival({ link: open, play: { kind: "track", mediaId: "any", userId: "x" } })).toBe(true);
  });

  it("non-playable content can never arrive", () => {
    const img = { fanUserId: "fan1", contentType: "image", contentId: "m1" };
    expect(shouldRecordArrival({ link: img, play: { kind: "track", mediaId: "m1", userId: "x" } })).toBe(false);
  });
});

describe("signup decisions", () => {
  it("never self-attributed", () => {
    expect(shouldRecordSignup({ fanUserId: "f", newUserId: "f" })).toBe(false);
    expect(shouldRecordSignup({ fanUserId: "f", newUserId: "n" })).toBe(true);
  });
});

const LINKS: FanLinkRow[] = [
  { id: "l1", code: "aaaa2222", fanUserId: "fan1", creatorUserId: "c1", contentType: "song", contentId: "m1", createdAt: new Date() },
  { id: "l2", code: "bbbb3333", fanUserId: "fan2", creatorUserId: "c1", contentType: "video", contentId: "v1", createdAt: new Date() },
  { id: "l3", code: "cccc4444", fanUserId: "fan1", creatorUserId: "c2", contentType: "song", contentId: "m9", createdAt: new Date() },
];
const EV = (fanLinkId: string, kind: string): FanLinkEventRow => ({
  fanLinkId, kind, visitorUserId: null, createdAt: new Date(),
});
const EVENTS: FanLinkEventRow[] = [
  EV("l1", "click"), EV("l1", "click"), EV("l1", "arrival"), EV("l1", "signup"),
  EV("l2", "click"), EV("l2", "arrival"), EV("l2", "arrival"),
  EV("l3", "click"), EV("l3", "signup"), EV("l3", "signup"),
];

describe("aggregation", () => {
  it("statsForLink counts rows per kind and rates arrivals over clicks", () => {
    const s = statsForLink("l1", EVENTS);
    expect(s).toEqual({ linkId: "l1", clicks: 2, arrivals: 1, signups: 1, arrivalRate: 0.5 });
    expect(statsForLink("nope", EVENTS).arrivalRate).toBeNull();
  });

  it("rollupForCreator scopes to the creator and ranks fans by proof", () => {
    const r = rollupForCreator(LINKS, EVENTS, "c1");
    expect(r.totalLinks).toBe(2);
    expect(r.totalClicks).toBe(3);
    expect(r.totalArrivals).toBe(3);
    expect(r.totalSignups).toBe(1);
    // fan1 has the only signup → first, despite fan2's extra arrival
    expect(r.topFans.map((f) => f.fanUserId)).toEqual(["fan1", "fan2"]);
    const other = rollupForCreator(LINKS, EVENTS, "c2");
    expect(other.totalSignups).toBe(2);
  });
});
