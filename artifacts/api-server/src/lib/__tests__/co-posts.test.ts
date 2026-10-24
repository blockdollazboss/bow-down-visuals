/**
 * Co-posts (Stack-100 #3, #24) — the consent state machine.
 *
 * Pins the hard rules:
 *  - both sides approve before anything goes live;
 *  - either side can withdraw THEIR side only — the other side keeps
 *    the post, untouched;
 *  - a decline is pre-live only and never turns into a solo post;
 *  - engagement is one shared record (the post row's counts), and
 *    merged profile lists dedupe by post id (never counted twice).
 */
import { describe, expect, it } from "vitest";
import {
  applyCoPostAction,
  coPostWasPublished,
  dedupePostsById,
  deriveCoPostState,
  initialCoPost,
  isCoPostVisibleInFeed,
  isCoPostVisibleOnProfile,
  isMissingCoPostTable,
  sharedEngagement,
  CoPostError,
  type CoPost,
} from "../co-posts";

const AUTHOR = { profileId: "prof-a", userId: "user-a" };
const CO = { profileId: "prof-b", userId: "user-b" };
const T0 = new Date("2026-10-23T00:00:00Z");
const T1 = new Date("2026-10-23T01:00:00Z");
const T2 = new Date("2026-10-23T02:00:00Z");

function fresh(): CoPost {
  return initialCoPost("post-1", AUTHOR, CO, T0);
}
function live(): CoPost {
  return applyCoPostAction(fresh(), CO.profileId, "accept", T1);
}

describe("initialCoPost", () => {
  it("starts with the author accepted and the co-author pending", () => {
    const co = fresh();
    expect(co.sides).toHaveLength(2);
    expect(co.sides[0]).toMatchObject({ role: "author", status: "accepted" });
    expect(co.sides[0].acceptedAt).toEqual(T0);
    expect(co.sides[1]).toMatchObject({ role: "co_author", status: "pending", acceptedAt: null });
  });

  it("is not live anywhere while the co-author is pending", () => {
    const co = fresh();
    expect(deriveCoPostState(co)).toBe("pending");
    expect(coPostWasPublished(co)).toBe(false);
    expect(isCoPostVisibleInFeed(co)).toBe(false);
    expect(isCoPostVisibleOnProfile(co, AUTHOR.profileId)).toBe(false);
    expect(isCoPostVisibleOnProfile(co, CO.profileId)).toBe(false);
  });

  it("refuses a creator co-posting with themselves", () => {
    expect(() => initialCoPost("p", AUTHOR, AUTHOR)).toThrowError(CoPostError);
    expect(() => initialCoPost("p", AUTHOR, { profileId: "prof-x", userId: "user-a" })).toThrowError(/two different creators/);
  });
});

describe("accept — both sides approve before it goes live", () => {
  it("the co-author's accept publishes it on BOTH profiles", () => {
    const co = live();
    expect(deriveCoPostState(co)).toBe("live");
    expect(coPostWasPublished(co)).toBe(true);
    expect(isCoPostVisibleInFeed(co)).toBe(true);
    expect(isCoPostVisibleOnProfile(co, AUTHOR.profileId)).toBe(true);
    expect(isCoPostVisibleOnProfile(co, CO.profileId)).toBe(true);
  });

  it("accept only changes the accepting side", () => {
    const before = fresh();
    const after = applyCoPostAction(before, CO.profileId, "accept", T1);
    expect(after.sides[0]).toEqual(before.sides[0]);
    expect(after.sides[1].status).toBe("accepted");
    expect(after.sides[1].acceptedAt).toEqual(T1);
    /* pure: the input is not mutated */
    expect(before.sides[1].status).toBe("pending");
  });

  it("a third party cannot accept, and a settled side cannot re-accept", () => {
    expect(() => applyCoPostAction(fresh(), "prof-stranger", "accept")).toThrowError(/not_a_co_author|Only the two creators/);
    expect(() => applyCoPostAction(live(), CO.profileId, "accept")).toThrowError(CoPostError);
    expect(() => applyCoPostAction(fresh(), AUTHOR.profileId, "accept")).toThrowError(CoPostError);
  });
});

describe("decline — pre-live only, ends the co-post", () => {
  it("a pending co-author can decline; nothing ever goes live", () => {
    const co = applyCoPostAction(fresh(), CO.profileId, "decline", T1);
    expect(deriveCoPostState(co)).toBe("declined");
    expect(isCoPostVisibleInFeed(co)).toBe(false);
    expect(isCoPostVisibleOnProfile(co, AUTHOR.profileId)).toBe(false);
    /* the author's side is untouched — and NOT silently turned solo:
       state stays declined, visibility stays off for BOTH profiles */
    expect(co.sides[0].status).toBe("accepted");
  });

  it("decline after going live is refused — withdraw is the live action", () => {
    expect(() => applyCoPostAction(live(), CO.profileId, "decline")).toThrowError(/already_live/);
  });

  it("the author cannot decline their own accepted side (they withdraw)", () => {
    expect(() => applyCoPostAction(fresh(), AUTHOR.profileId, "decline")).toThrowError(CoPostError);
  });
});

describe("withdraw — MY side only, the other creator keeps theirs", () => {
  it("co-author withdraws after live: post leaves THEIR profile, stays on the author's", () => {
    const co = applyCoPostAction(live(), CO.profileId, "withdraw", T2);
    expect(deriveCoPostState(co)).toBe("live_one_side");
    expect(isCoPostVisibleOnProfile(co, CO.profileId)).toBe(false);
    expect(isCoPostVisibleOnProfile(co, AUTHOR.profileId)).toBe(true);
    /* still in the Feed — one creator still stands behind it */
    expect(isCoPostVisibleInFeed(co)).toBe(true);
    /* the other side is object-for-object untouched */
    expect(co.sides[0]).toEqual(live().sides[0]);
    /* the withdrawing side keeps its historical accept stamp */
    expect(co.sides[1].acceptedAt).toEqual(T1);
  });

  it("author withdraws after live: post leaves THEIR profile, stays on the co-author's", () => {
    const co = applyCoPostAction(live(), AUTHOR.profileId, "withdraw", T2);
    expect(deriveCoPostState(co)).toBe("live_one_side");
    expect(isCoPostVisibleOnProfile(co, AUTHOR.profileId)).toBe(false);
    expect(isCoPostVisibleOnProfile(co, CO.profileId)).toBe(true);
    expect(co.sides[1]).toEqual(live().sides[1]);
  });

  it("when both sides withdraw, nobody keeps it — it leaves the Feed too", () => {
    const one = applyCoPostAction(live(), CO.profileId, "withdraw", T2);
    const none = applyCoPostAction(one, AUTHOR.profileId, "withdraw", T2);
    expect(isCoPostVisibleInFeed(none)).toBe(false);
    expect(isCoPostVisibleOnProfile(none, AUTHOR.profileId)).toBe(false);
    expect(isCoPostVisibleOnProfile(none, CO.profileId)).toBe(false);
  });

  it("the author withdrawing BEFORE the co-author answers cancels the co-post", () => {
    const co = applyCoPostAction(fresh(), AUTHOR.profileId, "withdraw", T1);
    expect(deriveCoPostState(co)).toBe("cancelled");
    expect(isCoPostVisibleInFeed(co)).toBe(false);
    /* and the pending side can NO LONGER accept a cancelled co-post
       into existence: consent was withdrawn before publish, so a late
       accept is refused outright (co_post_ended) — a fresh co-post is
       the only way back. */
    expect(() => applyCoPostAction(co, CO.profileId, "accept", T2)).toThrowError(/co_post_ended|ended before it went live/);
    expect(coPostWasPublished(co)).toBe(false);
  });

  it("a pending side cannot withdraw (they decline instead), and strangers cannot withdraw", () => {
    expect(() => applyCoPostAction(fresh(), CO.profileId, "withdraw")).toThrowError(/not_accepted/);
    expect(() => applyCoPostAction(live(), "prof-stranger", "withdraw")).toThrowError(CoPostError);
  });
});

describe("shared engagement — never double-counted", () => {
  it("sharedEngagement returns the post's ONE count set, unchanged", () => {
    const post = { likeCount: 42, replyCount: 7, repostCount: 3 };
    expect(sharedEngagement(post)).toEqual({ like_count: 42, reply_count: 7, repost_count: 3 });
    /* the same object is what BOTH profiles render — there is no
       per-author tally to sum anywhere in this module */
  });

  it("dedupePostsById merges two profiles' lists without duplicates", () => {
    const a = [{ id: "p1" }, { id: "shared" }, { id: "p2" }];
    const b = [{ id: "shared" }, { id: "p3" }];
    const merged = dedupePostsById([a, b]);
    expect(merged.map((x) => x.id)).toEqual(["p1", "shared", "p2", "p3"]);
    expect(merged.filter((x) => x.id === "shared")).toHaveLength(1);
  });
});

describe("isMissingCoPostTable — the pre-migration guard", () => {
  it("recognises Postgres 42P01 and drizzle-wrapped variants", () => {
    expect(isMissingCoPostTable(Object.assign(new Error("relation \"post_co_authors\" does not exist"), { code: "42P01" }))).toBe(true);
    expect(isMissingCoPostTable(new Error("Failed query: select ... from \"post_co_authors\" ... relation \"post_co_authors\" does not exist"))).toBe(true);
  });
  it("does not swallow unrelated errors", () => {
    expect(isMissingCoPostTable(new Error("connection reset"))).toBe(false);
    expect(isMissingCoPostTable(Object.assign(new Error("unique violation"), { code: "23505" }))).toBe(false);
    expect(isMissingCoPostTable(null)).toBe(false);
    expect(isMissingCoPostTable(undefined)).toBe(false);
  });
});
