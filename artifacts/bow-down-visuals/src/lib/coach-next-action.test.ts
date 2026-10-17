import { describe, it, expect } from "vitest";
import {
  primaryActionFor,
  creatorStateSummary,
  FALLBACK_PRIMARY_ACTION,
  type CoachCreatorState,
} from "./coach-next-action";

/* DE-19: the plan's primary button is the server-derived next
   action; the static fallback only fires for plans without one. */

const state = (over: Partial<CoachCreatorState> = {}): CoachCreatorState => ({
  songs: 0,
  latestSongTitle: null,
  releases: 0,
  submittedReleases: 0,
  storeProducts: 0,
  membershipTiers: 0,
  earningsCents: 0,
  tipsVb: 0,
  ...over,
});

describe("primaryActionFor", () => {
  it("returns the server's next action when the plan carries one", () => {
    expect(primaryActionFor({ nextAction: { label: "Distribute your songs", href: "/distribute" } })).toEqual({
      label: "Distribute your songs",
      href: "/distribute",
    });
  });

  it("falls back to the historic Distribute lead when the plan has none", () => {
    expect(primaryActionFor({})).toEqual(FALLBACK_PRIMARY_ACTION);
    expect(primaryActionFor(null)).toEqual(FALLBACK_PRIMARY_ACTION);
    expect(primaryActionFor(undefined)).toEqual(FALLBACK_PRIMARY_ACTION);
  });

  it("rejects a malformed action instead of rendering a dead button", () => {
    expect(primaryActionFor({ nextAction: { label: "", href: "/distribute" } })).toEqual(FALLBACK_PRIMARY_ACTION);
    expect(primaryActionFor({ nextAction: { label: "Go", href: "https://example.com" } })).toEqual(FALLBACK_PRIMARY_ACTION);
  });
});

describe("creatorStateSummary", () => {
  it("summarizes the catalog the coach read, with correct plurals and dollars", () => {
    expect(creatorStateSummary(state({ songs: 1, releases: 2, storeProducts: 0, membershipTiers: 1, earningsCents: 12345 }))).toBe(
      "1 song in your library · 2 releases · 0 store products · 1 membership tier · $123 earned here",
    );
  });

  it("is null without a state (older plans render no strip)", () => {
    expect(creatorStateSummary(null)).toBeNull();
    expect(creatorStateSummary(undefined)).toBeNull();
  });
});
