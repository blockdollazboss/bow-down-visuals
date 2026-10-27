/**
 * Duo/Group Profiles (N20) — pure-machine tests.
 *
 * The promises under test:
 *  - a group handle normalizes to the slug shape the DB enforces, and
 *    anything else is refused outright;
 *  - written split terms run the SAME sum-to-100 machine as product
 *    splits (owner holds a share, no duplicates, ≤ 2 decimals) PLUS
 *    the group rule: every share goes to an ACTIVE team member;
 *  - "no written terms" is honest: empty input and a lone owner at
 *    100% both read as null, never as a fake split;
 *  - members are credited from their real creator profiles, owners
 *    first, with the share the written terms give them — a member
 *    without a profile is credited by role, never given an invented
 *    name.
 */
import { describe, it, expect } from "vitest";
import {
  buildMemberCredits,
  normalizeGroupSlug,
  validateGroupSplitTerms,
  GroupProfileError,
} from "../group-profiles";
import { SaleSplitError } from "../sale-splits";

const OWNER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const OUTSIDER = "33333333-3333-4333-8333-333333333333";
const MEMBERS = new Set([OWNER, MEMBER]);

describe("normalizeGroupSlug", () => {
  it("accepts and normalizes plain handles", () => {
    expect(normalizeGroupSlug("  Crown-Duo  ")).toBe("crown-duo");
    expect(normalizeGroupSlug("duo2")).toBe("duo2");
  });

  it("refuses shapes the DB check would refuse", () => {
    expect(normalizeGroupSlug("ab")).toBeNull();
    expect(normalizeGroupSlug("-duo")).toBeNull();
    expect(normalizeGroupSlug("duo-")).toBeNull();
    expect(normalizeGroupSlug("the duo")).toBeNull();
    expect(normalizeGroupSlug("duo_kings")).toBeNull();
    expect(normalizeGroupSlug("")).toBeNull();
    expect(normalizeGroupSlug(42)).toBeNull();
    expect(normalizeGroupSlug(null)).toBeNull();
  });
});

describe("validateGroupSplitTerms", () => {
  it("accepts member-only terms summing to 100", () => {
    const terms = validateGroupSplitTerms(OWNER, MEMBERS, [
      { userId: OWNER, sharePct: 60 },
      { userId: MEMBER, sharePct: 40 },
    ]);
    expect(terms).toEqual([
      { userId: OWNER, sharePct: 60 },
      { userId: MEMBER, sharePct: 40 },
    ]);
  });

  it("refuses a share for a non-member", () => {
    expect(() =>
      validateGroupSplitTerms(OWNER, MEMBERS, [
        { userId: OWNER, sharePct: 50 },
        { userId: OUTSIDER, sharePct: 50 },
      ]),
    ).toThrow(GroupProfileError);
  });

  it("inherits the sum-to-100 machine: bad sums and missing owner fail", () => {
    expect(() =>
      validateGroupSplitTerms(OWNER, MEMBERS, [
        { userId: OWNER, sharePct: 60 },
        { userId: MEMBER, sharePct: 30 },
      ]),
    ).toThrow(SaleSplitError);
    expect(() =>
      validateGroupSplitTerms(OWNER, MEMBERS, [{ userId: MEMBER, sharePct: 100 }]),
    ).toThrow(SaleSplitError);
  });

  it("reads empty terms and a lone owner at 100% as no written terms", () => {
    expect(validateGroupSplitTerms(OWNER, MEMBERS, null)).toBeNull();
    expect(validateGroupSplitTerms(OWNER, MEMBERS, [])).toBeNull();
    expect(validateGroupSplitTerms(OWNER, MEMBERS, [{ userId: OWNER, sharePct: 100 }])).toBeNull();
  });
});

describe("buildMemberCredits", () => {
  const profiles = new Map([
    [OWNER, { displayName: "King Duo Lead", slug: "lead", avatarUrl: "https://x/a.png" }],
    [MEMBER, { displayName: "Second Voice", slug: "second", avatarUrl: null }],
  ]);

  it("credits active members from their profiles, owner first, with shares", () => {
    const credits = buildMemberCredits(
      [
        { userId: MEMBER, role: "member", status: "active" },
        { userId: OWNER, role: "owner", status: "active" },
        { userId: OUTSIDER, role: "member", status: "invited" },
        { userId: null, role: "member", status: "invited" },
      ],
      profiles,
      [
        { userId: OWNER, sharePct: 60 },
        { userId: MEMBER, sharePct: 40 },
      ],
    );
    expect(credits.map((c) => c.userId)).toEqual([OWNER, MEMBER]);
    expect(credits[0]).toMatchObject({ displayName: "King Duo Lead", slug: "lead", sharePct: 60 });
    expect(credits[1]).toMatchObject({ displayName: "Second Voice", sharePct: 40 });
  });

  it("never invents a name for a member without a creator profile", () => {
    const credits = buildMemberCredits(
      [{ userId: OUTSIDER, role: "member", status: "active" }],
      profiles,
      null,
    );
    expect(credits).toEqual([
      { userId: OUTSIDER, role: "member", displayName: "Team member", slug: null, avatarUrl: null, sharePct: null },
    ]);
  });
});
