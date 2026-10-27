import { describe, expect, it } from "vitest";
import {
  buildSplitTerms,
  canManageGroupProfile,
  formatGroupPrice,
  groupKindLabel,
  normalizeGroupSlugInput,
  parsePriceToCents,
  splitTermRows,
  type GroupMemberCredit,
} from "./group-profile-view";

/* Duo/Group Profiles (N20) — the FE mirrors of the API's rules:
   the handle shape, the split-terms machine, and the honest display
   of published terms next to the members they name. */

const OWNER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const OUTSIDER = "33333333-3333-4333-8333-333333333333";

function credit(userId: string, sharePct: number | null, displayName = "Duo Partner"): GroupMemberCredit {
  return { userId, role: userId === OWNER ? "owner" : "member", displayName, slug: null, avatarUrl: null, sharePct };
}

describe("normalizeGroupSlugInput", () => {
  it("normalizes case and surrounding space", () => {
    expect(normalizeGroupSlugInput("  Crown-Duo ")).toBe("crown-duo");
  });

  it("refuses shapes the DB check would refuse", () => {
    expect(normalizeGroupSlugInput("ab")).toBeNull();
    expect(normalizeGroupSlugInput("-duo")).toBeNull();
    expect(normalizeGroupSlugInput("the duo")).toBeNull();
    expect(normalizeGroupSlugInput("duo_kings")).toBeNull();
    expect(normalizeGroupSlugInput("")).toBeNull();
  });
});

describe("formatGroupPrice / parsePriceToCents", () => {
  it("formats cents as honest dollars", () => {
    expect(formatGroupPrice(0)).toBe("$0.00");
    expect(formatGroupPrice(500)).toBe("$5.00");
    expect(formatGroupPrice(123456)).toBe("$1234.56");
    expect(formatGroupPrice(-5)).toBe("$0.00");
  });

  it("round-trips a typed price", () => {
    expect(parsePriceToCents("5")).toBe(500);
    expect(parsePriceToCents("5.25")).toBe(525);
    expect(parsePriceToCents("0")).toBe(0);
    expect(parsePriceToCents("-1")).toBeNull();
    expect(parsePriceToCents("abc")).toBeNull();
  });
});

describe("canManageGroupProfile", () => {
  it("is owner/admin only, matching the API", () => {
    expect(canManageGroupProfile("owner")).toBe(true);
    expect(canManageGroupProfile("admin")).toBe(true);
    expect(canManageGroupProfile("member")).toBe(false);
    expect(canManageGroupProfile(null)).toBe(false);
  });
});

describe("buildSplitTerms", () => {
  it("builds member terms that total exactly 100", () => {
    const built = buildSplitTerms(OWNER, [
      { userId: OWNER, pct: "60" },
      { userId: MEMBER, pct: "40" },
    ]);
    expect(built).toEqual({
      ok: true,
      terms: [
        { userId: OWNER, sharePct: 60 },
        { userId: MEMBER, sharePct: 40 },
      ],
    });
  });

  it("reads all-blank as no written terms", () => {
    expect(buildSplitTerms(OWNER, [{ userId: OWNER, pct: "" }, { userId: MEMBER, pct: " " }])).toEqual({
      ok: true,
      terms: null,
    });
  });

  it("collapses a lone owner at 100% to no written terms, like the API", () => {
    expect(buildSplitTerms(OWNER, [{ userId: OWNER, pct: "100" }])).toEqual({ ok: true, terms: null });
  });

  it("refuses a total that is not exactly 100", () => {
    const built = buildSplitTerms(OWNER, [
      { userId: OWNER, pct: "60" },
      { userId: MEMBER, pct: "30" },
    ]);
    expect(built.ok).toBe(false);
  });

  it("refuses terms where the owner holds no share", () => {
    const built = buildSplitTerms(OWNER, [{ userId: MEMBER, pct: "100" }]);
    expect(built.ok).toBe(false);
  });

  it("refuses more than two decimal places", () => {
    const built = buildSplitTerms(OWNER, [
      { userId: OWNER, pct: "33.333" },
      { userId: MEMBER, pct: "66.667" },
    ]);
    expect(built.ok).toBe(false);
  });
});

describe("splitTermRows", () => {
  it("shows the published terms next to the members they name", () => {
    const rows = splitTermRows(
      [
        { userId: OWNER, sharePct: 60 },
        { userId: MEMBER, sharePct: 40 },
      ],
      [credit(OWNER, 60, "The Lead"), credit(MEMBER, 40)],
    );
    expect(rows).toEqual([
      { userId: OWNER, displayName: "The Lead", role: "owner", sharePct: 60 },
      { userId: MEMBER, displayName: "Duo Partner", role: "member", sharePct: 40 },
    ]);
  });

  it("is empty when no terms were published", () => {
    expect(splitTermRows(null, [credit(OWNER, null)])).toEqual([]);
    expect(splitTermRows([], [credit(OWNER, null)])).toEqual([]);
  });

  it("never invents a name for an unresolved term", () => {
    const rows = splitTermRows([{ userId: OUTSIDER, sharePct: 10 }], [credit(OWNER, null)]);
    expect(rows).toEqual([{ userId: OUTSIDER, displayName: "Team member", role: "member", sharePct: 10 }]);
  });
});

describe("groupKindLabel", () => {
  it("labels the shared-store kinds, defaulting honestly", () => {
    expect(groupKindLabel("merch")).toBe("Merch");
    expect(groupKindLabel("gift_card")).toBe("Gift card");
    expect(groupKindLabel("mystery")).toBe("Product");
  });
});
