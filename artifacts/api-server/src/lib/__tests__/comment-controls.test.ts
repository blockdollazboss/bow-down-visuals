/**
 * Pure-logic tests for creator comment controls (Stack-100 #3, #27):
 * hold decisions (keyword / all / first-time), visibility, pin-first
 * ordering, and the action state machine. No DB — the route tests cover
 * ownership + persistence against a fake db.
 */
import { describe, it, expect } from "vitest";
import {
  decideInitialStatus,
  findBlockedWord,
  isVisibleTo,
  sortForDisplay,
  transitionFor,
  normalizeSettings,
  DEFAULT_COMMENT_SETTINGS,
} from "../comment-controls";

const OWNER = "owner-1";
const FAN = "fan-1";
const OTHER = "fan-2";

describe("decideInitialStatus", () => {
  it("defaults OFF: a normal comment is public", () => {
    const d = decideInitialStatus({ body: "love this", settings: DEFAULT_COMMENT_SETTINGS, authorUserId: FAN, ownerUserId: OWNER, isFirstTimeCommenter: true });
    expect(d).toEqual({ status: "public", reason: null, matchedWord: null });
  });

  it("keyword blocklist auto-holds (not deletes), case-insensitive substring, automod parity", () => {
    const settings = { holdMode: "off" as const, blockedWords: ["spamword", "free money"] };
    const d = decideInitialStatus({ body: "get FREE MONEY here", settings, authorUserId: FAN, ownerUserId: OWNER, isFirstTimeCommenter: false });
    expect(d.status).toBe("held");
    expect(d.reason).toBe("blocked_word");
    expect(d.matchedWord).toBe("free money");
  });

  it("hold-all holds every audience comment", () => {
    const d = decideInitialStatus({ body: "hi", settings: { holdMode: "all", blockedWords: [] }, authorUserId: FAN, ownerUserId: OWNER, isFirstTimeCommenter: false });
    expect(d).toMatchObject({ status: "held", reason: "hold_all" });
  });

  it("first-time mode holds only first-time commenters", () => {
    const s = { holdMode: "first_time" as const, blockedWords: [] };
    expect(decideInitialStatus({ body: "hi", settings: s, authorUserId: FAN, ownerUserId: OWNER, isFirstTimeCommenter: true })).toMatchObject({ status: "held", reason: "first_time_commenter" });
    expect(decideInitialStatus({ body: "hi again", settings: s, authorUserId: FAN, ownerUserId: OWNER, isFirstTimeCommenter: false })).toMatchObject({ status: "public" });
  });

  it("the creator's own comment on their own content is never held", () => {
    const s = { holdMode: "all" as const, blockedWords: ["spamword"] };
    const d = decideInitialStatus({ body: "spamword from me", settings: s, authorUserId: OWNER, ownerUserId: OWNER, isFirstTimeCommenter: true });
    expect(d.status).toBe("public");
  });

  it("keyword match wins over hold mode ordering (reason is the specific one)", () => {
    const d = decideInitialStatus({ body: "spamword", settings: { holdMode: "all", blockedWords: ["spamword"] }, authorUserId: FAN, ownerUserId: OWNER, isFirstTimeCommenter: false });
    expect(d.reason).toBe("blocked_word");
  });
});

describe("findBlockedWord", () => {
  it("ignores blank entries and trims", () => {
    expect(findBlockedWord("hello world", ["", "  ", "World"])).toBe("world");
    expect(findBlockedWord("hello", ["nope"])).toBeNull();
  });
});

describe("isVisibleTo", () => {
  const held = { status: "held", authorUserId: FAN };
  const hidden = { status: "hidden", authorUserId: FAN };
  const pub = { status: "public", authorUserId: FAN };
  it("public is visible to everyone including anonymous", () => {
    expect(isVisibleTo(pub, { userId: null, isContentOwner: false })).toBe(true);
  });
  it("held/hidden are invisible to the public and to other fans", () => {
    for (const c of [held, hidden]) {
      expect(isVisibleTo(c, { userId: null, isContentOwner: false })).toBe(false);
      expect(isVisibleTo(c, { userId: OTHER, isContentOwner: false })).toBe(false);
    }
  });
  it("held/hidden stay visible to the creator and to their author", () => {
    for (const c of [held, hidden]) {
      expect(isVisibleTo(c, { userId: OWNER, isContentOwner: true })).toBe(true);
      expect(isVisibleTo(c, { userId: FAN, isContentOwner: false })).toBe(true);
    }
  });
  it("a legacy row with no status reads as public", () => {
    expect(isVisibleTo({ authorUserId: FAN }, { userId: null, isContentOwner: false })).toBe(true);
  });
});

describe("sortForDisplay", () => {
  it("pinned first, then newest first; does not mutate input", () => {
    const rows = [
      { id: "a", pinned: false, createdAt: new Date("2026-10-03T00:00:00Z") },
      { id: "b", pinned: true, pinnedAt: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-10-01T00:00:00Z") },
      { id: "c", pinned: false, createdAt: new Date("2026-10-04T00:00:00Z") },
    ];
    const sorted = sortForDisplay(rows);
    expect(sorted.map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("transitionFor", () => {
  it("pin only applies to public comments; unpin clears", () => {
    expect(transitionFor("pin", { status: "public", pinned: false })).toEqual({ status: "public", pinned: true });
    expect(transitionFor("pin", { status: "held", pinned: false })).toBeNull();
    expect(transitionFor("pin", { status: "hidden", pinned: false })).toBeNull();
    expect(transitionFor("unpin", { status: "public", pinned: true })).toEqual({ status: "public", pinned: false });
    expect(transitionFor("unpin", { status: "public", pinned: false })).toBeNull();
  });
  it("hide/unhide flip public<->hidden and drop the pin on hide", () => {
    expect(transitionFor("hide", { status: "public", pinned: true })).toEqual({ status: "hidden", pinned: false });
    expect(transitionFor("hide", { status: "held", pinned: false })).toBeNull();
    expect(transitionFor("unhide", { status: "hidden", pinned: false })).toEqual({ status: "public", pinned: false });
  });
  it("approve: held -> public; reject: held -> hidden (never a delete)", () => {
    expect(transitionFor("approve", { status: "held", pinned: false })).toEqual({ status: "public", pinned: false });
    expect(transitionFor("reject", { status: "held", pinned: false })).toEqual({ status: "hidden", pinned: false });
    expect(transitionFor("approve", { status: "public", pinned: false })).toBeNull();
    expect(transitionFor("reject", { status: "hidden", pinned: false })).toBeNull();
  });
});

describe("normalizeSettings", () => {
  it("bad shapes degrade to OFF defaults", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_COMMENT_SETTINGS);
    expect(normalizeSettings({ holdMode: "bogus", blockedWords: "nope" })).toEqual(DEFAULT_COMMENT_SETTINGS);
    expect(normalizeSettings({ holdMode: "all", blockedWords: [" Spam ", "spam", 42, ""] })).toEqual({ holdMode: "all", blockedWords: ["spam"] });
  });
});
