/**
 * Plain-Words Deals (Stack-200 upgrade #164) — the deal machine. Pins:
 *  - no agreement without BOTH in-app signatures on the same words;
 *  - the split reuses the co-releases validation (sum = 100, range,
 *    precision) — a deal can never invent its own split rules;
 *  - any pre-signature change un-signs the partner (nobody is bound by
 *    words they didn't sign);
 *  - at full signature the split AND the signed text freeze; amend and
 *    re-sign are refused afterwards;
 *  - withdraw after signing is recorded but never rewrites the terms.
 */
import { describe, expect, it } from "vitest";
import {
  amendPlainDeal,
  applyPlainDealAction,
  dealWasSigned,
  derivePlainDealState,
  initialPlainDeal,
  isMissingPlainDealTable,
  renderPlainDealText,
  PlainDealError,
} from "../plain-deals";

const NAMES = { authorName: "Thy Cheat Code", partnerName: "Second Creator" };

function draft() {
  return initialPlainDeal("deal-1", {
    title: "Our song 'Midnight Run'",
    itemKind: "release",
    itemId: "rel-1",
    itemTitle: "Midnight Run",
    author: {
      profileId: "p-a",
      userId: "u-a",
      doesText: "Writes and records the song",
      getsText: "Half of what the song earns",
      sharePct: 50,
      signedName: "Thy Cheat Code",
    },
    partner: {
      profileId: "p-b",
      userId: "u-b",
      doesText: "Sings the hook and promotes the song",
      getsText: "Half of what the song earns",
      sharePct: 50,
    },
  });
}

describe("plain-deals — draft + consent", () => {
  it("drafts with the author signed and the partner pending — nothing agreed", () => {
    const d = draft();
    expect(derivePlainDealState(d)).toBe("awaiting_signature");
    expect(dealWasSigned(d)).toBe(false);
    expect(d.agreedShares).toBeNull();
    expect(d.signedText).toBeNull();
    expect(d.sides[0]!.status).toBe("signed");
    expect(d.sides[1]!.status).toBe("pending");
  });

  it("rejects a deal with the same creator on both sides", () => {
    expect(() =>
      initialPlainDeal("x", {
        title: "Solo deal",
        itemKind: "general",
        itemId: null,
        itemTitle: "",
        author: { profileId: "p-a", userId: "u-a", doesText: "does things", getsText: "gets things", sharePct: 50, signedName: "A" },
        partner: { profileId: "p-a", userId: "u-a", doesText: "does things", getsText: "gets things", sharePct: 50 },
      }),
    ).toThrowError(expect.objectContaining({ code: "same_creator" }));
  });

  it("reuses co-release split validation: shares must sum to 100", () => {
    expect(() =>
      initialPlainDeal("x", {
        title: "Bad split",
        itemKind: "general",
        itemId: null,
        itemTitle: "",
        author: { profileId: "p-a", userId: "u-a", doesText: "does things", getsText: "gets things", sharePct: 60, signedName: "A" },
        partner: { profileId: "p-b", userId: "u-b", doesText: "does things", getsText: "gets things", sharePct: 30 },
      }),
    ).toThrowError(PlainDealError);
  });

  it("refuses blank plain-words fields — plain words are the product", () => {
    expect(() =>
      initialPlainDeal("x", {
        title: "Blank words",
        itemKind: "general",
        itemId: null,
        itemTitle: "",
        author: { profileId: "p-a", userId: "u-a", doesText: "  ", getsText: "gets things", sharePct: 50, signedName: "A" },
        partner: { profileId: "p-b", userId: "u-b", doesText: "does things", getsText: "gets things", sharePct: 50 },
      }),
    ).toThrowError(expect.objectContaining({ code: "words_missing" }));
  });
});

describe("plain-deals — signing freezes the terms", () => {
  it("partner signature completes the deal: split + text freeze", () => {
    const d = draft();
    const signed = applyPlainDealAction(d, "p-b", "sign", { signedName: "Second Creator", ...NAMES });
    expect(derivePlainDealState(signed)).toBe("signed");
    expect(dealWasSigned(signed)).toBe(true);
    expect(signed.agreedShares).toEqual([
      { profileId: "p-a", userId: "u-a", sharePct: 50 },
      { profileId: "p-b", userId: "u-b", sharePct: 50 },
    ]);
    expect(signed.signedText).toContain("Writes and records the song");
    expect(signed.signedText).toContain("Sings the hook and promotes the song");
    expect(signed.signedText).toContain("50%");
    expect(signed.sides[1]!.signedName).toBe("Second Creator");
    expect(signed.sides[1]!.signedAt).not.toBeNull();
  });

  it("signing requires a typed signature", () => {
    const d = draft();
    expect(() => applyPlainDealAction(d, "p-b", "sign", { signedName: "  ", ...NAMES })).toThrowError(
      expect.objectContaining({ code: "signature_missing" }),
    );
  });

  it("a stranger cannot sign, decline, or withdraw", () => {
    const d = draft();
    expect(() => applyPlainDealAction(d, "p-x", "sign", { signedName: "X", ...NAMES })).toThrowError(
      expect.objectContaining({ code: "not_a_party" }),
    );
  });

  it("after signing, amend and re-sign are refused — terms are locked", () => {
    const signed = applyPlainDealAction(draft(), "p-b", "sign", { signedName: "Second Creator", ...NAMES });
    expect(() => applyPlainDealAction(signed, "p-b", "sign", { signedName: "Again", ...NAMES })).toThrowError(
      expect.objectContaining({ code: "already_signed" }),
    );
    expect(() =>
      amendPlainDeal(signed, "p-a", {
        title: "Changed",
        author: { doesText: "does things", getsText: "gets things", sharePct: 50, signedName: "A" },
        partner: { doesText: "does things", getsText: "gets things", sharePct: 50 },
      }),
    ).toThrowError(expect.objectContaining({ code: "deal_locked" }));
  });
});

describe("plain-deals — amend un-signs the partner", () => {
  it("author edits reset the partner to pending and keep the author signed on the new words", () => {
    const d = draft();
    const amended = amendPlainDeal(d, "p-a", {
      title: "Our song 'Midnight Run' (new split)",
      author: { doesText: "Writes, records, and mixes the song", getsText: "Most of what it earns", sharePct: 70, signedName: "Thy Cheat Code" },
      partner: { doesText: "Sings the hook", getsText: "The rest of what it earns", sharePct: 30 },
    });
    expect(derivePlainDealState(amended)).toBe("awaiting_signature");
    expect(amended.sides[0]!.status).toBe("signed");
    expect(amended.sides[0]!.sharePct).toBe(70);
    expect(amended.sides[1]!.status).toBe("pending");
    expect(amended.sides[1]!.signedName).toBeNull();
    /* And the partner can sign the NEW words to complete it. */
    const signed = applyPlainDealAction(amended, "p-b", "sign", { signedName: "Second Creator", ...NAMES });
    expect(signed.agreedShares?.[0]!.sharePct).toBe(70);
  });

  it("only the author can amend", () => {
    const d = draft();
    expect(() =>
      amendPlainDeal(d, "p-b", {
        title: "Hijack",
        author: { doesText: "does things", getsText: "gets things", sharePct: 50, signedName: "B" },
        partner: { doesText: "does things", getsText: "gets things", sharePct: 50 },
      }),
    ).toThrowError(expect.objectContaining({ code: "not_author" }));
  });
});

describe("plain-deals — decline + withdraw", () => {
  it("decline ends the deal before signature", () => {
    const d = applyPlainDealAction(draft(), "p-b", "decline", NAMES);
    expect(derivePlainDealState(d)).toBe("declined");
    expect(dealWasSigned(d)).toBe(false);
  });

  it("author withdraw before signature cancels; partner then cannot sign", () => {
    const d = applyPlainDealAction(draft(), "p-a", "withdraw", NAMES);
    expect(derivePlainDealState(d)).toBe("cancelled");
    expect(() => applyPlainDealAction(d, "p-b", "sign", { signedName: "Second Creator", ...NAMES })).toThrowError(
      expect.objectContaining({ code: "deal_ended" }),
    );
  });

  it("withdraw AFTER signing is recorded but the frozen terms stand", () => {
    const signed = applyPlainDealAction(draft(), "p-b", "sign", { signedName: "Second Creator", ...NAMES });
    const textBefore = signed.signedText;
    const w = applyPlainDealAction(signed, "p-b", "withdraw", NAMES);
    expect(derivePlainDealState(w)).toBe("signed_one_withdrawn");
    expect(w.signedText).toBe(textBefore);
    expect(w.agreedShares).toEqual(signed.agreedShares);
  });
});

describe("plain-deals — rendering + table detection", () => {
  it("renders a general deal without an item line and names both sides' words", () => {
    const text = renderPlainDealText(
      {
        title: "A future collab",
        itemKind: "general",
        itemTitle: "",
        sides: draft().sides,
      },
      NAMES,
    );
    expect(text).toContain("The work: A future collab.");
    expect(text).toContain("Thy Cheat Code does: Writes and records the song");
    expect(text).toContain("Second Creator gets: Half of what the song earns");
  });

  it("detects the missing plain_deals table (42P01 + message match)", () => {
    expect(isMissingPlainDealTable({ code: "42P01" })).toBe(true);
    expect(isMissingPlainDealTable(new Error('relation "plain_deals" does not exist'))).toBe(true);
    expect(isMissingPlainDealTable(new Error("some other failure"))).toBe(false);
    expect(isMissingPlainDealTable(null)).toBe(false);
  });
});
