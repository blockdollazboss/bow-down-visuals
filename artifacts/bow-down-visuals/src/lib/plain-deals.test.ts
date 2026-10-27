import { describe, it, expect } from "vitest";
import {
  dealSplitError,
  plainDealActionPath,
  plainDealStateLabel,
  plainDealViewerActions,
  type PlainDealItem,
  type PlainDealSideSummary,
} from "./plain-deals";

function side(over: Partial<PlainDealSideSummary>): PlainDealSideSummary {
  return {
    id: "side-1",
    plain_deal_id: "deal-1",
    profile_id: "profile-1",
    user_id: "user-1",
    role: "partner",
    status: "pending",
    does_text: "produces the beat",
    gets_text: "producer credit",
    share_pct: 40,
    signed_name: null,
    signed_at: null,
    is_viewer: true,
    name: "Partner Two",
    slug: "partner-two",
    avatar_url: null,
    ...over,
  };
}

function item(over: Partial<PlainDealItem>): PlainDealItem {
  const viewer = side({});
  return {
    id: "deal-1",
    title: "Our song",
    item_kind: "general",
    item_id: null,
    item_title: null,
    agreed_shares: null,
    signed_text: null,
    signed_at: null,
    split_attach: null,
    created_at: "2026-10-27T00:00:00.000Z",
    updated_at: "2026-10-27T00:00:00.000Z",
    deal_state: "awaiting_signature",
    plain_text: "…",
    sides: [viewer],
    viewer_side: viewer,
    ...over,
  };
}

describe("plain-deals FE mirror", () => {
  it("builds action paths under the deals rail", () => {
    expect(plainDealActionPath("abc", "sign")).toBe("/api/plain-deals/abc/sign");
    expect(plainDealActionPath("abc", "amend")).toBe("/api/plain-deals/abc/amend");
  });

  it("labels every deal state in plain words", () => {
    expect(plainDealStateLabel("signed")).toBe("Signed by both");
    expect(plainDealStateLabel("awaiting_signature")).toBe("Waiting for a signature");
    expect(plainDealStateLabel("declined")).toBe("Declined");
    expect(plainDealStateLabel("withdrawn")).toBe("Withdrawn");
  });

  it("the invited side can sign, decline, or withdraw a live draft", () => {
    expect(plainDealViewerActions(item({}))).toEqual(["sign", "decline", "withdraw"]);
  });

  it("the author of a live draft can amend and withdraw, but not sign their own invite twice", () => {
    const author = side({ role: "author", status: "signed", profile_id: "profile-0" });
    const it2 = item({ viewer_side: author, sides: [author] });
    expect(plainDealViewerActions(it2)).toEqual(["withdraw", "amend"]);
  });

  it("a closed deal offers no actions", () => {
    expect(plainDealViewerActions(item({ deal_state: "signed" }))).toEqual([]);
    expect(plainDealViewerActions(item({ deal_state: "declined" }))).toEqual([]);
    expect(plainDealViewerActions(item({ viewer_side: null }))).toEqual([]);
  });

  it("the split rule matches the server: two positive shares totaling 100", () => {
    expect(dealSplitError(60, 40)).toBeNull();
    expect(dealSplitError(50, 50)).toBeNull();
    expect(dealSplitError(60, 30)).toContain("add up to 100%");
    expect(dealSplitError(0, 100)).toContain("more than 0%");
    expect(dealSplitError(Number.NaN, 50)).toBe("Enter both shares.");
  });
});
