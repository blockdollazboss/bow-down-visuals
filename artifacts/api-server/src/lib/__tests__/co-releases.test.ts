/**
 * Co-releases (Stack-100 #3 Wave 3, co-posts phase 2) — the split
 * consent machine. Pins the brief's four test requirements:
 *  - no publish without BOTH approvals (of the split AND the release);
 *  - split sum validation (creator-entered %, server-side, sum = 100);
 *  - withdraw semantics (my profile copy only; agreement not rewritten);
 *  - split immutability after publish (amend refused; agreed snapshot
 *    frozen at the publish moment; attribution uses ONLY the agreed
 *    split, with the platform fee outside it by construction).
 */
import { describe, expect, it } from "vitest";
import {
  amendProposedSplit,
  applyCoReleaseAction,
  attributeEarnings,
  coReleaseWasPublished,
  deriveCoReleaseState,
  initialCoRelease,
  isCoReleaseVisibleOnProfile,
  isMissingCoReleaseTable,
  splitCreatorAmount,
  validateSplit,
  CoReleaseError,
  type CoRelease,
} from "../co-releases";

const AUTHOR = { profileId: "prof-a", userId: "user-a" };
const CO = { profileId: "prof-b", userId: "user-b" };
const T0 = new Date("2026-10-24T00:00:00Z");
const T1 = new Date("2026-10-24T01:00:00Z");
const T2 = new Date("2026-10-24T02:00:00Z");

function draft(authorPct = 60, coPct = 40): CoRelease {
  return initialCoRelease(
    "corel-1",
    { kind: "release", id: "rel-1" },
    { ...AUTHOR, sharePct: authorPct },
    { ...CO, sharePct: coPct },
    T0,
  );
}
function live(): CoRelease {
  return applyCoReleaseAction(draft(), CO.profileId, "accept", T1);
}

describe("validateSplit — creator-entered percentages, sum must be 100", () => {
  it("accepts an exact 100 and the 0.01-tolerance 33.33-style split", () => {
    expect(() => validateSplit([{ sharePct: 60 }, { sharePct: 40 }])).not.toThrow();
    expect(() => validateSplit([{ sharePct: 60 }, { sharePct: 39.99 }])).not.toThrow(); // 99.99 — within the rail's 0.01 tolerance
  });
  it("refuses sums that are not 100", () => {
    expect(() => validateSplit([{ sharePct: 60 }, { sharePct: 30 }])).toThrowError(/total 100%/);
    expect(() => validateSplit([{ sharePct: 60 }, { sharePct: 50 }])).toThrowError(CoReleaseError);
    expect(() => initialCoRelease("x", { kind: "product", id: "p" }, { ...AUTHOR, sharePct: 70 }, { ...CO, sharePct: 20 })).toThrowError(/split_sum|total 100%/);
  });
  it("refuses a 100/0 or negative or >2dp share — both creators must share", () => {
    expect(() => validateSplit([{ sharePct: 100 }, { sharePct: 0 }])).toThrowError(/more than 0%/);
    expect(() => validateSplit([{ sharePct: -10 }, { sharePct: 110 }])).toThrowError(CoReleaseError);
    expect(() => validateSplit([{ sharePct: 33.333 }, { sharePct: 66.667 }])).toThrowError(/two decimal places/);
  });
  it("refuses same-creator co-releases", () => {
    expect(() =>
      initialCoRelease("x", { kind: "release", id: "r" }, { ...AUTHOR, sharePct: 50 }, { ...AUTHOR, sharePct: 50 }),
    ).toThrowError(/two different creators/);
  });
});

describe("no publish without both approvals", () => {
  it("a draft is visible on NEITHER profile and has no agreed split", () => {
    const co = draft();
    expect(deriveCoReleaseState(co)).toBe("pending");
    expect(coReleaseWasPublished(co)).toBe(false);
    expect(co.agreedShares).toBeNull();
    expect(co.publishedAt).toBeNull();
    expect(isCoReleaseVisibleOnProfile(co, AUTHOR.profileId)).toBe(false);
    expect(isCoReleaseVisibleOnProfile(co, CO.profileId)).toBe(false);
  });
  it("the initiator alone cannot publish: their own re-accept is refused", () => {
    expect(() => applyCoReleaseAction(draft(), AUTHOR.profileId, "accept")).toThrowError(CoReleaseError);
    expect(coReleaseWasPublished(draft())).toBe(false);
  });
  it("a stranger cannot accept", () => {
    expect(() => applyCoReleaseAction(draft(), "prof-stranger", "accept")).toThrowError(/Only the two creators/);
  });
  it("the co-author's accept publishes on BOTH profiles and freezes the split", () => {
    const co = live();
    expect(deriveCoReleaseState(co)).toBe("live");
    expect(co.publishedAt).toEqual(T1);
    expect(co.agreedShares).toEqual([
      { profileId: AUTHOR.profileId, sharePct: 60 },
      { profileId: CO.profileId, sharePct: 40 },
    ]);
    expect(isCoReleaseVisibleOnProfile(co, AUTHOR.profileId)).toBe(true);
    expect(isCoReleaseVisibleOnProfile(co, CO.profileId)).toBe(true);
  });
  it("decline ends it pre-live: nothing ever publishes, no agreed split", () => {
    const co = applyCoReleaseAction(draft(), CO.profileId, "decline", T1);
    expect(deriveCoReleaseState(co)).toBe("declined");
    expect(co.agreedShares).toBeNull();
    expect(isCoReleaseVisibleOnProfile(co, AUTHOR.profileId)).toBe(false);
    /* and a late accept cannot resurrect it */
    expect(() => applyCoReleaseAction(co, CO.profileId, "accept", T2)).toThrowError(CoReleaseError);
  });
  it("pre-live withdrawal by the author cancels; the pending side cannot then accept", () => {
    const co = applyCoReleaseAction(draft(), AUTHOR.profileId, "withdraw", T1);
    expect(deriveCoReleaseState(co)).toBe("cancelled");
    expect(() => applyCoReleaseAction(co, CO.profileId, "accept", T2)).toThrowError(/ended before it went live/);
  });
});

describe("split immutability after publish", () => {
  it("amend-split is refused once live — split_locked, always", () => {
    expect(() =>
      amendProposedSplit(live(), AUTHOR.profileId, [
        { profileId: AUTHOR.profileId, sharePct: 90 },
        { profileId: CO.profileId, sharePct: 10 },
      ]),
    ).toThrowError(/locked once the co-release is live/);
  });
  it("amend works pre-publish for the initiator only, re-validates the sum, co-author stays pending", () => {
    const amended = amendProposedSplit(draft(), AUTHOR.profileId, [
      { profileId: AUTHOR.profileId, sharePct: 55 },
      { profileId: CO.profileId, sharePct: 45 },
    ]);
    expect(amended.sides.map((s) => s.sharePct)).toEqual([55, 45]);
    expect(amended.sides[1].status).toBe("pending");
    expect(amended.agreedShares).toBeNull();
    expect(() =>
      amendProposedSplit(draft(), CO.profileId, [
        { profileId: AUTHOR.profileId, sharePct: 55 },
        { profileId: CO.profileId, sharePct: 45 },
      ]),
    ).toThrowError(/Only the creator who drafted/);
    expect(() =>
      amendProposedSplit(draft(), AUTHOR.profileId, [
        { profileId: AUTHOR.profileId, sharePct: 55 },
        { profileId: CO.profileId, sharePct: 40 },
      ]),
    ).toThrowError(/total 100%/);
  });
  it("the frozen snapshot is the split AS PROPOSED at accept time — later proposal edits can't leak in", () => {
    const amended = amendProposedSplit(draft(), AUTHOR.profileId, [
      { profileId: AUTHOR.profileId, sharePct: 55 },
      { profileId: CO.profileId, sharePct: 45 },
    ]);
    const published = applyCoReleaseAction(amended, CO.profileId, "accept", T1);
    expect(published.agreedShares).toEqual([
      { profileId: AUTHOR.profileId, sharePct: 55 },
      { profileId: CO.profileId, sharePct: 45 },
    ]);
    /* mutating the returned proposal shares does not touch the snapshot */
    published.sides[0].sharePct = 99;
    expect(published.agreedShares![0].sharePct).toBe(55);
  });
});

describe("withdraw semantics — my profile copy only, agreement survives", () => {
  it("co-author withdraws after live: item leaves THEIR profile, stays on the author's", () => {
    const co = applyCoReleaseAction(live(), CO.profileId, "withdraw", T2);
    expect(deriveCoReleaseState(co)).toBe("live_one_side");
    expect(isCoReleaseVisibleOnProfile(co, CO.profileId)).toBe(false);
    expect(isCoReleaseVisibleOnProfile(co, AUTHOR.profileId)).toBe(true);
    /* the other side is object-for-object untouched */
    expect(co.sides[0]).toEqual(live().sides[0]);
  });
  it("withdrawal does NOT rewrite the agreed split", () => {
    const co = applyCoReleaseAction(live(), CO.profileId, "withdraw", T2);
    expect(co.agreedShares).toEqual(live().agreedShares);
    expect(co.publishedAt).toEqual(T1);
  });
  it("a pending side cannot withdraw (they decline); decline after live is refused", () => {
    expect(() => applyCoReleaseAction(draft(), CO.profileId, "withdraw")).toThrowError(/can withdraw/);
    expect(() => applyCoReleaseAction(live(), CO.profileId, "decline")).toThrowError(/already live — withdraw/);
  });
  it("both withdraw: nothing stands on either profile, split snapshot still intact for past earnings", () => {
    const one = applyCoReleaseAction(live(), CO.profileId, "withdraw", T2);
    const both = applyCoReleaseAction(one, AUTHOR.profileId, "withdraw", T2);
    expect(isCoReleaseVisibleOnProfile(both, AUTHOR.profileId)).toBe(false);
    expect(isCoReleaseVisibleOnProfile(both, CO.profileId)).toBe(false);
    expect(both.agreedShares).toEqual(live().agreedShares);
  });
});

describe("attribution — agreed split applied to recorded creator amounts", () => {
  it("splits exactly, remainder cents to the author, shares sum to the total", () => {
    /* 101 cents at 60/40: floor = 60 + 40 = 100, remainder 1 -> author */
    const shares = splitCreatorAmount(live(), 101);
    expect(shares).toEqual([
      expect.objectContaining({ profileId: AUTHOR.profileId, sharePct: 60, amountCents: 61 }),
      expect.objectContaining({ profileId: CO.profileId, sharePct: 40, amountCents: 40 }),
    ]);
    expect(shares.reduce((s, x) => s + x.amountCents, 0)).toBe(101);
  });
  it("refuses to attribute before publish — there is no agreed split yet", () => {
    expect(() => splitCreatorAmount(draft(), 1000)).toThrowError(/no agreed split/);
    expect(() => attributeEarnings(draft(), [{ id: "e1", amountCents: 500 }])).toThrowError(CoReleaseError);
  });
  it("attributeEarnings applies the frozen split per entry and in total; withdrawal doesn't change it", () => {
    const earnings = [
      { id: "e1", amountCents: 1000 },
      { id: "e2", amountCents: 250 },
    ];
    const before = attributeEarnings(live(), earnings);
    expect(before.totalCents).toBe(1250);
    expect(before.totals.find((t) => t.profileId === AUTHOR.profileId)?.amountCents).toBe(750);
    expect(before.totals.find((t) => t.profileId === CO.profileId)?.amountCents).toBe(500);
    const withdrawn = applyCoReleaseAction(live(), CO.profileId, "withdraw", T2);
    expect(attributeEarnings(withdrawn, earnings)).toEqual(before);
  });
  it("rejects negative or fractional cent amounts", () => {
    expect(() => splitCreatorAmount(live(), -5)).toThrowError(/whole number of cents/);
    expect(() => splitCreatorAmount(live(), 10.5)).toThrowError(/whole number of cents/);
  });
});

describe("missing-table honesty (pre-migration)", () => {
  it("detects 42P01 and co_release undefined-table errors, not other errors", () => {
    expect(isMissingCoReleaseTable({ code: "42P01" })).toBe(true);
    expect(isMissingCoReleaseTable(new Error('relation "co_release_sides" does not exist'))).toBe(true);
    expect(isMissingCoReleaseTable(new Error("connection refused"))).toBe(false);
    expect(isMissingCoReleaseTable(null)).toBe(false);
  });
});
