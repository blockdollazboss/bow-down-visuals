import { describe, expect, it } from "vitest";
import {
  MAX_CO_SELLERS,
  coSellerTotalHundredths,
  draftsFromPresented,
  ownerSharePct,
  shareToHundredths,
  splitsPayload,
  validateSplitsDraft,
  type SplitCoSellerDraft,
} from "./splits-editor";

/* ── Co-seller splits editor math (Wave 4 #36, FE half) ──────────────────
   Pins the editor's mirror of the server's sum-to-100 contract
   (API lib/sale-splits validateProductSplits): the owner share is
   derived, never typed; the payload is owner-first and collapses to
   null for a solo product; every server refusal has a UI twin. */

const OWNER = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";

const draft = (userId: string, sharePct: string): SplitCoSellerDraft => ({
  userId,
  name: null,
  slug: null,
  avatarUrl: null,
  sharePct,
});

describe("share parsing (hundredths, ≤2dp)", () => {
  it("parses clean shares to integer hundredths", () => {
    expect(shareToHundredths("40")).toBe(4000);
    expect(shareToHundredths("33.33")).toBe(3333);
    expect(shareToHundredths("0.5")).toBe(50);
    expect(shareToHundredths(" 25 ")).toBe(2500);
  });

  it("refuses blanks, non-numbers and 3dp precision", () => {
    expect(shareToHundredths("")).toBeNull();
    expect(shareToHundredths("abc")).toBeNull();
    expect(shareToHundredths("33.333")).toBeNull();
  });
});

describe("owner share auto-balances", () => {
  it("is 100 with no co-sellers (the no-split state)", () => {
    expect(ownerSharePct([])).toBe(100);
  });

  it("is 100 minus the co-sellers' total", () => {
    expect(ownerSharePct([draft(A, "40")])).toBe(60);
    expect(ownerSharePct([draft(A, "33.33"), draft(B, "33.33")])).toBe(33.34);
  });

  it("sums in integer hundredths — no float ghosts", () => {
    const drafts = [draft(A, "33.33"), draft(B, "33.33")];
    expect(coSellerTotalHundredths(drafts)).toBe(6666);
    expect(ownerSharePct(drafts) + 66.66).toBe(100);
  });
});

describe("validation mirrors the server contract", () => {
  it("accepts an empty draft (no split) and a clean split", () => {
    expect(validateSplitsDraft(OWNER, [])).toEqual({ ok: true });
    expect(validateSplitsDraft(OWNER, [draft(A, "40"), draft(B, "25.5")])).toEqual({ ok: true });
  });

  it("refuses a share of zero, over 100, or blank", () => {
    expect(validateSplitsDraft(OWNER, [draft(A, "0")])).toEqual({ ok: false, reason: "share-range" });
    expect(validateSplitsDraft(OWNER, [draft(A, "100.01")])).toEqual({ ok: false, reason: "share-range" });
    expect(validateSplitsDraft(OWNER, [draft(A, "")])).toEqual({ ok: false, reason: "share-not-a-number" });
    expect(validateSplitsDraft(OWNER, [draft(A, "ten")])).toEqual({ ok: false, reason: "share-not-a-number" });
  });

  it("refuses three-decimal precision", () => {
    expect(validateSplitsDraft(OWNER, [draft(A, "10.005")])).toEqual({ ok: false, reason: "share-precision" });
  });

  it("refuses duplicates and listing yourself", () => {
    expect(validateSplitsDraft(OWNER, [draft(A, "10"), draft(A, "10")])).toEqual({ ok: false, reason: "duplicate-seller" });
    expect(validateSplitsDraft(OWNER, [draft(OWNER, "10")])).toEqual({ ok: false, reason: "self-listed" });
  });

  it("refuses more co-sellers than the 20-seller cap allows", () => {
    const many = Array.from({ length: MAX_CO_SELLERS + 1 }, (_, i) =>
      draft(`44444444-4444-4444-8444-${String(i).padStart(12, "0")}`, "1"),
    );
    expect(validateSplitsDraft(OWNER, many)).toEqual({ ok: false, reason: "too-many-sellers" });
  });

  it("refuses co-sellers crowding the owner out (owner must hold a share)", () => {
    expect(validateSplitsDraft(OWNER, [draft(A, "60"), draft(B, "40")])).toEqual({ ok: false, reason: "owner-crowded-out" });
    expect(validateSplitsDraft(OWNER, [draft(A, "100")])).toEqual({ ok: false, reason: "owner-crowded-out" });
    /* 99.99 still leaves the owner a real share. */
    expect(validateSplitsDraft(OWNER, [draft(A, "99.99")])).toEqual({ ok: true });
  });
});

describe("payload shape", () => {
  it("collapses a solo product to null", () => {
    expect(splitsPayload(OWNER, [])).toBeNull();
  });

  it("is owner-first with the derived share, then the co-sellers", () => {
    expect(splitsPayload(OWNER, [draft(A, "40"), draft(B, "10.25")])).toEqual([
      { userId: OWNER, sharePct: 49.75 },
      { userId: A, sharePct: 40 },
      { userId: B, sharePct: 10.25 },
    ]);
  });

  it("never emits a payload for an invalid draft", () => {
    expect(splitsPayload(OWNER, [draft(A, "100")])).toBeNull();
    expect(splitsPayload(OWNER, [draft(A, "10.005")])).toBeNull();
  });
});

describe("drafts from a presented list", () => {
  it("drops the owner's own entry and keeps names where presented", () => {
    const drafts = draftsFromPresented(
      [
        { userId: OWNER, sharePct: 60, name: "Owner Name", slug: "owner" },
        { userId: A, sharePct: 40, name: "Vox Queen", slug: "vox-queen" },
      ],
      OWNER,
    );
    expect(drafts).toEqual([
      { userId: A, name: "Vox Queen", slug: "vox-queen", avatarUrl: null, sharePct: "40" },
    ]);
  });

  it("accepts the bare shop shape (no names) and null", () => {
    expect(draftsFromPresented([{ userId: A, sharePct: 12.5 }], OWNER)).toEqual([
      { userId: A, name: null, slug: null, avatarUrl: null, sharePct: "12.5" },
    ]);
    expect(draftsFromPresented(null, OWNER)).toEqual([]);
    expect(draftsFromPresented(undefined, OWNER)).toEqual([]);
  });

  it("round-trips: presented → drafts → the same payload", () => {
    const presented = [
      { userId: OWNER, sharePct: 49.75 },
      { userId: A, sharePct: 40 },
      { userId: B, sharePct: 10.25 },
    ];
    expect(splitsPayload(OWNER, draftsFromPresented(presented, OWNER))).toEqual(presented);
  });
});
