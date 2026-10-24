import { describe, it, expect } from "vitest";
import {
  CO_POST_CONSENT_COPY,
  coBylineNames,
  coPostActionPath,
  coPostByProfilePath,
  coPostStateLabel,
  coPostViewerActions,
  standingAuthors,
  type CoAuthorSummary,
} from "./co-posts";

/* Co-posts (Stack-100 #3, #24): the client mirror of the consent rules.
   The sentences below are pinned verbatim because the UI must SAY the
   withdraw rule, not just implement it. */

const side = (over: Partial<CoAuthorSummary>): CoAuthorSummary => ({
  profile_id: "p1",
  user_id: "u1",
  role: "author",
  status: "accepted",
  accepted_at: "2026-10-23T00:00:00Z",
  display_name: "Shark Beats",
  slug: "shark-beats",
  avatar_url: null,
  is_verified: false,
  ...over,
});

describe("CO_POST_CONSENT_COPY", () => {
  it("states the both-approve rule", () => {
    expect(CO_POST_CONSENT_COPY.bothApprove).toBe("Both creators must approve before a co-post goes live.");
  });
  it("states the shared, never-doubled counts rule", () => {
    expect(CO_POST_CONSENT_COPY.sharedCounts).toContain("one shared set of likes and comments");
    expect(CO_POST_CONSENT_COPY.sharedCounts).toContain("never counted twice");
  });
  it("states the withdraw rule exactly: my profile loses it, theirs keeps it", () => {
    expect(CO_POST_CONSENT_COPY.withdraw).toBe(
      "Either creator can withdraw their own side at any time: the post leaves their profile, and the other creator keeps theirs.",
    );
  });
});

describe("paths", () => {
  it("builds action and by-profile paths with encoding", () => {
    expect(coPostActionPath("a b", "withdraw")).toBe("/api/co-posts/a%20b/withdraw");
    expect(coPostActionPath("p1", "accept")).toBe("/api/co-posts/p1/accept");
    expect(coPostByProfilePath("p/1")).toBe("/api/co-posts/by-profile/p%2F1");
  });
});

describe("standingAuthors / coBylineNames", () => {
  it("bylines both creators while both stand", () => {
    const authors = [
      side({}),
      side({ profile_id: "p2", user_id: "u2", role: "co_author", display_name: "Vox Queen" }),
    ];
    expect(coBylineNames(authors)).toEqual(["Shark Beats", "Vox Queen"]);
  });

  it("drops a withdrawn creator from the byline — their side is gone", () => {
    const authors = [
      side({}),
      side({ profile_id: "p2", user_id: "u2", role: "co_author", status: "withdrawn", display_name: "Vox Queen" }),
    ];
    expect(standingAuthors(authors)).toHaveLength(1);
    expect(coBylineNames(authors)).toEqual(["Shark Beats"]);
  });

  it("never bylines a pending co-author (not live yet)", () => {
    const authors = [
      side({}),
      side({ profile_id: "p2", user_id: "u2", role: "co_author", status: "pending", accepted_at: null, display_name: "Vox Queen" }),
    ];
    expect(coBylineNames(authors)).toEqual(["Shark Beats"]);
  });
});

describe("coPostViewerActions", () => {
  it("a pending invitee can accept or decline", () => {
    expect(
      coPostViewerActions({ viewer_side: { role: "co_author", status: "pending", profile_id: "p2" }, co_post_state: "pending" }),
    ).toEqual(["accept", "decline"]);
  });
  it("an accepted side can withdraw — and only withdraw", () => {
    expect(
      coPostViewerActions({ viewer_side: { role: "author", status: "accepted", profile_id: "p1" }, co_post_state: "live" }),
    ).toEqual(["withdraw"]);
    expect(
      coPostViewerActions({ viewer_side: { role: "co_author", status: "accepted", profile_id: "p2" }, co_post_state: "live_one_side" }),
    ).toEqual(["withdraw"]);
  });
  it("strangers and settled sides get no actions", () => {
    expect(coPostViewerActions({ viewer_side: null, co_post_state: "live" })).toEqual([]);
    expect(
      coPostViewerActions({ viewer_side: { role: "co_author", status: "withdrawn", profile_id: "p2" }, co_post_state: "live_one_side" }),
    ).toEqual([]);
    expect(
      coPostViewerActions({ viewer_side: { role: "co_author", status: "declined", profile_id: "p2" }, co_post_state: "declined" }),
    ).toEqual([]);
  });
});

describe("coPostStateLabel", () => {
  it("labels every state in plain words", () => {
    expect(coPostStateLabel("live")).toContain("both profiles");
    expect(coPostStateLabel("live_one_side")).toContain("one side withdrawn");
    expect(coPostStateLabel("pending")).toContain("approval");
    expect(coPostStateLabel("declined")).toContain("never went live");
  });
});
