import { describe, it, expect } from "vitest";
import {
  CO_RELEASE_CONSENT_COPY,
  coReleaseActionPath,
  coReleaseAttributionPath,
  coReleaseByProfilePath,
  coReleaseStateLabel,
  coReleaseViewerActions,
  displaySharePct,
  splitValidationError,
  standingSides,
  type CoReleaseItem,
  type CoReleaseSideSummary,
} from "./co-releases";

/* Co-releases (Wave 3): client mirror of the split-consent rules.
   Copy is pinned verbatim — the UI must SAY the fee and lock rules,
   not just implement them. */

const side = (over: Partial<CoReleaseSideSummary>): CoReleaseSideSummary => ({
  profile_id: "p-a",
  user_id: "u-a",
  role: "author",
  status: "accepted",
  share_pct: 60,
  agreed_share_pct: null,
  accepted_at: "2026-10-24T00:00:00Z",
  display_name: "Shark Beats",
  slug: "shark-beats",
  avatar_url: null,
  is_verified: false,
  ...over,
});

const item = (over: Partial<CoReleaseItem>): CoReleaseItem => ({
  id: "11111111-1111-1111-1111-111111111111",
  item_kind: "release",
  item_id: "22222222-2222-2222-2222-222222222222",
  item_title: "Midnight Tide",
  is_co_release: true,
  co_release_state: "pending",
  published_at: null,
  agreed_shares: null,
  sides: [side({}), side({ profile_id: "p-b", user_id: "u-b", role: "co_author", status: "pending", share_pct: 40, accepted_at: null })],
  viewer_side: { role: "co_author", status: "pending", profile_id: "p-b" },
  created_at: "2026-10-24T00:00:00Z",
  ...over,
});

describe("CO_RELEASE_CONSENT_COPY", () => {
  it("states both-approve for the split AND the release", () => {
    expect(CO_RELEASE_CONSENT_COPY.bothApproveSplit).toContain("approve the royalty split and the release");
    expect(CO_RELEASE_CONSENT_COPY.bothApproveSplit).toContain("before a co-release goes live on either profile");
  });
  it("states the platform fee is outside the split, at the existing flat 5%", () => {
    expect(CO_RELEASE_CONSENT_COPY.feeOutsideSplit).toContain("flat 5% fee");
    expect(CO_RELEASE_CONSENT_COPY.feeOutsideSplit).toContain("never part of the split");
  });
  it("states the split locks at publish and withdraw keeps agreed splits", () => {
    expect(CO_RELEASE_CONSENT_COPY.lockedAtPublish).toContain("locked in when the co-release goes live");
    expect(CO_RELEASE_CONSENT_COPY.withdraw).toContain("splits already agreed for earnings stay as agreed");
  });
});

describe("splitValidationError — mirrors the server rule", () => {
  it("accepts exact 100 and tolerance-edge splits", () => {
    expect(splitValidationError(60, 40)).toBeNull();
    expect(splitValidationError(60, 39.99)).toBeNull();
  });
  it("flags sums that are not 100 with the real total", () => {
    expect(splitValidationError(60, 30)).toContain("total 90.00%");
  });
  it("flags 100/0, negatives and >2dp shares", () => {
    expect(splitValidationError(100, 0)).toContain("more than 0%");
    expect(splitValidationError(-5, 105)).toBeTruthy();
    expect(splitValidationError(33.333, 66.667)).toContain("two decimal places");
  });
});

describe("displaySharePct — displays equal rails", () => {
  it("shows the proposal before publish and the frozen agreed share after", () => {
    const pendingSide = side({});
    expect(displaySharePct(item({}), pendingSide)).toBe(60);
    const liveItem = item({
      co_release_state: "live",
      agreed_shares: [
        { profileId: "p-a", sharePct: 55 },
        { profileId: "p-b", sharePct: 45 },
      ],
    });
    /* even if a stale proposal value rides along, the agreed share wins */
    expect(displaySharePct(liveItem, side({ share_pct: 60 }))).toBe(55);
  });
});

describe("coReleaseViewerActions", () => {
  it("pending co-author can accept or decline; author can amend or withdraw pre-live", () => {
    expect(coReleaseViewerActions(item({}))).toEqual(["accept", "decline"]);
    expect(
      coReleaseViewerActions(item({ viewer_side: { role: "author", status: "accepted", profile_id: "p-a" } })),
    ).toEqual(["withdraw", "amend-split"]);
  });
  it("after publish nobody can amend; accepted sides can only withdraw", () => {
    const liveItem = item({
      co_release_state: "live",
      viewer_side: { role: "author", status: "accepted", profile_id: "p-a" },
    });
    expect(coReleaseViewerActions(liveItem)).toEqual(["withdraw"]);
  });
  it("non-sides and settled sides get no actions", () => {
    expect(coReleaseViewerActions(item({ viewer_side: null }))).toEqual([]);
    expect(
      coReleaseViewerActions(item({ viewer_side: { role: "co_author", status: "withdrawn", profile_id: "p-b" }, co_release_state: "live_one_side" })),
    ).toEqual([]);
  });
});

describe("paths, labels, standing sides", () => {
  it("builds encoded paths", () => {
    expect(coReleaseByProfilePath("p a")).toBe("/api/co-releases/by-profile/p%20a");
    expect(coReleaseActionPath("id/1", "amend-split")).toBe("/api/co-releases/id%2F1/amend-split");
    expect(coReleaseAttributionPath("abc")).toBe("/api/co-releases/abc/attribution");
  });
  it("labels carry the state honestly", () => {
    expect(coReleaseStateLabel("live")).toContain("split locked");
    expect(coReleaseStateLabel("pending")).toContain("approval");
  });
  it("standingSides drops withdrawn/pending sides from the byline", () => {
    expect(standingSides([side({}), side({ status: "withdrawn" }), side({ status: "pending" })])).toHaveLength(1);
  });
});
